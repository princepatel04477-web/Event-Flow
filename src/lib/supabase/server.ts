// M2: static export — no server. Re-export client for import-compat only.
// Any code that still calls createClient() via this module will get a client.

export { createClient } from './client'
