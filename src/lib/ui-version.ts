export type UiVersion = 'v1' | 'v2'

/**
 * Reads the active UI version from NEXT_PUBLIC_UI ('v1' default, 'v2' new).
 */
export function getUiVersion(): UiVersion {
  return process.env.NEXT_PUBLIC_UI === 'v2' ? 'v2' : 'v1'
}
