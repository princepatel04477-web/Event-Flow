/**
 * Manual message provider.
 *
 * Never delivers anywhere — it exists so the app runs without a BSP and the
 * messages page still lets a coordinator copy text for manual WhatsApp send.
 * Messages rows are written with provider='manual' and status='queued', never
 * marked as sent. Adding a real provider means swapping provider.ts, never
 * changing any UI code.
 */

import type { MessageProvider, MessageSendInput, MessageSendResult, MessageSendError, WebhookStatus } from '../provider'

export class ManualProvider implements MessageProvider {
  async send(_input: MessageSendInput): Promise<MessageSendResult | MessageSendError> {
    // The message row was already written as 'queued' with provider='manual'
    // by the action layer. This send is a no-op — the coordinator sends it
    // manually, not through this function.
    return { ok: false, error: 'Manual provider does not send. Copy from the UI.', code: 'config_error' }
  }

  parseWebhook(_body: unknown): WebhookStatus | null {
    return null
  }
}

export const manualProvider: MessageProvider = new ManualProvider()
