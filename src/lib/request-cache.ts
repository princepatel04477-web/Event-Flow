// M2: static export — no server-side React cache. Passthrough only.

export async function perRequest<T>(_key: string, fn: () => Promise<T>): Promise<T> {
  return fn()
}

export function perRequestSize(): number {
  return 0
}
