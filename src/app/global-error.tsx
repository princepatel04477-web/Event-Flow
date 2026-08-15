'use client'

import { useEffect } from 'react'

/**
 * The last resort: a throw in the ROOT layout itself.
 *
 * This boundary replaces the entire document, so it has to ship its own
 * `<html>` and `<body>` — the root layout is exactly what failed, so none of
 * its markup, its font variables or its stylesheet link can be assumed. That
 * is also why the styling here is inline rather than Tailwind: if the CSS
 * never loaded, utility classes render nothing and the user is back to a
 * white page, which is the thing this file exists to prevent.
 *
 * Colours are the staff ground hard-coded, because the token layer lives in
 * the stylesheet that may not be there.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Root layout failed:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          padding: '40px 24px',
          textAlign: 'center',
          background: '#071A1D',
          color: '#EDF3F2',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 500 }}>
          EventFlow could not start
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: '32ch',
            fontSize: '16px',
            lineHeight: 1.5,
            color: '#8FA9AE',
          }}
        >
          The app failed before it could draw anything. Reload, and if it keeps
          happening send your admin the reference below.
        </p>
        {error.digest ? (
          <p
            style={{
              margin: 0,
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              fontSize: '12px',
              color: '#8FA9AE',
            }}
          >
            Reference {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: '56px',
            width: '100%',
            maxWidth: '320px',
            border: 0,
            borderRadius: '14px',
            background: '#C9A96B',
            color: '#071A1D',
            font: '600 16px/1 system-ui, -apple-system, sans-serif',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  )
}
