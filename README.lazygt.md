# lazygt

## OpenCode Go

Settings > Models > OpenCode Go connects your own Go subscription. Enter the Go
key once; the desktop stores it in Windows Credential Manager. The native transport
retrieves it directly and sends requests only to `https://opencode.ai/zen/go/v1`.
No Go key is stored in localStorage, source, or logs. A stable conversation header
and the lazygt user agent identify requests. Redirects are disabled.

The model picker includes the documented Go models across Chat Completions,
Anthropic Messages, and Responses formats. Connection testing refreshes availability
and makes a small request against the chosen model using subscription quota.
Unknown protocol models are excluded until an adapter is verified. Go currently
supports read-only Ask/Plan, inline transforms, Edit-mode tools, and autonomous missions.
Go models use the native credential bridge and the IDE tool runtime; they do not
require a separate CLI. Code-tab tool results appear as steps. Edit can read/write
files, run commands/tests, and open a project; it stops after 30 actions or three
consecutive failures. Project opening ends the turn to prevent further actions in
the old workspace. Existing tool permission rules still apply.
Model-specific quotas and contributor-model data policies apply; no pay-as-you-go
fallback is configured by lazygt. See https://opencode.ai/v2/docs/console/go.

A local-model and CLI desktop customization of The-LazyIDE. Original authorship and license files are retained.

## Engines

Fresh profiles use Ollama at `http://127.0.0.1:11434/v1` with `hermes3`.
Settings > Models lets you discover local models or select Codex, Claude Code, or Devin CLI.
CLI authentication stays with the selected CLI. Local chat needs no account or API key.
Hermes provides chat and code suggestions; autonomous coding missions require a CLI.

Hosted login, billing, telemetry and managed model transports are disabled. Cloud tools,
Solari native proxy, hosted development proxies, and the native updater are removed.
Some inert upstream modules and compatibility types remain; no hosted engine is selectable.
Native local-model requests use an HTTP loopback-only streaming bridge with redirects disabled.
The desktop CSP permits generated inline styles for CodeMirror and layout components;
Tauri's automatic CSP rewriting is disabled only for style-src. Script and connection
restrictions remain enabled.

## Build on Windows

Install Rust MSVC, Visual Studio C++ Build Tools, and Node.js. Then in this checkout:

```powershell
npm ci
npm run bundle:node-exe
$env:PATH = "$PWD\src-tauri\resources;$env:PATH"
npm --prefix engine ci
npm --prefix engine run build
npm run bundle:sidecar
npm run tauri -- build --bundles nsis
```

Use a short checkout path (for example `C:\src\lazygt`) when packaging NSIS; nested engine dependencies can exceed the Windows installer path limit.

The bundled Node version is pinned and SHA-256 checked. Install engine dependencies with that
runtime so better-sqlite3 has the same ABI in the installed app. Release builds use bundled
engine resources instead of the development checkout.

For browser development: `npm run dev`, then open http://127.0.0.1:5173/.
Native filesystem, terminal and CLI functions require the desktop app.

## Targeted checks

```powershell
npm run build
npx vitest run src/__tests__/lazygtLocal.test.ts src/__tests__/lazygtManager.test.ts src/__tests__/cliBackendProvider.test.ts src/__tests__/localFetch.test.ts
cargo test --release --lib commands::local_llm::tests --manifest-path src-tauri/Cargo.toml
```

The upstream suite contains tests for removed hosted features and has not been fully migrated.
