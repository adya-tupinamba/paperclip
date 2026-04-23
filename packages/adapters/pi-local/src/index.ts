export const type = "pi_local";
export const label = "Pi (local)";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# pi_local agent configuration

Adapter: pi_local

Use when:
- You want Paperclip to run Pi (the AI coding agent) locally as the agent runtime
- You want provider/model routing in Pi format (--provider <name> --model <id>)
- You want Pi session resume across heartbeats via --session
- You need Pi's tool set (read, bash, edit, write, grep, find, ls)

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- Pi CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file appended to system prompt via --append-system-prompt
- promptTemplate (string, optional): user prompt template passed via -p flag
- model (string, required): Pi model id in provider/model format (for example xai/grok-4)
- thinking (string, optional): thinking level (off, minimal, low, medium, high, xhigh)
- command (string, optional): defaults to "pi"
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Pi supports multiple providers and models. Use \`pi --list-models\` to list available options.
- Paperclip requires an explicit \`model\` value for \`pi_local\` agents.
- Sessions are stored in ~/.pi/paperclips/ and resumed with --session.
- All tools (read, bash, edit, write, grep, find, ls) are enabled by default.
- Agent instructions are appended to Pi's system prompt via --append-system-prompt, while the user task is sent via -p.
- The \`thinking\` field is a native adapter_config property (not extraArgs) and is passed to Pi as \`--thinking <level>\` by the adapter.

# Specialist lanes (deep reasoning via Pi)
# ILM v1 uses a mixed specialist lane to get independent coverage:
#
# - Gemini lane (architecture + ingestion):
#   model: google/gemini-3.1-pro-preview
#   thinking: high
#   Use for CTO, DataEngineer - deep reasoning, long context, triage, cross-repo synthesis.
#   Requires GEMINI_API_KEY in env.
#
# - GLM lane (audit + security):
#   model: zai/glm-5.1
#   thinking: high
#   Use for SecurityAuditor - independent judge on RLS/auth/data-isolation reviews.
#   Deliberately different model family from CTO/DataEngineer so the auditor is not the
#   same brain as the architect. Requires ZAI_API_KEY in env.
#
# Alternative providers/models available via Pi (2026-04-22):
# - ZAI: zai/glm-5-turbo (latency-tuned, swap in if audit queue grows),
#        zai/glm-5v-turbo (multimodal, for screenshot/image audits when needed).
# - Google: google/gemini-3.1-pro-preview-customtools (specialized tool-use variant).
# Use \`pi --list-models\` on the host to confirm availability before configuring an agent.
`;
