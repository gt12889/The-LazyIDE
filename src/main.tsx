import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (D10): npm packages, bundled by Vite — no runtime
// dependency on Google Fonts/any CDN (required for the offline-capable
// Tauri desktop app). Only the weights the design system actually uses.
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'
import './index.css'
import App from './App.tsx'
// QA fix (B3): re-apply the user's persisted accent-color choice (if any)
// before the first render, so there is no flash of the design system's
// default violet — see src/lib/theme/accentTheme.ts.
import { initAccentOnBoot } from './lib/theme/accentTheme'
// Memory-pressure hardening: install window.onerror/unhandledrejection
// capture BEFORE createRoot, so even a crash during the very first render
// (or a render-crash-loop) is journaled — see src/lib/crashReporter.ts.
import { installCrashReporter } from './lib/crashReporter'
// Memory-pressure hardening: watch the renderer's own JS heap and emit
// lazy:memory-pressure so consumers can shed state before an OOM crash —
// see src/lib/agents/memoryGuardian.ts.
import { startMemoryGuardian } from './lib/agents/memoryGuardian'
// i18n flash fix: preload the detected locale's dictionary before the first
// render so a non-eager locale (de/es/ja/zh) never paints the fallback for
// a few hundred ms — see preloadDetectedLocale's doc comment.
import { preloadDetectedLocale } from './i18n'
// Pre-warm manager critical-path dependencies (core prompt + project root)
// AFTER first render — see prewarm.ts's doc comment for what/why.
import { prewarmManager } from './lib/agents/prewarm'

installCrashReporter()
startMemoryGuardian()
initAccentOnBoot()

async function bootstrap(): Promise<void> {
  try {
    await preloadDetectedLocale()
  } catch (err: unknown) {
    console.error('[main] preloadDetectedLocale failed', err instanceof Error ? err.message : String(err))
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  // Fire-and-forget: pre-warm the manager's core prompt (~120KB string
  // build) and project root IPC cache so the first user message's critical
  // path is shorter. Runs AFTER render so it never blocks first paint.
  prewarmManager()
}

void bootstrap()
