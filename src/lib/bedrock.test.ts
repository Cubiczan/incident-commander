import { describe, it, expect, afterEach } from 'bun:test';
import {
  DEFAULT_MODEL_ID,
  awsClientOptions,
  awsCredentialSource,
  awsCredentialsConfigured,
  buildNovaInvokeBody,
  classifyBedrockError,
  interpretNovaProbeBody,
  modelId,
  readNovaText,
  resolveModelId,
} from './bedrock';

describe('resolveModelId', () => {
  it('defaults to the US Nova Pro inference profile', () => {
    expect(DEFAULT_MODEL_ID).toBe('us.amazon.nova-pro-v1:0');
    expect(resolveModelId(undefined)).toBe(DEFAULT_MODEL_ID);
    expect(resolveModelId('')).toBe(DEFAULT_MODEL_ID);
    expect(resolveModelId('   ')).toBe(DEFAULT_MODEL_ID);
  });

  it('refuses Anthropic foundation ids and inference profiles', () => {
    expect(resolveModelId('anthropic.claude-sonnet-4-20250514-v1:0')).toBe(DEFAULT_MODEL_ID);
    expect(resolveModelId('us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe(DEFAULT_MODEL_ID);
  });

  it('preserves an explicit Nova Lite override', () => {
    expect(resolveModelId('us.amazon.nova-lite-v1:0')).toBe('us.amazon.nova-lite-v1:0');
  });
});

describe('modelId', () => {
  const saved = process.env.BEDROCK_MODEL_ID;

  afterEach(() => {
    if (saved === undefined) delete process.env.BEDROCK_MODEL_ID;
    else process.env.BEDROCK_MODEL_ID = saved;
  });

  it('uses Nova Pro when the env var is unset', () => {
    delete process.env.BEDROCK_MODEL_ID;
    expect(modelId()).toBe('us.amazon.nova-pro-v1:0');
    expect(modelId()).not.toContain('anthropic');
  });
});

describe('buildNovaInvokeBody', () => {
  it('uses the Nova messages schema and never the Anthropic body', () => {
    const body = buildNovaInvokeBody('You are an SRE.', [{ role: 'user', content: 'hi' }], 200);
    expect(body.schemaVersion).toBe('messages-v1');
    expect(body.system).toEqual([{ text: 'You are an SRE.' }]);
    expect(body.messages).toEqual([
      { role: 'user', content: [{ text: 'hi' }] },
    ]);
    expect(body.inferenceConfig).toEqual({ maxTokens: 200 });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('anthropic');
    expect(serialized).not.toContain('anthropic_version');
  });

  it('omits system when the probe sends only a ping', () => {
    const body = buildNovaInvokeBody(undefined, [{ role: 'user', content: 'ping' }], 1);
    expect(body.system).toBeUndefined();
    expect(body.inferenceConfig.maxTokens).toBe(1);
  });
});

describe('readNovaText', () => {
  it('joins text blocks from output.message.content', () => {
    const text = readNovaText({
      output: { message: { role: 'assistant', content: [{ text: 'sev' }, { text: ' high' }] } },
      stopReason: 'end_turn',
    });
    expect(text).toBe('sev high');
  });

  it('returns null for an Anthropic-shaped body', () => {
    expect(readNovaText({ content: [{ type: 'text', text: 'hello' }] })).toBeNull();
  });
});

describe('interpretNovaProbeBody', () => {
  it('marks a Nova text response healthy', () => {
    const result = interpretNovaProbeBody({
      output: { message: { content: [{ text: 'pong' }] } },
    });
    expect(result).toEqual({ healthy: true, reason_code: null, reason: null });
  });

  it('marks a response without Nova content unhealthy', () => {
    const result = interpretNovaProbeBody({ content: [{ text: 'pong' }] });
    expect(result.healthy).toBe(false);
    expect(result.reason_code).toBe('UNKNOWN');
  });
});

describe('classifyBedrockError with IAM role credentials', () => {
  const savedId = process.env.AWS_ACCESS_KEY_ID;
  const savedKey = process.env.AWS_SECRET_ACCESS_KEY;
  const savedRole = process.env.AWS_USE_IAM_ROLE;
  const savedArn = process.env.AWS_ROLE_ARN;

  afterEach(() => {
    if (savedId === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = savedId;
    if (savedKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY; else process.env.AWS_SECRET_ACCESS_KEY = savedKey;
    if (savedRole === undefined) delete process.env.AWS_USE_IAM_ROLE; else process.env.AWS_USE_IAM_ROLE = savedRole;
    if (savedArn === undefined) delete process.env.AWS_ROLE_ARN; else process.env.AWS_ROLE_ARN = savedArn;
  });

  it('classifies access denied from the error when the IAM role flag is set', () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_ROLE_ARN;
    process.env.AWS_USE_IAM_ROLE = '1';
    expect(classifyBedrockError({ name: 'AccessDeniedException', message: 'User is not authorized' })).toBe('AUTH_DENIED');
  });
});

describe('aws credential selection', () => {
  const savedId = process.env.AWS_ACCESS_KEY_ID;
  const savedKey = process.env.AWS_SECRET_ACCESS_KEY;
  const savedRole = process.env.AWS_USE_IAM_ROLE;
  const savedArn = process.env.AWS_ROLE_ARN;
  const savedRegion = process.env.AWS_REGION;
  const savedOidc = process.env.VERCEL_OIDC_TOKEN;

  afterEach(() => {
    if (savedId === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = savedId;
    if (savedKey === undefined) delete process.env.AWS_SECRET_ACCESS_KEY; else process.env.AWS_SECRET_ACCESS_KEY = savedKey;
    if (savedRole === undefined) delete process.env.AWS_USE_IAM_ROLE; else process.env.AWS_USE_IAM_ROLE = savedRole;
    if (savedArn === undefined) delete process.env.AWS_ROLE_ARN; else process.env.AWS_ROLE_ARN = savedArn;
    if (savedRegion === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = savedRegion;
    if (savedOidc === undefined) delete process.env.VERCEL_OIDC_TOKEN; else process.env.VERCEL_OIDC_TOKEN = savedOidc;
  });

  function clearAwsEnv() {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_USE_IAM_ROLE;
    delete process.env.AWS_ROLE_ARN;
    delete process.env.VERCEL_OIDC_TOKEN;
    process.env.AWS_REGION = 'us-east-1';
  }

  it('uses the Vercel OIDC provider when AWS_ROLE_ARN is set', async () => {
    clearAwsEnv();
    process.env.AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/vercel-incident-commander-nova';
    expect(awsCredentialSource()).toBe('vercel-oidc');
    expect(awsCredentialsConfigured()).toBe(true);
    const { credentials } = awsClientOptions();
    expect(typeof credentials).toBe('function');
    if (typeof credentials !== 'function') throw new Error('expected OIDC provider');
    await expect(credentials()).rejects.toMatchObject({ name: 'VercelOidcTokenError' });
  });

  it('prefers AWS_ROLE_ARN over static keys', () => {
    clearAwsEnv();
    process.env.AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/vercel-incident-commander-nova';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    expect(awsCredentialSource()).toBe('vercel-oidc');
    expect(typeof awsClientOptions().credentials).toBe('function');
  });

  it('uses static keys when no role ARN is set', () => {
    clearAwsEnv();
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    expect(awsCredentialSource()).toBe('static-keys');
    expect(awsClientOptions().credentials).toEqual({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });
  });

  it('omits credentials for the SDK default chain when only the IAM flag is set', () => {
    clearAwsEnv();
    process.env.AWS_USE_IAM_ROLE = '1';
    expect(awsCredentialSource()).toBe('default-chain');
    expect(awsCredentialsConfigured()).toBe(true);
    expect(awsClientOptions()).toEqual({ region: 'us-east-1' });
  });

  it('reports no credentials when role, keys, and the IAM flag are unset', () => {
    clearAwsEnv();
    expect(awsCredentialSource()).toBe('none');
    expect(awsCredentialsConfigured()).toBe(false);
    expect(awsClientOptions()).toEqual({ region: 'us-east-1' });
  });
});
