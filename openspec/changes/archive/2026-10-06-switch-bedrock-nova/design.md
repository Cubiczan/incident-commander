# Design

## Context

`src/lib/bedrock.ts` hardcodes `anthropic.claude-sonnet-4-20250514-v1:0` and posts an Anthropic Messages body (`anthropic_version`, string `content`, `response.content[0].text`). `src/lib/protocol-health.ts` repeats that body and treats `response.content` as the healthy shape. Both clients, and `src/lib/s3.ts`, pass empty-string credentials when the key env vars are unset, which disables the SDK default chain. See proposal.md for why Nova is required.

## Goals / Non-Goals

**Goals:**

- Default and refused-id behavior matches `specs/bedrock-model/spec.md`.
- One Nova request builder shared by agents and the protocol probe.
- Host env keys or `AWS_USE_IAM_ROLE=1`, with no keys committed.

**Non-Goals:**

- Switching from `InvokeModel` to the Converse API.
- Changing the degradation ladder, CHP, or the `bedrock-invoke` protocol name.
- Rotating live IAM keys (no committed key material was found).
- Editing the hosted Vercel environment from this change.

## Decisions

1. **Nova Pro, not Nova Lite.** The previous default was Claude Sonnet 4, used for incident reasoning. Nova Pro is the credit-eligible counterpart. Lite stays available only as an explicit `BEDROCK_MODEL_ID`.
2. **US inference profile id.** `us.amazon.nova-pro-v1:0` (and Lite's `us.amazon.nova-lite-v1:0`) is the id sent as `modelId`. Region default stays `us-east-1`.
3. **Refuse any id containing `anthropic`.** Foundation ids (`anthropic.*`) and cross-region profiles (`us.anthropic.*`) both match. Refusal falls back to Nova Pro and logs a warning so a stale host env cannot reach Marketplace.
4. **Keep InvokeModel, change the schema.** Nova's Invoke API uses `schemaVersion: messages-v1`, `messages[].content[{text}]`, optional `system[{text}]`, and `inferenceConfig.maxTokens`. Text is joined from `output.message.content[].text`. The probe's healthy check uses that path. Schema fingerprints will change because top-level keys change; that is expected drift, not a bug.
5. **Credential selection.** If both static key env vars are non-empty, pass them. Otherwise omit `credentials` so the SDK default chain runs. The probe still fail-fasts with `CREDENTIALS_MISSING` unless static keys are set or `AWS_USE_IAM_ROLE` is `1`/`true`/`yes`, so unit tests do not call AWS. Explicit keys win when both keys and the flag are set.
6. **Keep `invokeClaude` as an alias** of the Nova invoke function so any external import keeps working, and point in-repo callers at `invokeModel`.

## Risks / Trade-offs

- [Stale `BEDROCK_MODEL_ID` on the host] → refused at runtime, but the host env should still be updated so config matches behavior.
- [Nova `maxTokens` cap is 5000] → current callers use 2000, under the cap. No clamp in this change.
- [IAM role without the flag] → probe reports `CREDENTIALS_MISSING` and does not call Bedrock. Document the flag.
- [Clients are constructed at import] → env must be present at process start, which matches the current process.

## Migration Plan

1. Deploy this code.
2. On the host, set `AWS_REGION=us-east-1` and `BEDROCK_MODEL_ID=us.amazon.nova-pro-v1:0` (or unset it). Remove any `anthropic.*` value.
3. Keep existing host env keys only if that IAM principal may `bedrock:InvokeModel` the Nova profile, or delete the keys and set `AWS_USE_IAM_ROLE=1` on a role with that permission.
4. Redeploy. Confirm `GET /api/health/protocol` reports the Nova model id and `healthy: true`.
5. Rollback: revert the commit and restore the previous model id only if the account policy is changed to allow it. Do not roll back onto Claude while `DenyMarketplaceAndClaude` is attached.

## Open Questions

None. Hosting env edits stay a manual follow-up listed in the pull request.
