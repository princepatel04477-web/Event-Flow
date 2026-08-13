/**
 * Re-export. The canonical departures board lives under
 * `logistics/departures`, which is where `SECTIONS` and `AttentionPanel`
 * point. This flat route survives the five-section restructure so existing
 * links do not 404.
 */
export { DeparturesBoard, type DeparturesBoardProps } from '../logistics/departures/DeparturesBoard'
