import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

/**
 * Typed wrapper for the native CallPlugin (see
 * android/app/src/main/java/com/eventops/app/CallPlugin.java).
 *
 * On web this plugin is absent — registerPlugin returns a stub that rejects
 * calls, so the native-call wrapper falls back to tel:. Only the call screen
 * and native-call.ts import this.
 */
export interface CallEndedEvent {
  /** Seconds from OFFHOOK -> IDLE. 0 for an unanswered call. */
  durationSec: number
  /** False when the call never connected (RINGING->IDLE or <5s OFFHOOK). */
  connected: boolean
}

export interface CallPluginType {
  /** Direct dial (ACTION_CALL) when CALL_PHONE granted, else system dialer. */
  dial(options: { phoneNumber: string }): Promise<void>
  /** Begin call-state listening. No-op if READ_PHONE_STATE denied. */
  startListening(): Promise<void>
  addListener(event: 'callStarted'): Promise<PluginListenerHandle>
  addListener(event: 'callEnded', cb: (e: CallEndedEvent) => void): Promise<PluginListenerHandle>
}

export const Call = registerPlugin<CallPluginType>('Call', {
  web: () => {
    // Web stub — matches the native surface but rejects. The caller falls
    // back to tel: before ever invoking this in a browser.
    const noopHandle: PluginListenerHandle = {
      remove: async () => undefined,
    }
    return {
      dial: async () => {
        throw new Error('CallPlugin unavailable on web')
      },
      startListening: async () => undefined,
      addListener: async () => noopHandle,
    } as unknown as CallPluginType
  },
})

export default Call
