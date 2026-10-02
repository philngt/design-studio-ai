# Coding agents inside Studio

The self-hosted Node runtime can run Claude Code, Codex, GitHub Copilot CLI, OpenCode and Pi directly from the editor. This is separate from BYOK provider generation and external agents connecting to `/mcp`. The interface is informed by Paseo's provider/session pattern; the implementation has no Paseo server or runtime dependency.

## Operator setup

1. Install the desired CLI on the server under a dedicated operating-system service account. Authenticate that CLI as the same OS account that starts Studio. Check its own official install/login instructions; Studio never collects its login password or copies credentials from a browser.
2. Create or sign in to the intended Studio account. Read its exact `user.id` from authenticated `GET /api/auth/me` (or the REST playground). Configure `STUDIO_AGENTS_ENABLED=true` and `STUDIO_AGENT_OWNER_ID=<that user ID>` in the server environment or local `.env`, then restart. This is one ID, not an email, list or wildcard.
3. Open Settings → Agent access to check detected CLIs. A successful `--version` check means installed, not authenticated. Model discovery is an explicit CLI query; listing a model does not establish access. You can omit a model override to use the CLI's default. OpenCode overrides use `provider/model`.

Default executable names are `claude`, `codex`, `copilot`, `opencode` and `pi`. Node deployments can set `STUDIO_AGENT_CLAUDE_BIN`, `STUDIO_AGENT_CODEX_BIN`, `STUDIO_AGENT_COPILOT_BIN`, `STUDIO_AGENT_OPENCODE_BIN` or `STUDIO_AGENT_PI_BIN` to an executable path. Do not include shell arguments in these values. Node 24+ and the checkout's locked SDK versions are required. Native CLI versions should be pinned and verified by the operator; protocol compatibility and model entitlement are not guaranteed for every CLI release.

Cloudflare Workers cannot start local CLI processes. They return an unavailable catalog; existing BYOK generation and external MCP workflows remain usable. Agent execution is disabled by default on Node too.

### Docker

Set `CODING_AGENT_PACKAGES` before building to a space-separated list of operator-pinned npm CLI packages, for example `@openai/codex@<tested version>`. Common package names are `@anthropic-ai/claude-code`, `@openai/codex`, `@github/copilot`, `opencode-ai`; choose the current Pi package from its official instructions. Do not put credentials in build arguments.

```sh
docker compose up --build -d
# Authenticate installed CLIs as the container's node user, for example:
docker compose exec studio codex login --device-auth
```

Compose persists CLI login/configuration in the separate `studio-agent-home` volume mounted at `/home/node`, and Studio SQLite/assets/draft workspaces in `studio-data` at `/data`. Back up both privately. Removing the agent-home volume loses CLI login state. Only CLI packages supplied at build time are installed; rebuilding is needed to change them. Do not mount your personal home directory or a Git/code workspace into the container.

## Human workflow

Projects open in **Chat** with a preview beside the conversation on desktop, or **Chat / Preview** tabs on smaller screens. Choose an API connection or coding agent in the same **AI** picker; Studio remembers the choice for this account on this browser. **Options** holds model overrides and connection management. Sessions are created or resumed automatically; **History** exposes session selection. One turn or proposal action runs per project at a time.

For a prompt-driven project, answer one contextual question at a time in chat. Answers and brief revisions persist across reloads. Review and edit the scope card, then choose **Approve and create**. A coding agent's interview session can only read the brief and submit questions/scope. After human approval, Studio starts a separate design session in the same workspace. Reload never starts a paid turn. **Edit** opens the full editor without losing an unsent chat message; pending manual edits are saved explicitly with **Save and send**.

Text streams incrementally. Studio-tool activity, input/permission requests, errors and usage reported by the provider appear in the same log. Unreported usage is unknown, not zero, and these events are not a complete provider billing ledger. **Stop agent** terminates the owned process, preserving any draft edits. A server restart marks in-flight sessions interrupted; it does not silently rerun a paid turn.

Completed drafts appear in the preview automatically. Choose **View design** on smaller screens, inspect the pages, then **Apply proposal** or **Discard**. Tools never write the saved document, approve a brief, publish, export or mutate a Git repository. Apply uses the shared save service, checking the reviewed draft version, saved document revision, approved brief revision and asset ownership. An exact Apply retry returns the same save receipt. A manual edit or changed brief produces a conflict; review the latest saved design rather than increasing revision numbers to force stale content through. Discard resets the draft and native conversation handle to current saved state, including when the brief now needs approval again.

## Agent/API workflow

The [shared endpoint inventory](../src/shared/agent-endpoints.ts) and [schemas](../src/shared/agents.ts) own the contract. Discover `codingAgents` in `/api/schema`, `/api/openapi`, or `dsa agents schema`. Network MCP exposes `agent_*` tools. Browser WebMCP uses one compact `studio_agents` tool: choose the `agent_*` operation name and supply `parameters` (id, sessionId or provider), canonical `body` when needed, and `after` for events. It validates the same shared schemas. The OAuth `studio` scope deliberately does **not** authorize host-agent execution: use the designated owner's application API key, or their signed-in browser session. An arbitrary project owner cannot use the host's CLI account.

