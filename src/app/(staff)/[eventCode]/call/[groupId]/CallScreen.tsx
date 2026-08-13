'use client'

// Thin route wrapper. The real CallScreen lives in src/components/call/CallScreen.tsx.
// This file only re-exports so the route keeps its import path. No logic here.

export {
  CallScreen as default,
  CallScreen,
  type CallScreenProps,
} from '@/components/call/CallScreen'
