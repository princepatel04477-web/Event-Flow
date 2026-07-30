---
tags: [decisions, architecture]
updated: 2026-07-31
status: locked
---

# Stack Decisions

Back to [[EventFlow]].

> [!warning] Locked
> These are settled. Do not re-open them mid-build; the deadline has no room for a stack change.

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind |
| Backend | Supabase — Postgres, Auth, Storage, Edge Functions, Realtime |
| Mobile | PWA first, then **Capacitor** wrap into an APK |
| Distribution | APK over WhatsApp. **No Play Store submission.** |
| Excel | SheetJS, import + export only |
| STT | Sarvam Saarika or Google STT v2 (gu-IN, hi-IN, en-IN) |
| Extraction | Claude → strict JSON with per-field confidence |

## Capacitor, not Expo

Capacitor wraps the existing Next.js web app. Expo would mean learning React Native under
deadline pressure and maintaining a second UI. The only genuinely native thing needed is
call recording — see [[Open Questions]] — and that is one plugin, not a second app.

## Postgres is truth, Excel is an interface

Excel goes in and Excel comes out, but nothing about the system depends on a spreadsheet
being correct or being the latest copy. Exported rows carry hidden ids so a re-import
matches rather than duplicating. See [[Excel Import]].

## No custom dialer

`tel:` deep link plus one-tap outcome logging — Confirmed / Declined / No answer /
Callback / Wrong number. Building a dialer is a category of work nobody needs. The
consequence is a real trap around page state, documented in [[Known Traps]].

## Offline-first for field screens

IndexedDB outbox queue that drains when signal returns. Venue Wi-Fi will fail; this is not
a hypothetical. Applies to the call screen, hamper capture, and check-in.

## Mobile-first, always

Base font 16px, tap targets ≥44px, sticky header, works on a cheap Android phone on bad
venue Wi-Fi. Test on a real phone, not the laptop browser.

## Related

[[Project Brief]] · [[Roadmap]] · [[Supabase Project]]
