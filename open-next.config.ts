import { defineCloudflareConfig } from '@opennextjs/cloudflare'

/**
 * OpenNext adapter config for Cloudflare.
 *
 * Deliberately minimal: no incremental cache, no tag cache, no queue. Every
 * page in this app is dynamic (staff data behind a session), so an ISR cache
 * would sit unused, and each extra binding is another thing to provision
 * before a dry run.
 */
export default defineCloudflareConfig()
