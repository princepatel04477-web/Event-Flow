/**
 * Re-export. The canonical fleet screen lives under `logistics/fleet`, which
 * is where `SECTIONS` and `AttentionPanel` both point. This flat route is a
 * survivor of the five-section restructure and kept only so existing links
 * and bookmarks do not 404.
 *
 * It was a byte-identical copy until now; two copies of a screen drift, and
 * this one had already stopped being the one anybody opened.
 */
export { FleetClient } from '../logistics/fleet/FleetClient'
