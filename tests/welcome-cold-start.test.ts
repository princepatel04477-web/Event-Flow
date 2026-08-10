import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The anti-replay contract for the cold-start welcome.
 *
 * The DoD item "returning from the dialer does NOT replay the welcome" rests
 * entirely on `claimWelcome()` returning true exactly once per WebView
 * session. Asserting that in a browser means racing a 320ms animation, which
 * is flaky; asserting it here is exact. WelcomeOverlay renders the overlay if
 * and only if this function returned true, so proving the claim proves the
 * behaviour.
 *
 * The module reads `window.sessionStorage`, so each test installs a fake
 * `window` and re-imports the module with a fresh registry.
 */

type Store = Record<string, string>

function installWindow(storage: {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
}) {
  vi.stubGlobal('window', { sessionStorage: storage })
}

/** A working sessionStorage, backed by a plain object. */
function fakeStorage(initial: Store = {}) {
  const store: Store = { ...initial }
  return {
    store,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
  }
}

/** Fresh module instance, so no state leaks between tests. */
async function loadModule() {
  vi.resetModules()
  return import('@/lib/motion/cold-start')
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('claimWelcome', () => {
  it('returns true exactly once, then false for the rest of the session', async () => {
    installWindow(fakeStorage())
    const { claimWelcome } = await loadModule()

    expect(claimWelcome()).toBe(true)
    // Every subsequent call is a navigation, a remount, or a reload after the
    // dialer stole the WebView. None of them may replay the animation.
    expect(claimWelcome()).toBe(false)
    expect(claimWelcome()).toBe(false)
    expect(claimWelcome()).toBe(false)
  })

  it('does not replay when storage already carries the claim (the dialer case)', async () => {
    // A reload inside the same WebView: page state is gone, sessionStorage is
    // not. This is exactly what returning from `tel:` looks like.
    installWindow(fakeStorage({ 'nuvent.welcome.played': '1' }))
    const { claimWelcome } = await loadModule()

    expect(claimWelcome()).toBe(false)
  })

  it('plays again once the WebView is genuinely new', async () => {
    // Android killed the activity, so sessionStorage starts empty. That is a
    // real cold start and the welcome SHOULD play.
    installWindow(fakeStorage())
    const { claimWelcome } = await loadModule()

    expect(claimWelcome()).toBe(true)
  })

  it('fails closed when sessionStorage throws', async () => {
    // Blocked storage must suppress the welcome, never replay it on every
    // navigation — see the note in lib/motion/cold-start.ts.
    installWindow({
      getItem: () => {
        throw new Error('storage blocked')
      },
      setItem: () => {},
      removeItem: () => {},
    })
    const { claimWelcome } = await loadModule()

    expect(claimWelcome()).toBe(false)
    expect(claimWelcome()).toBe(false)
  })

  it('is server-safe', async () => {
    // No `window` at all: the module must not throw during SSR, and must
    // report false so server and client render the same empty tree.
    vi.stubGlobal('window', undefined)
    const { claimWelcome } = await loadModule()

    expect(claimWelcome()).toBe(false)
  })
})

describe('resetWelcomeClaim', () => {
  it('lets the welcome play again (the /debug replay button)', async () => {
    installWindow(fakeStorage())
    const { claimWelcome, resetWelcomeClaim } = await loadModule()

    expect(claimWelcome()).toBe(true)
    expect(claimWelcome()).toBe(false)

    resetWelcomeClaim()
    expect(claimWelcome()).toBe(true)
  })

  it('does not throw when storage is blocked', async () => {
    installWindow({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('storage blocked')
      },
    })
    const { resetWelcomeClaim } = await loadModule()

    expect(() => resetWelcomeClaim()).not.toThrow()
  })
})
