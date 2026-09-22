# lazygt

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
