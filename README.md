<div align="center">

# Forge

**The local-first AI coding environment.**

One manager. It understands what you want, plans the work, and runs it on
**your** engines: local Ollama models (Hermes 3 bundled) or your own
CLI subscriptions (Claude Code, Codex, Devin). No accounts. No cloud.
No metered credits. Your knowledge never leaves your machine.

</div>

---

## What is Forge?

Forge is a fork of The-LazyIDE, stripped of every hosted dependency and
rebuilt as a standalone local IDE. You brief the manager like a
colleague: *"review my PRs every morning"*, *"keep the test suite
green"*. It plans, spawns missions in isolated worktrees, reviews the
diffs, and reports back on a live canvas. Every decision, pattern, and
bug it touches lands in a **persistent Brain** your whole fleet shares,
so tomorrow's session starts where today's ended.

## What was removed

- **LazyPro / managed ai-proxy** (Supabase, OpenRouter proxy, billing,
  subscriptions, credits, top-ups)
- **BYOK cloud providers** (Anthropic, OpenAI, DeepSeek, OpenRouter, xAI,
  Groq, Mistral direct API rails)
- **Solari cloud computers** (cloud browser / desktop / sandbox tools,
  VM windows, replay downloads)
- **Teams / orgs / fleet presence / canvas co-editing**
- **Auth screens, account tabs, Pro upsells, free-tier rails**

What stays: the mission engine (ReAct loop), the manager, the canvas,
the Brain, bots (on local tools), the assistant composer, and every
local-first surface around them.

## Engines

| Rail | Backend | Cost |
|---|---|---|
| `local` | Ollama / LM Studio on localhost (default: Hermes 3) | $0 |
| `claude-code` | Claude Code CLI subscription | your subscription |
| `codex` | OpenAI Codex CLI subscription | your subscription |
| `devin` | Devin CLI over ACP | your subscription |
| `mock` | Web demo placeholder (browser only) | — |

Model ids: native CLI ids (`claude-sonnet-5`, …), Devin catalog ids
(`swe-2-medium`, …), or `local/<name>` (`local/hermes3`).

## Quick start

Requirements: **Node 20.12+**, **Rust** (https://rustup.rs/),
**Ollama** (https://ollama.com/) with a pulled model.

```bash
npm install          # deps + LazyBrain engine build
ollama pull hermes3  # the bundled default local model
npm run tauri dev    # desktop app, hot-reload
```

Web-only preview (mock data, no Tauri):

```bash
npm run dev
```

First run: open `http://localhost:5173/`, pick **Local** (or your CLI)
in Settings > Models. Paste this in DevTools console to pre-select
Hermes 3:

```js
localStorage.setItem('lazy.local.baseUrl', 'http://localhost:11434/v1');
localStorage.setItem('lazy.local.model', 'hermes3');
localStorage.setItem('forge.accessSettings', JSON.stringify({ accessMode: 'local', model: 'local/hermes3' }));
location.reload();
```

## Verification

```bash
npm run typecheck        # tsc -p tsconfig.app.json — 0 errors
npm run lint              # eslint — 0 errors, 0 warnings
npm test                  # vitest run
npm run build             # tsc -b && vite build
cd src-tauri && cargo check && cargo test
```

## Layout (changed files)

```
src/lib/models/        localProvider.ts (+CLI) only — managed/BYOK/OpenRouter deleted
src/lib/agents/        runtime + ReAct loop route to CLI/local streamers
src/lib/bots/          local-tool bot brains (no cloud computers)
src/lib/brain/         seedExtractor offers local Ollama + Claude CLI
src/components/        account/team/Solari/BYOK UI removed; engine chip in header
src/spaces/            Team space removed
src-tauri/             Solari proxy + replay commands removed; localhost-only CSP
```

Internal names kept on purpose: the `lazy-runnerd` daemon binary,
`LAZY_*` env vars, and `lazy.*` localStorage keys (except the migrated
`forge.accessSettings` / `forge.onboarded`). Renaming a live IPC/storage
protocol buys nothing and breaks upgrades.

## License

[FSL-1.1-ALv2](./LICENSE.md): source-available. Use it at work, fork it,
run it. Don't sell a competing product. Becomes Apache-2.0 after two years.
