/**
 * Model string this server puts on its own AirPlay advertisement.
 *
 * Discovery skips that model, so a room is not offered as a speaker of itself.
 * The advertised value and the skip check have to be the same string: they used
 * to be written twice and a rename made them disagree, which let the server
 * discover its own receiver.
 */
export const OWN_AIRPLAY_MODEL = 'AudioserverCoreAirplay';

export function isOwnAirplayModel(model: string | undefined | null): boolean {
  return (model ?? '').trim().toLowerCase() === OWN_AIRPLAY_MODEL.toLowerCase();
}

/**
 * AirPlay puts the device model in the TXT key `am`. Some browsers also surface a
 * `model` key. Either one is enough to recognise this server's own receiver.
 */
export function airplayModelFromTxt(txt: Record<string, unknown> | undefined): string {
  if (!txt) {
    return '';
  }
  if (typeof txt.model === 'string' && txt.model.trim()) {
    return txt.model;
  }
  if (typeof txt.am === 'string') {
    return txt.am;
  }
  return '';
}
