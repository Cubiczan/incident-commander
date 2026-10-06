# Spec Delta

## Purpose

Selects the Amazon Bedrock model used for incident-agent reasoning and the protocol probe, and selects AWS credentials without storing long-lived keys in the repository.

## ADDED Requirements

### Requirement: Default model is Nova Pro
When no Bedrock model id is configured, the system SHALL call Amazon Bedrock with the inference profile `us.amazon.nova-pro-v1:0` in region `us-east-1` unless `AWS_REGION` overrides the region.

#### Scenario: Model id unset
- **WHEN** `BEDROCK_MODEL_ID` is unset or blank
- **THEN** invocations and the protocol probe use `us.amazon.nova-pro-v1:0`

#### Scenario: Nova Lite override
- **WHEN** `BEDROCK_MODEL_ID` is `us.amazon.nova-lite-v1:0`
- **THEN** invocations and the protocol probe use `us.amazon.nova-lite-v1:0`

### Requirement: Anthropic model ids are refused
The system MUST NOT send an InvokeModel request whose model id contains `anthropic`. A configured Anthropic id SHALL be replaced with `us.amazon.nova-pro-v1:0`.

#### Scenario: Stale Claude foundation model id
- **WHEN** `BEDROCK_MODEL_ID` is `anthropic.claude-sonnet-4-20250514-v1:0`
- **THEN** the effective model id is `us.amazon.nova-pro-v1:0`
- **THEN** the request model id does not contain `anthropic`

#### Scenario: Stale Claude inference profile
- **WHEN** `BEDROCK_MODEL_ID` starts with `us.anthropic.`
- **THEN** the effective model id is `us.amazon.nova-pro-v1:0`

### Requirement: Invoke payload is Nova messages
Agent and protocol-probe InvokeModel bodies SHALL use schema version `messages-v1`, with message content as text blocks and `inferenceConfig.maxTokens`. The system MUST NOT send `anthropic_version`. Assistant text SHALL be read from `output.message.content` text blocks.

#### Scenario: Agent request shape
- **WHEN** an agent invokes the model with a system prompt and a user message
- **THEN** the JSON body includes `schemaVersion` `messages-v1`, a `system` text block, and `messages[].content` text blocks
- **THEN** the body does not include `anthropic_version`

#### Scenario: Successful text extraction
- **WHEN** Bedrock returns `output.message.content` containing a text block
- **THEN** the caller receives that text

#### Scenario: Probe treats Nova content as healthy
- **WHEN** the protocol probe receives a response whose `output.message.content` contains text
- **THEN** the report is healthy and `model_id` is the effective Nova model id

#### Scenario: Probe detects a non-Nova body
- **WHEN** the protocol probe receives a response without Nova `output.message.content` text
- **THEN** the report is unhealthy with reason code `UNKNOWN`

### Requirement: Credentials come from the host or an IAM role
The repository MUST NOT contain long-lived AWS access keys. When both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set, clients SHALL use those values. When they are unset and `AWS_USE_IAM_ROLE` is `1`, `true`, or `yes`, clients SHALL use the AWS SDK default credential chain. When neither static keys nor that flag are set, the protocol probe SHALL report `CREDENTIALS_MISSING` without calling Bedrock.

#### Scenario: Static keys in the environment
- **WHEN** both access key environment variables are set
- **THEN** Bedrock and S3 clients use those credentials

#### Scenario: IAM role flag
- **WHEN** static key variables are unset and `AWS_USE_IAM_ROLE` is `1`
- **THEN** clients omit static credentials so the SDK default chain applies
- **THEN** a Bedrock error is classified from the error itself rather than as missing credentials

#### Scenario: No credentials configured
- **WHEN** static key variables are unset and `AWS_USE_IAM_ROLE` is unset
- **THEN** the protocol probe returns `CREDENTIALS_MISSING` with latency `0` and does not call Bedrock
