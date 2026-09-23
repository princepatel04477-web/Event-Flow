'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Recoverable error boundary. Shows a "tap to reload" card instead of a
 * white WebView when an unhandled error escapes a screen. Reports to Sentry
 * with the user/event tags already set by setSentryContext().
 *
 * ── WHY THIS IS A LOCAL BOUNDARY AND NOT `Sentry.ErrorBoundary` ─────────────
 *
 * It used to be Sentry's, imported at the top of the file. This component is
 * mounted by the ROOT layout, so that import put `@sentry/react` — the SDK core
 * plus its React wrapper, ~66 KB of JavaScript raw — into the first load of
 * EVERY route in the app, including all seven job screens a runner uses on a
 * phone on venue Wi-Fi. Measured 2026-09-24: the two chunks carrying it
 * (`3jae-i7lmr_ke.js` and this component's own chunk) are on all seven.
 *
 * For what? The card below. The card is the job. Reporting was already dead
 * cargo: `initSentry()` was only ever called from a `if (typeof window !==
 * 'undefined')` block in `src/app/layout.tsx`, which is a SERVER component, so
 * that branch is false on the server and the module is not shipped to the client
 * at all — confirmed by reading it, and the reason `captureDiagnostic()`'s own
 * `if (!initialized || !DSN) return` guard has always returned early.
 *
 * So the boundary is now React's own, which is the entire API a boundary needs,
 * and the SDK is imported on the ERROR path instead of on the happy one. The
 * fallback UI, the props and `resetError` are unchanged; an error is still
 * offered to Sentry, from `src/lib/sentry.ts`, and a deployment with no DSN
 * still does nothing — exactly as before.
 */
export function SentryErrorBoundary({ children }: { children: React.ReactNode }) {
  return <Boundary>{children}</Boundary>
}

type Props = { children: ReactNode }
type State = { failed: boolean }

class Boundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Loaded here, and only here. A reporting failure must never replace the
    // card the runner needs — hence the catch, and hence `void`.
    void import('@/lib/sentry')
      .then(({ captureError }) => captureError(error, info.componentStack ?? null))
      .catch(() => {
        /* the fallback card is the contract; reporting is best-effort */
      })
  }

  private resetError = (): void => {
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f5ead8',
          color: '#201e1d',
          fontFamily: 'Figtree, system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'Caprasimo, Georgia, serif', fontSize: 24, margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 20px', color: '#4a5568' }}>
            The event team has been notified. Tap to reload and carry on.
          </p>
          <button
            onClick={this.resetError}
            style={{
              minHeight: 48,
              padding: '0 24px',
              borderRadius: 999,
              border: 'none',
              background: '#201e1d',
              color: '#f6efe1',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

export default SentryErrorBoundary
