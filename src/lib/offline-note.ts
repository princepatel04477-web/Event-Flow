/**
 * The one sentence a runner needs when the signal drops, in the words
 * CLAUDE.md §11b quotes.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT A CONSTANT IN A SCREEN. The banner is
 * rendered once, by the ROOT layout, so that it exists on every route —
 * including `/login`, `/pick-staff` and `/admin`, which are not inside the new
 * UI's shell. The v2 shell used to render its own copy with this note and the
 * root layout skipped its own under v2; that fixed a double banner and broke the
 * pre-auth screens, which are exactly where a staff member with no signal is
 * most likely to be standing (V11 shipped that, R1 found it).
 *
 * ONE BANNER, ONE PLACE, NOTE PASSED IN. `src/components/native/OfflineBanner.tsx`
 * is shared with the live v1 app, whose output must not change, so it takes an
 * optional `offlineNote` and v1 passes nothing. Reading the UI flag inside the
 * banner would have been the tempting shortcut and the wrong one: the value is
 * INLINED AT BUILD TIME in a client bundle while the proxy reads it at RUNTIME,
 * so a build with the flag unset could ship a banner that believes it is v1
 * while the server routes as v2. The root layout is a server component and reads
 * it at request time, so it cannot disagree with the proxy.
 *
 * The words are not paraphrased. A runner who reloads during a Wi-Fi drop lands
 * on `offline.html` with nothing behind it, and "don't reload and don't press
 * back" is the single instruction that prevents it.
 */
export const V2_OFFLINE_NOTE =
  "If the app stops responding, don't reload and don't press back. Wait. Whatever is on your screen still works, and anything you already saved will send itself when the signal comes back."
