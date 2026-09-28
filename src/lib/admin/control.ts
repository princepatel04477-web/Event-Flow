/**
 * The rows of the Control screen (`/{event}/control`), as data.
 *
 * WHY THIS IS A MODULE AND NOT JSX IN THE PAGE. Control is how an admin on a
 * phone reaches every event tool (UI4 Part S) — it replaced the More sheet in
 * the old admin tab bar. The contract "every admin event page is one tap from
 * Control" is only checkable if the rows are data a test can read, the same
 * reason `EVENT_NAV` exists for the desktop sidebar. `tests/admin-nav.test.ts`
 * walks `EVENT_NAV` against this list.
 *
 * Values (counts) and icons are the page's business; this module owns only
 * where each row goes and what it is called.
 */

export type ControlRowKey =
  | 'staff'
  | 'codes'
  | 'import'
  | 'export'
  | 'files'
  | 'hotels'
  | 'send'
  | 'templates'
  | 'sent'
  | 'ledger'
  | 'locks'
  | 'alerts'

export interface ControlRowDef {
  key: ControlRowKey
  href: string
  label: string
  /** Extra words the filter matches ("cod" finds Access codes, "whatsapp" finds Send). */
  keywords: string
}

export interface ControlGroupDef {
  title: string
  rows: ControlRowDef[]
}

export function controlGroups(eventCode: string): ControlGroupDef[] {
  const admin = `/admin/events/${eventCode}`
  return [
    {
      title: 'People',
      rows: [
        { key: 'staff', href: `${admin}/staff`, label: 'Staff', keywords: 'staff people names team department' },
        { key: 'codes', href: `${admin}/codes`, label: 'Access codes', keywords: 'codes access login rotate reveal sign in' },
      ],
    },
    {
      title: 'Guests',
      rows: [
        { key: 'import', href: `/${eventCode}/guests/import`, label: 'Import guest sheet', keywords: 'import excel sheet upload guest list families' },
        { key: 'export', href: `/${eventCode}/guests/export`, label: 'Export to Excel', keywords: 'export excel download sheet' },
        { key: 'files', href: `${admin}/files`, label: 'Files', keywords: 'files exports history downloads' },
      ],
    },
    {
      title: 'Venue',
      rows: [
        { key: 'hotels', href: `${admin}/hotels`, label: 'Hotels & rooms', keywords: 'hotels rooms venue beds import' },
      ],
    },
    {
      title: 'Messages',
      rows: [
        { key: 'send', href: `${admin}/messages/send`, label: 'Send a message', keywords: 'whatsapp send message broadcast' },
        { key: 'templates', href: `${admin}/messages/templates`, label: 'Templates', keywords: 'templates whatsapp message text' },
        { key: 'sent', href: `${admin}/messages/log`, label: 'Sent log', keywords: 'sent log delivered failed messages' },
      ],
    },
    {
      title: 'Records',
      rows: [
        { key: 'ledger', href: `${admin}/ledger`, label: 'Ledger', keywords: 'ledger money payments records' },
      ],
    },
    {
      title: 'Event',
      rows: [
        { key: 'locks', href: `${admin}/settings`, label: 'Section locks', keywords: 'lock sections read only settings' },
        { key: 'alerts', href: `${admin}/settings`, label: 'Arrival alerts', keywords: 'arrival alerts banner notifications settings' },
      ],
    },
  ]
}