```sh
dsa agents providers
dsa agents models codex
# Before approval, use a restricted interview session:
dsa agents create PROJECT_ID --provider codex --purpose interview --revision OBSERVED_REVISION --brief-revision OBSERVED_BRIEF_REVISION
# After explicit scope approval, create a design session (the default purpose):
dsa agents create PROJECT_ID --provider codex --revision OBSERVED_REVISION
dsa agents send PROJECT_ID SESSION_ID --file turn.json
dsa agents events PROJECT_ID SESSION_ID --after LAST_SEQUENCE
dsa agents proposal PROJECT_ID SESSION_ID
# Only after the human reviews this version:
dsa agents apply PROJECT_ID SESSION_ID --proposal-version REVIEWED_DRAFT_VERSION
```

`turn.json` contains `{ "requestId": "<stable UUID>", "prompt": "<request>", "expectedRevision": <observed document revision> }`. Retain the exact ID and body for retries after uncertain network responses; changing a body under the same ID returns a conflict. Events return up to 200 records after a durable sequence ID; continue from the last returned `seq`. `?stream=true` selects SSE; reconnects use `Last-Event-ID` before the initial `after` query. CLI events are JSON polling, not SSE. Use `get`, `list`, `stop`, `respond` and `discard` command help for their inputs.

## Security and runtime boundaries

Each turn gets a private workspace and a random, turn-scoped authenticated loopback tool gateway. Design sessions expose only `studio_context`, `studio_schema`, `studio_catalog`, `studio_edit`, `studio_replace` and `studio_inspect`. Interview sessions expose only `studio_brief_context` and `studio_submit_interview`; both the gateway and server enforce that boundary. Interview creation and messages require the observed `expectedBriefRevision` as well as the document revision. An approved brief closes its interview session to further turns. Draft schemas and owned assets are validated on the server; tools recheck Studio authorization, and the gateway is revoked when the turn ends. Child environments exclude Studio API keys, encryption keys and OAuth app secrets. Provider authentication must still be available to its native CLI.

`GET /api/projects/{id}/brief/history?after=REVISION`, MCP `get_design_brief_history`, WebMCP `studio_get_brief_history` (or the generated saved-state API tool), and `dsa brief history PROJECT_ID --after REVISION` return committed snapshots in ascending order. Continue with `nextAfter` until null. Existing projects receive their current snapshot during migration; earlier revisions are not reconstructed. History is owner-scoped and does not authorize approval or another model call.

Claude uses its Agent SDK, Codex its app-server protocol, Copilot ACP, OpenCode its local HTTP/SSE SDK, and Pi RPC with a Studio-only extension. Pi explicitly enables only the Studio tool names and waits for `agent_settled`, not the earlier low-level `agent_end`, following its [RPC lifecycle](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) and [tool selection contract](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts). Built-in write/shell tools are disabled or denied where the native protocol supports this; requests for unsupported capabilities are rejected. These controls are **not an operating-system sandbox or a credential-isolation guarantee for arbitrary CLI plugins/configuration**. Use trusted, pinned CLIs under a dedicated OS user/container, avoid unrelated extensions/global MCP servers, and expose this feature only to the designated trusted account. Native CLI sessions/config files may contain private prompts or provider credentials; keep their storage private.

Copilot launches in default stdio ACP mode, explicitly allows the `studio` MCP server, denies file/shell/URL/memory permissions and disables built-in MCP servers and custom instructions. Additional permission requests are cancelled, never authorized by a tool's display title. These controls follow its [tool permission contract](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#tool-permission-patterns); operators must still verify their pinned CLI and avoid unrelated global plugins/server configuration.

Missing CLI, failed authentication, model denial, malformed protocol, interruptions and stale proposals return explicit errors; production never substitutes fixture output. Local contract/protocol tests do not establish successful live generation from all five providers. A real provider smoke test requires the operator's credentials and consent to possible charges.

### Claude Studio-tool readiness

Before sending a turn's prompt, Studio waits up to 30 seconds for that Claude session's `studio` MCP server to connect and advertise every tool required by the session purpose. Interview sessions require `studio_brief_context` and `studio_submit_interview`; design sessions require the six draft tools above. Built-in tools remain disabled. This follows the SDK's [MCP connection-status guidance](https://code.claude.com/docs/en/agent-sdk/mcp#error-handling): a failed MCP connection does not necessarily fail a query by itself.

Missing tools, failed/disabled/auth-required connections, unreadable status or a timeout stop the turn before its prompt is sent. Chat and all event clients receive `error` with code `agent_tools_unavailable` and a credential-free diagnostic. Saved brief/design state stays unchanged. Check the pinned Claude CLI and MCP subprocess setup under the Studio service account; a CLI that cannot report its connected tool inventory is not compatible with this guard. Fix the setup, then explicitly send again. Reload and an exact request-ID retry do not rerun the failed turn; a deliberate new turn needs a new request ID. Stop remains available during connection checks.

The optional offline check uses an installed Claude executable, the real Studio bridge, a disposable CLI home and a loopback provider that rejects generation. It verifies prompt/tool wiring without operator credentials or paid model calls, not live model success:

```sh
STUDIO_TEST_CLAUDE_BIN=/absolute/path/to/claude node --import tsx --test tests/agent-claude-cli.test.ts
```

Validated locally with Claude Code 2.1.246 and the locked Agent SDK 0.3.246. This is not a guarantee for every CLI release or a diagnosis of an unobserved deployment.
