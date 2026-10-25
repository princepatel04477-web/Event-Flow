// The read-only family page, borrowed from v2 so v1's guest list has somewhere
// to send a tap that does NOT take the caller lock. The list used to link to
// `rsvp/status/[groupId]`, whose render calls `claimGroupForCall` — so just
// browsing a guest locked that family against callers for 15 minutes, with no
// override (CLAUDE.md §11b, BUG-HUNT-2026-10-25 #7). Every link this page
// emits (`rsvp/call`, `rsvp/status`, `hamper`, `hospitality/*`,
// `logistics/arrivals`, `rsvp/queue`) has a v1 route.
export * from '@/app/(app)/v2/[eventCode]/families/[groupId]/page'
export { default } from '@/app/(app)/v2/[eventCode]/families/[groupId]/page'
