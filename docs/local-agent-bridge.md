# Local agent bridge

Design Studio AI can use a host-local coding agent as a design-generation engine. This is the outbound direction:

```text
Studio editor
  -> bounded generation request
  -> host-local agent bridge
       -> Codex CLI
       -> Claude Code CLI
  -> schema + identity + asset validation
  -> proposal on the canvas
  -> explicit human apply/save
```

This complements the existing inbound direction where external agents connect **to Studio** through MCP, WebMCP, REST, or the CLI.

The design follows the runtime boundary used by [`philngt/afc-runtime`](https://github.com/philngt/afc-runtime): the product owns the task contract and validation while a small runtime adapter owns binary resolution, invocation, environment filtering, timeout, and output capture. Studio does not make Codex/Claude a database writer.

## Enable it

The bridge is intentionally disabled by default and is only implemented by the self-hosted Node runtime.

```env
AGENT_BRIDGE_ENABLED=true

# Optional additional Studio account IDs. The configured bootstrap admin is
# authorized automatically.
AGENT_BRIDGE_USER_IDS=

# Optional executable overrides. Empty values use PATH resolution.
CODEX_BIN=
CLAUDE_BIN=
```

Install and authenticate the desired CLI on the same host account that runs Studio. Restart Studio after installing a CLI because runtime discovery is cached for the process lifetime.

When enabled and authorized, available local agents appear automatically in the editor's generation selector alongside API providers. **Settings → Agent connections** shows the detected runtimes and versions.

### Docker

The standard Studio image does not install Codex or Claude Code. Enabling the variables alone does not put those binaries inside the container. Build a trusted derived image or otherwise provide the executable and its authentication/configuration to the container. Do not mount more host credentials or filesystem state than the CLI needs.

### Cloudflare

Cloudflare Workers cannot spawn host binaries, so the bridge remains unavailable there. Existing provider APIs and inbound MCP continue to work normally.

## Authorization

Launching a local agent can consume the host operator's authenticated agent subscription or API quota. Therefore `AGENT_BRIDGE_ENABLED=true` is not sufficient by itself.

An authenticated account can use the bridge only when either:

- it is the configured bootstrap administrator, or
- its Studio user ID appears in `AGENT_BRIDGE_USER_IDS`.

MCP OAuth tokens cannot launch host-local agents. Normal account sessions and explicitly authorized Studio API keys can.

Do not enable the bridge for an untrusted multi-user deployment unless every authorized account is intentionally allowed to consume the host agent runtime.

## Runtime isolation

The Node adapter is [`server/local-agent-runner-node.ts`](../server/local-agent-runner-node.ts). It applies these boundaries:

- only the built-in `codex` and `claude` runtime IDs can be selected; requests cannot supply an arbitrary executable or argument vector;
- each run gets an isolated temporary working directory;
- Codex runs non-interactively in read-only sandbox mode and receives its prompt through stdin;
- Claude Code runs in print mode with tools disabled, strict MCP configuration, and no session persistence;
- child processes receive an allowlisted environment rather than the entire Studio process environment;
- execution has bounded input, output, stderr, and wall-clock limits;
- temporary files are removed after each run;
- Studio never logs the prompt, generated document, or agent credential values.

The host CLI may still use its own authenticated profile under `HOME`, `CODEX_HOME`, or `CLAUDE_CONFIG_DIR`. That authentication stays owned by the host runtime; it is not copied into Studio's provider table.

## Proposal contract

Local agents reuse Studio's existing safe generation semantics rather than directly editing persisted state.

1. Studio freezes the current saved project revision and approved design brief.
2. The current canonical `DesignDocument` plus user request are sent to the selected local agent.
3. Codex receives the expected output schema when available. Claude output is still validated by Studio after the process returns.
4. Studio parses and validates the returned document or motion operations.
5. Document ID, kind, schema version, project revision, brief revision, and asset ownership are checked again.
6. The result is returned to the editor as a **proposal**.
7. The saved project changes only after the user explicitly applies/saves the proposal.

A failed agent, invalid JSON, identity change, stale revision, or invalid asset reference leaves the saved design unchanged.

## UI and API

The existing provider list exposes an available local runtime as a text-generation connection so the editor can reuse its current engine picker without teaching the canvas about process execution. Reserved connection IDs are:

- `custom-local-codex`
- `custom-local-claude`

They cannot be created, changed, or deleted through normal provider settings.

Runtime status:

```http
GET /api/providers/local-agents
```

Local generation:

```http
POST /api/providers/local-agents/generate
Content-Type: application/json

{
  "projectId": "...",
  "provider": "custom-local-codex",
  "prompt": "Simplify the settings flow",
  "expectedRevision": 3
}
```

The browser API helper transparently routes the editor's normal `/api/projects/:id/generate` request to this endpoint when a local-agent connection is selected. API-provider generation is unchanged.

## Why this is separate from AI providers

An API provider is a network credential and endpoint owned by a Studio account. A local agent is an executable runtime owned by the **host operator**. Treating them as the same security primitive would make it too easy for a normal Studio user to consume or control host credentials.

The shared UI may present both as generation engines, but the server keeps different ownership and authorization boundaries:

```text
API provider
  account-owned key -> remote model API

Local agent
  operator-owned CLI/auth -> bounded host process
```

That separation is the main invariant to preserve when adding future runtimes such as Gemini CLI or other coding agents.
