# lazygt: reliable daily coding milestone

Status: proposed plan; no roadmap features implemented. Reviewed 2026-09-21 against implementation commit 63eb921.

## Overview

Make lazygt a dependable personal Windows IDE: open a repository, choose a working local or CLI engine, make a change, inspect the diff, run checks, and retain control of the result. Keep local chat free of hosted accounts. CLI subscriptions and authentication remain with the selected CLI.

Assumptions: Windows desktop is the primary product; Ollama/Hermes handles chat, and Codex or Claude handles coding missions. Reliability takes priority over adding more agent modes. Browser development remains useful but cannot substitute for installed-app validation.

## Evidence and improvement review

| Priority | Finding | Evidence | Proposed improvement |
| --- | --- | --- | --- |
| P0 | Engine settings can accept configurations rejected by the native transport; checking a connection also saves settings. | `src/components/settings/LocalCliSettings.tsx` accepts HTTP/HTTPS and calls `persist()` during check; `src-tauri/src/commands/local_llm.rs` accepts HTTP and exact `/v1` model routes only. | Share an explicit endpoint contract; test draft settings without mutating active settings; preserve the last working engine. |
| P0 | CLI selection does not show installation/authentication readiness. | Settings renders a static Claude/Codex/Devin selector; existing readiness helpers are separate and retain hosted-provider concepts. | Detect installed CLIs, distinguish missing/auth-required/ready/error states, and perform an opt-in smoke check. |
| P0 | The primary coding workflow is not yet proven end to end. | Installed local chat/editor and standalone Codex passed manual checks; a complete native CLI mission was not tested. | Exercise task launch, edits, test output, cancellation, restart, and review in a disposable fixture repository. |
| P0 | Build-tool vulnerabilities and stale CI need attention. | Root `npm audit` reports 11 affected packages: 2 critical, 5 high, 4 moderate; `npm audit --omit=dev` reports zero. Critical entries are Vitest and coverage tooling. `.github/workflows/ci.yml` uses Node 20, hosted test config, and the unmigrated upstream suite. | Upgrade compatible toolchain versions in controlled steps; migrate tests and pin the supported runtime. Audit `engine` separately; root results do not cover the bundled sidecar. |
| P1 | Release packaging requires manual workarounds. | Installed build succeeded, but NSIS required a short path and the native engine requires the bundled Node ABI; see `README.lazygt.md`. | One reproducible Windows packaging command and a clean-runner installer smoke test. |
| P1 | Disabled product surfaces remain in source and navigation. | Team remains in `TopNav.tsx`; readiness includes BYOK/Pro messages; package.json retains updater and type-only hosted SDK packages. | Trace callers, remove dead modules/dependencies and unavailable navigation, migrate relevant tests, preserve attribution. |
| P1 | Agent state is hard to safely change. | `src/components/agents/agentsStore.tsx` contains 16,181 lines. | Extract lifecycle, persistence, scheduling, and provider adapters behind tested boundaries, one slice at a time. |
| P1 | Streaming lifecycle needs broader fault coverage. | `localFetch.ts` and native bridge cover streaming and cancellation; Rust registers cancellation after command entry. | Test immediate abort, partial output, timeout, server exit, duplicate events, and resource cleanup. These are risk areas, not confirmed user-visible failures. |
| P2 | Memory/runtime footprint has not been measured. | Sidecar bundles SQLite, transformers and ONNX dependencies; installer is approximately 196 MB. | Measure startup/idle memory/indexing before changing packaging or making indexing lazy. |

GitHub main independently contains two Forge commits (8496232, e4de5d5). lazygt is on `lazygt/local-cli` to preserve both histories. Compare useful Forge discovery changes before selectively porting them; do not blindly merge branding/configuration.

## Goals and success metrics

1. A fresh installed profile opens a repository and reaches verified local chat without a hosted login.
2. Every displayed engine has a truthful readiness state and supported-capability label.
3. Ten consecutive fixture coding runs preserve existing user edits and produce inspectable diffs and check results; real-model output correctness is evaluated separately from deterministic adapter tests.
4. Cancellation stops child work within five seconds in the fixture and leaves no orphan process after shutdown.
5. A clean Windows runner produces an installable artifact using documented commands, without manual source-path edits.
6. No untriaged critical/high dependency findings at release; distinguish development tooling from shipped engine dependencies.
7. Collect startup, idle memory, and first-token baselines on the user's machine before setting performance budgets.

## User stories and acceptance criteria

### US-01 — Configure a working engine (P0)

As a user, I can test an engine and understand whether it supports chat or coding missions.

- Validate protocol, host, credentials, query, and path consistently in UI and Rust.
- Connection tests operate on drafts; failed tests and Cancel leave active settings intact.
- Show installed CLI version and readiness without reading or displaying credential values.
- Preserve the user's chosen engine; recommend a detected working CLI instead of silently switching.
- Missing models, stopped Ollama, missing CLI, expired CLI auth, and unsupported browser mode have actionable messages.
- Typecheck and relevant unit tests pass.
- Verify in browser using dev-browser skill when available; otherwise use the available browser tool. Also verify the installed Windows app, where native routing differs.

### US-02 — Complete and review a coding task (P0)

As a user, I can run a CLI task, inspect its changes and checks, and decide what to keep.

