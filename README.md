# Design Studio AI

> Maintained fork of [bestagentkits/design-studio-ai](https://github.com/bestagentkits/design-studio-ai).

[Source](https://github.com/philngt/design-studio-ai) · [Upstream](https://github.com/bestagentkits/design-studio-ai) · [Upstream live studio](https://studio.agentkit.best) · [MIT license](LICENSE)

An agent-first design workspace for web interfaces, slides, reports, wireframes, 3D scenes, and timeline videos. Start with a brief or template, inspect the preview, make focused changes through chat or the manual editor, and export or publish the result. People and agents work on the same versioned document.

## Fork status

This repository tracks and extends the upstream Design Studio AI project.

- Source and development for this fork live in `philngt/design-studio-ai`.
- The public `studio.agentkit.best` deployment is operated by the upstream project.
- Self-hosted deployments should configure their own `APP_URL`.
- CLI and agents should set `DESIGN_STUDIO_URL` to the intended deployment.
- Upstream copyright and MIT license attribution are preserved.

![Design Studio workspace with a prompt composer and starter templates for websites, presentations, documents, wireframes, 3D scenes, and motion](docs/assets/workspace.webp)

## Capabilities

- Responsive project library with search, filters, sorting, duplication, and saved designs.
- Structured flex/grid layouts, nested groups, Ant and shadcn-style components, versioned reusable design systems, and live human/agent editing.
- Native [2D character motion](docs/character-motion.md): bones, skins, weighted meshes, per-property clips, constraints, physics and scene blending.
- [Editable 3D characters](docs/3d-characters.md): remesh/loft, quadruped rigs, weights, IK, morph targets and UV painting; textured animated 3D scenes, multi-layer keyframe editing, presentation modes, font/model discovery and interactive API docs.
- BYOK text, image, speech, music/effects, and video generation, plus supported source-media edits. See [providers](docs/providers.md).
- JSON, HTML, SVG, PNG, PDF, PowerPoint, WebM, supported MP4 recording, React prototype ZIP, GLB/glTF, and authorized Google Slides export.
- Immutable public snapshots, REST, authenticated Streamable HTTP MCP with OAuth/API keys, experimental browser WebMCP, and the `dsa` CLI with an [agent skill](skills/design-studio-ai/SKILL.md).
- Owner-scoped activity, correlated request/provider traces, and reported token/cost usage with explicit coverage; optional operator views and PostHog forwarding.
- Cloudflare hosting or Docker self-hosting with persistent SQLite/files.
- Email/password and optional GitHub sign-in, with explicit account linking in Settings.
- Persisted contextual interviews, editable scopes, explicit approval, and shared REST/MCP/CLI/WebMCP access to the same brief.
- System/light/dark appearance, keyboard-friendly mobile controls, and design checks that locate likely text overflow, missing media, and contrast issues without changing the canvas.

Generation calls real providers and requires your credentials and account access. It returns a proposal or asset; saved designs change through explicit revision-checked writes.

## Run locally

Use Node.js 24 or newer:

```sh
npm ci
npm ci --prefix packages/cli
npm run build:cli
npx playwright install chromium
npm run build
```

Set a stable random 32-byte base64 `ENCRYPTION_KEY` in the server's process environment, and set `APP_URL=http://localhost:8787`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
export ENCRYPTION_KEY='<generated-key>'
export APP_URL='http://localhost:8787'
npm start
```

SQLite and assets persist under `DATA_DIR` (default `data`). See [deployment instructions](docs/deployment.md) for Docker and Cloudflare hosting.

## Agent access

Create an API token in Settings and inject `DESIGN_STUDIO_API_KEY` into the agent environment. Point `DESIGN_STUDIO_URL` at the Design Studio deployment you intend to use.

The upstream hosted instance is available at `https://studio.agentkit.best`; it is not operated by this fork.

Build the CLI from this checkout:

```sh
npm ci --prefix packages/cli
npm run build:cli
cd packages/cli
npm pack
cd ../..
npm install -g ./packages/cli/philngt-design-studio-ai-0.4.3.tgz
dsa --help
dsa schema
dsa projects list
```

Tagged upstream releases remain available from [bestagentkits/design-studio-ai](https://github.com/bestagentkits/design-studio-ai/releases), but they represent upstream builds rather than releases of this fork.

## Verify and contribute

Start with the [contributor documentation](docs/README.md). Coding agents should follow [AGENTS.md](AGENTS.md).

Run:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Follow [architecture](docs/architecture.md) when changing public contracts; do not add a second document format for a client.

## Current boundaries

- Provider/Google success needs external credentials. Missing configuration returns useful errors.
- Google Slides accepts native text/shapes and HTTPS images; unsupported complex nodes fail explicitly. PowerPoint keeps editable text/primitives and rasterizes complex content.
- Cloud binary export requires imported project assets for remote media, enforces render-size bounds, and limits motion to 60 seconds. MP4 depends on an available encoder.
- Cloud motion mixes imported audio/video; browser fallback recordings are silent.
- Live synchronization currently polls saved revisions every 1.2 seconds.
- WebMCP is experimental and feature-detected; other browsers retain the human UI and network MCP.
- Upstream dependency audit findings remain; see [security notes](docs/deployment.md#dependency-security).

## Upstream attribution

Design Studio AI was originally developed in [bestagentkits/design-studio-ai](https://github.com/bestagentkits/design-studio-ai). This fork preserves the upstream MIT license and copyright notice while maintaining an independent source/release identity under `philngt/design-studio-ai`.

See the [product brief](docs/product-brief.md), [architecture](docs/architecture.md), [agent documentation](docs/agents.md), and [community documentation](docs/community.md) for deeper technical details.
