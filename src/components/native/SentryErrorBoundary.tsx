'use client'

import * as Sentry from '@sentry/react'

/**
 * Recoverable error boundary. Shows a "tap to reload" card instead of a
 * white WebView when an unhandled error escapes a screen. Reports to Sentry
 * with the user/event tags already set by setSentryContext().
 */
export function SentryErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
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
              onClick={resetError}
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
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  )
}

export default SentryErrorBoundary