- Reuse existing worktree, diff, approval, and mission-scope facilities; map them before adding new ones.
- Run in a disposable fixture with an intentional uncommitted user edit; the edit remains untouched.
- Display actual tool output and test exit status; failed checks cannot appear as successful completion.
- Cancellation, CLI exit, and app restart produce explicit recoverable states.
- Review UI identifies changed files, originating task, and repository; no automatic commit/push.
- Any discard action is scoped to the task and cannot erase pre-existing edits.
- Deterministic adapter tests plus one real Codex and one real Claude run when authenticated; unavailable engines are documented, not reported as passed.
- Verify in browser using dev-browser skill when available, plus mandatory installed-app verification.

### US-03 — Build and install confidently (P0/P1)

As a maintainer, I can reproduce the release from a clean checkout.

- Upgrade Vite/Vitest/esbuild and related dependencies with migration review, not a blind forced audit fix.
- Run root and engine audits and record shipped versus development impact.
- CI exercises supported local/CLI behavior and has no mandatory hosted account configuration.
- Pin supported Node tooling and build native sidecar dependencies with the bundled Node ABI.
- Package from a short staging directory automatically; verify artifact checksums and fresh-profile startup/editor/local chat.
- Typecheck, migrated tests, native tests, and release build pass; document any quarantined tests with rationale and owner.

### US-04 — Simplify the product (P1)

As a user, I see features that work in this edition.

- Inventory and remove unavailable Team/cloud/billing navigation and obsolete help text after tracing callers.
- Delete inert hosted dependencies only after type references and tests are migrated.
- Retain licenses and upstream attribution; review package/Cargo metadata consistency before distribution.
- Centralize local/CLI capability definitions used by settings, pickers, manager, and mission launch.
- Verify in browser using dev-browser skill when available and verify desktop navigation.

### US-05 — Keep the IDE responsive and recoverable (P1/P2)

As a user, I can diagnose failures and return to work after restart.

- Add a diagnostics view for app/runtime version, selected engine, health checks, and recent errors with secrets redacted.
- Verify session restore, unsaved-buffer recovery, external file changes, and terminal lifecycle; repair failures found before adding new editor features.
- Profile startup and indexing with small and large fixture repositories; bound indexing concurrency and expose Pause only if profiling justifies it.
- Extract one agent-store subsystem per change with lifecycle regression coverage; avoid a wholesale rewrite.
- Verify in browser using dev-browser skill when available, plus native restart and process-lifecycle checks.

## Functional requirements

FR-1: Only local and installed CLI engines are selectable; unsupported capabilities are blocked before launch.

FR-2: Active settings and unsaved drafts are distinct. Validation matches the actual transport contract.

FR-3: Every task exposes engine, repository, state, output, changed files, and check results.

FR-4: Cancellation and shutdown clean up model requests and owned child processes.

FR-5: Repository changes remain reviewable and user-controlled; existing work is preserved.

FR-6: CI and release packaging reproduce the supported Windows application without original hosted services.

FR-7: Diagnostics stay local and redact credentials; no telemetry is introduced.

## Build sequence and estimates

Rough engineering-day estimates for one developer, excluding model downloads and account setup; refine after each acceptance gate.

| Phase | Work | Estimate | Exit gate |
| --- | --- | --- | --- |
| 1 | US-01 endpoint contract, draft settings, readiness; initial US-03 dependency/CI cleanup | 3–5 days | Fresh-profile setup and supported tests pass |
| 2 | US-02 coding task, diff/check visibility, abort/restart and preservation tests | 4–7 days | Fixture task workflow passes; real CLI results recorded |
| 3 | US-03 repeatable Windows installer and US-04 dead surface removal | 3–5 days | Clean build/install; no unavailable navigation |
| 4 | US-05 diagnostics, recovery fixes, profiling, first agent-store extraction | 4–7 days | Measured baseline and recovery tests pass |

Start phase 2 after the relevant engine is reliably detected. Start structural refactoring after mission behavior is covered. Packaging work can proceed independently once the toolchain is stable. Estimated milestone: 14–24 engineering days, not a delivery promise.

## Design and technical considerations

Use the existing settings layout and editor/diff panels. Put the selected engine and its capabilities near the composer. Prefer explicit task states (starting, running, awaiting input, cancelling, complete, failed) to generic spinners. Reuse existing readiness and worktree logic where sound, but remove hosted assumptions.

Retain the loopback-only native bridge and restrictive connection policy. Keep CodeMirror's narrowly scoped inline-style allowance and test installed production assets; browser success previously missed native rendering failures. Keep CLI authentication delegated to the CLI. Local model tool-calling should be a later capability-gated experiment with explicit unsupported states.

## Non-goals

- Hosted Lazy/Forge accounts, billing, managed compute, team sync, or telemetry.
- New cloud providers or automatic purchases/subscriptions.
- Fully autonomous local Hermes missions before a tool-calling evaluation passes.
- A replacement editor engine, marketplace, or broad agent-store rewrite.
- Automatic merge into the divergent Forge main branch.

## Open questions and later options

These do not block phases 1–2: decide which branch/product should become main; whether distribution is personal-only or public; whether Claude needs equal priority to Codex; and which hardware baseline should define performance budgets.

After the milestone, consider repository-aware local chat with source citations, task templates tied to existing check commands, model-specific context limits, and richer language diagnostics. Evaluate each against daily coding friction before expanding the canvas or adding more agent types.

## Validation limits of this review

Evidence combines source inspection, existing targeted results (15 tests), successful frontend/native release builds, installed chat/editor checks, standalone Codex verification, and current root dependency audits. The complete upstream suite, full native autonomous workflow, engine dependency audit, and performance benchmark were not completed. This is an engineering roadmap, not a comprehensive UX or security audit.
