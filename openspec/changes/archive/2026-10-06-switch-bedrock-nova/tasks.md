# Tasks

## 1. Nova model resolution and invoke body

- [x] 1.1 Resolve the default model to `us.amazon.nova-pro-v1:0`, refuse any id containing `anthropic`, and build Nova `messages-v1` invoke bodies in `src/lib/bedrock.ts`. Verify with unit tests that the unset id, a Claude foundation id, and a `us.anthropic.` profile all resolve to Nova Pro, that Lite is preserved, and that the body has no `anthropic_version`.
- [x] 1.2 Read assistant text from `output.message.content` and point `src/lib/agents.ts` at that invoke path. Verify the text-extraction unit test and that `bun test src/lib` still passes.

## 2. Protocol probe and credentials

- [x] 2.1 Send the Nova body from the protocol probe and treat Nova content text as healthy. Verify the existing missing-credentials probe test still returns `CREDENTIALS_MISSING` with latency 0, and that a fixture response without Nova content is classified unhealthy.
- [x] 2.2 Select static env credentials only when both keys are set, and use the SDK default chain when `AWS_USE_IAM_ROLE` is enabled, including S3. Verify a classification test: with the flag set and keys unset, an access-denied error is `AUTH_DENIED`.

## 3. Docs

- [x] 3.1 Update `README.md` and `.env.example` so the documented default is Nova Pro, Anthropic ids are described as refused, and credentials are documented as host env or `AWS_USE_IAM_ROLE` with no committed keys. Verify those files contain `us.amazon.nova-pro-v1:0` and do not contain `anthropic.claude`.

## Workflow follow-up

- Archive the change after implementation so the bedrock-model delta merges into `openspec/specs/`.
