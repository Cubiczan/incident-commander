// Row 19: protocol health probe for the Bedrock invocation path.
//
// A connectivity check (TCP reachability, HTTP 200 on a console URL) cannot
// see a broken model protocol: wrong model id, denied credentials, throttling,
// or a response shape that changed under us. This probe performs a REAL
// handshake — a minimal InvokeModel call — and reports a reason code, a human
// reason, and a schema fingerprint of the observed response for drift
// detection. Same classification as the invocation path (classifyBedrockError),
// so a probe failure predicts an invocation failure.

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createHash } from 'crypto';
import {
  awsClientOptions,
  awsCredentialsConfigured,
  buildNovaInvokeBody,
  classifyBedrockError,
  interpretNovaProbeBody,
  modelId,
  type BedrockFailureReason,
} from './bedrock';

// The probe owns its own client (same env config as the invocation path) so
// it stays independently constructible in tests and health endpoints.
// Built on first use so AWS_ROLE_ARN is read at request time, not at import.
let client: BedrockRuntimeClient | undefined;

function probeClient(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient(awsClientOptions());
  return client;
}

export interface ProtocolHealthReport {
  protocol: 'bedrock-invoke';
  healthy: boolean;
  /** Classified failure code; null when healthy. */
  reason_code: BedrockFailureReason | null;
  /** Human-readable detail; null when healthy. */
  reason: string | null;
  model_id: string;
  checked_at: string;
  latency_ms: number;
  /**
   * SHA-256 over the sorted top-level response keys. Compare across checks:
   * a change means the provider's response schema drifted (row 19's drift
   * detection), which breaks consumers even when the call "succeeds".
   */
  schema_fingerprint: string | null;
}

const REASON_HINTS: Record<BedrockFailureReason, string> = {
  CREDENTIALS_MISSING: 'AWS credentials are not configured. Set AWS_ROLE_ARN for Vercel OIDC, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or AWS_USE_IAM_ROLE=1.',
  AUTH_DENIED: 'AWS denied the call — check IAM permissions for bedrock:InvokeModel.',
  THROTTLED: 'Bedrock throttled the request — the account or model quota is exhausted.',
  MODEL_NOT_FOUND: 'The configured BEDROCK_MODEL_ID is not available in this region/account.',
  NETWORK: 'Network failure reaching the Bedrock endpoint.',
  UNKNOWN: 'Unclassified Bedrock failure — inspect application logs.',
};

export async function probeBedrockProtocol(): Promise<ProtocolHealthReport> {
  const checkedAt = new Date().toISOString();
  const start = Date.now();

  // No credentials: fail fast without a pointless network round-trip.
  if (!awsCredentialsConfigured()) {
    return {
      protocol: 'bedrock-invoke',
      healthy: false,
      reason_code: 'CREDENTIALS_MISSING',
      reason: REASON_HINTS.CREDENTIALS_MISSING,
      model_id: modelId(),
      checked_at: checkedAt,
      latency_ms: 0,
      schema_fingerprint: null,
    };
  }

  try {
    const command = new InvokeModelCommand({
      modelId: modelId(),
      contentType: 'application/json',
      accept: 'application/json',
      // Minimal handshake: 1 token, single word. Enough to prove the
      // protocol path (auth, model, response shape) end to end.
      body: JSON.stringify(buildNovaInvokeBody(undefined, [{ role: 'user', content: 'ping' }], 1)),
    });
    const response = await probeClient().send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as Record<string, unknown>;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(Object.keys(responseBody).sort()))
      .digest('hex');
    const interpreted = interpretNovaProbeBody(responseBody);
    return {
      protocol: 'bedrock-invoke',
      healthy: interpreted.healthy,
      reason_code: interpreted.reason_code,
      reason: interpreted.reason,
      model_id: modelId(),
      checked_at: checkedAt,
      latency_ms: Date.now() - start,
      schema_fingerprint: fingerprint,
    };
  } catch (e) {
    const reason = classifyBedrockError(e);
    // Full SDK detail goes to server logs ONLY. The report envelope must not
    // carry raw provider exception text — AWS error messages can leak IAM
    // principal ARNs, account IDs, and denied actions (HIGH finding on #4).
    console.error(`[protocol-health] probe failed (${reason}):`, e);
    return {
      protocol: 'bedrock-invoke',
      healthy: false,
      reason_code: reason,
      reason: REASON_HINTS[reason],
      model_id: modelId(),
      checked_at: checkedAt,
      latency_ms: Date.now() - start,
      schema_fingerprint: null,
    };
  }
}
