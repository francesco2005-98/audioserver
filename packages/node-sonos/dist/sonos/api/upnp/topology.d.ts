import type { ZoneGroup } from './models';
import { type CallActionOptions } from './soap';
/** Ask a speaker for the household topology. Any speaker answers for all of them. */
export declare function getZoneGroups(host: string, options?: CallActionOptions): Promise<ZoneGroup[]>;
/**
 * Parse a ZoneGroupState document. Accepts the `<ZoneGroupState>` wrapper, the bare
 * `<ZoneGroups>` list, or either still XML-escaped.
 */
export declare function parseZoneGroups(xml: string): ZoneGroup[];
