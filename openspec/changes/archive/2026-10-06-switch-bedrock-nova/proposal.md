# Proposal

## Why

The Cubiczan AWS account denies Anthropic Marketplace models (`DenyMarketplaceAndClaude`). The incident-commander default is Claude Sonnet 4 on Bedrock (`anthropic.claude-sonnet-4-20250514-v1:0`), so agent invokes fail and would bill the card through Marketplace if they succeeded. Promo credits cover Amazon Nova. The default model must be Nova, and the invoke payload must match Nova, because the current body is the Anthropic Messages schema.

## What Changes

- Default `BEDROCK_MODEL_ID` becomes the US Nova Pro inference profile `us.amazon.nova-pro-v1:0` (Sonnet-class reasoning). Nova Lite (`us.amazon.nova-lite-v1:0`) remains an explicit override.
- **BREAKING**: Anthropic model ids (any id containing `anthropic`, including `us.anthropic.*` inference profiles) are refused. A stale host env value falls back to Nova Pro instead of calling Claude.
- InvokeModel requests and the protocol-health probe use the Nova `messages-v1` schema and read `output.message.content[].text`. The protocol name stays `bedrock-invoke`.
- Credentials stay out of git. Static keys are read from the host environment only when both are set. `AWS_USE_IAM_ROLE=1` uses the SDK default credential chain (IAM role / instance profile / web identity) and skips the probe's missing-key short circuit.
- README and `.env.example` document the Nova default, the refused Claude ids, and the credential options.

## Capabilities

### New Capabilities

- `bedrock-model`: Which Bedrock model the agents and the protocol probe call, how that request is shaped, and how AWS credentials are selected.

### Modified Capabilities

- None. This repository has no existing OpenSpec capabilities.

## Impact

- `src/lib/bedrock.ts` — model resolution, Nova request/response, credential selection.
- `src/lib/protocol-health.ts` — probe body and healthy-response check follow Nova.
- `src/lib/agents.ts` — call the renamed invoke helper.
- `src/lib/s3.ts` — same credential selection so blank keys do not override an IAM role.
- `.env.example`, `README.md`.
- Protocol-health schema fingerprints will change (top-level response keys differ from Anthropic). Hosting must set `BEDROCK_MODEL_ID` (or unset the old Claude value) and `AWS_REGION=us-east-1`, and grant `bedrock:InvokeModel` on the Nova inference profile. No new long-lived keys are added to the repo.
