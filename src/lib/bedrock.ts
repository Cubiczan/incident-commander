import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/** US cross-region inference profile for Amazon Nova Pro. Credit-eligible on Bedrock. */
export const DEFAULT_MODEL_ID = 'us.amazon.nova-pro-v1:0';

export const NOVA_SCHEMA_DRIFT_REASON =
  'Response received but Nova output.message.content text is missing — schema drift.';

/**
 * Effective Bedrock model id. Anthropic ids are refused: the Cubiczan account
 * denies Marketplace Claude, and those invokes are not credit-eligible.
 */
export function resolveModelId(raw: string | undefined = process.env.BEDROCK_MODEL_ID): string {
  const configured = raw?.trim();
  if (!configured) return DEFAULT_MODEL_ID;
  if (configured.toLowerCase().includes('anthropic')) {
    console.warn(
      `Refusing Anthropic Bedrock model id "${configured}"; using ${DEFAULT_MODEL_ID}. ` +
        'Anthropic models are denied by account policy and are not credit-eligible.'
    );
    return DEFAULT_MODEL_ID;
  }
  return configured;
}

/** Resolved per call so a host env override is honored after process start. */
export function modelId(): string {
  return resolveModelId();
}

export function staticAwsKeysConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/** Opt in to the SDK default chain (IAM role, instance profile, web identity). */
export function iamRoleCredentialsEnabled(): boolean {
  const flag = (process.env.AWS_USE_IAM_ROLE || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

export function awsCredentialsConfigured(): boolean {
  return staticAwsKeysConfigured() || iamRoleCredentialsEnabled();
}

export function awsClientOptions(): {
  region: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return { region, credentials: { accessKeyId, secretAccessKey } };
  }
  return { region };
}

const client = new BedrockRuntimeClient(awsClientOptions());

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NovaInvokeBody {
  schemaVersion: 'messages-v1';
  messages: Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }>;
  system?: Array<{ text: string }>;
  inferenceConfig: { maxTokens: number };
}

/** Nova InvokeModel body. Shared by agents and the protocol probe. */
export function buildNovaInvokeBody(
  systemPrompt: string | undefined,
  messages: BedrockMessage[],
  maxTokens: number
): NovaInvokeBody {
  const body: NovaInvokeBody = {
    schemaVersion: 'messages-v1',
    messages: messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ text: m.content }],
    })),
    inferenceConfig: { maxTokens },
  };
  if (systemPrompt) {
    body.system = [{ text: systemPrompt }];
  }
  return body;
}

/** Assistant text from a Nova InvokeModel response, or null when the shape drifted. */
export function readNovaText(responseBody: unknown): string | null {
  if (!responseBody || typeof responseBody !== 'object') return null;
  const content = (responseBody as {
    output?: { message?: { content?: unknown } };
  }).output?.message?.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
      const text = (block as { text: string }).text;
      if (text.length > 0) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}

export function interpretNovaProbeBody(responseBody: unknown): {
  healthy: boolean;
  reason_code: BedrockFailureReason | null;
  reason: string | null;
} {
  if (readNovaText(responseBody) !== null) {
    return { healthy: true, reason_code: null, reason: null };
  }
  return {
    healthy: false,
    reason_code: 'UNKNOWN',
    reason: NOVA_SCHEMA_DRIFT_REASON,
  };
}

/**
 * Reason codes for a failed Bedrock invocation (row 19 probe shares this
 * classification). Never guess: an unknown error maps to UNKNOWN, not to a
 * plausible-looking guess.
 */
export type BedrockFailureReason =
  | 'CREDENTIALS_MISSING'
  | 'AUTH_DENIED'
  | 'THROTTLED'
  | 'MODEL_NOT_FOUND'
  | 'NETWORK'
  | 'UNKNOWN';

export class BedrockUnavailableError extends Error {
  readonly reason: BedrockFailureReason;
  constructor(reason: BedrockFailureReason, detail: string) {
    super(`Bedrock unavailable (${reason}): ${detail}`);
    this.name = 'BedrockUnavailableError';
    this.reason = reason;
  }
}

export function classifyBedrockError(e: unknown): BedrockFailureReason {
  if (!awsCredentialsConfigured()) {
    return 'CREDENTIALS_MISSING';
  }
  const name = (e as { name?: string }).name || '';
  const message = ((e as Error).message || '').toLowerCase();
  if (name.includes('AccessDenied') || message.includes('access denied') || message.includes('not authorized') || message.includes('security token')) {
    return 'AUTH_DENIED';
  }
  if (name.includes('Throttling') || message.includes('throttl')) {
    return 'THROTTLED';
  }
  if (message.includes('not found') || message.includes('no such model')) {
    return 'MODEL_NOT_FOUND';
  }
  if (message.includes('network') || message.includes('econnrefused') || message.includes('etimedout') || message.includes('socket')) {
    return 'NETWORK';
  }
  return 'UNKNOWN';
}

export async function invokeModel(
  systemPrompt: string,
  messages: BedrockMessage[],
  maxTokens: number = 2000
): Promise<string> {
  try {
    const command = new InvokeModelCommand({
      modelId: modelId(),
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(buildNovaInvokeBody(systemPrompt, messages, maxTokens)),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = readNovaText(responseBody);
    if (text === null) {
      throw new Error(NOVA_SCHEMA_DRIFT_REASON);
    }
    return text;
  } catch (bedrockError) {
    // Row 18: the previous behavior on this path fabricated a canned incident
    // response. Fail loudly instead; callers decide whether to degrade.
    const reason = classifyBedrockError(bedrockError);
    const detail = (bedrockError as Error).message || String(bedrockError);
    console.warn(`Bedrock invocation failed (${reason}):`, detail);
    throw new BedrockUnavailableError(reason, detail);
  }
}

/** @deprecated Use invokeModel. Alias kept so existing imports keep compiling. */
export const invokeClaude = invokeModel;

export async function invokeModelJSON<T>(
  systemPrompt: string,
  messages: BedrockMessage[],
  maxTokens: number = 2000
): Promise<T> {
  const text = await invokeModel(systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no explanation.', messages, maxTokens);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in LLM response');
  return JSON.parse(jsonMatch[0]) as T;
}

/** @deprecated Use invokeModelJSON. */
export const invokeClaudeJSON = invokeModelJSON;
