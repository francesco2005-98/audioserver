/**
 * Minimal ID3v2.3 tag writer for the MediaServer track endpoint.
 *
 * DLNA renderers that pull a stream (rather than trusting the controller's DIDL)
 * read now-playing from the audio itself. The engine's ffmpeg output carries no
 * tags, so we prepend an ID3v2 header with the title/artist/album we already
 * resolved for the browse listing. A renderer that ignores ID3 simply skips it
 * (ID3v2 sits before the first MP3 frame and is spec-defined to be skippable),
 * so this is safe for every client.
 *
 * We keep it to text frames (TIT2/TPE1/TALB) encoded as UTF-16 with BOM, which is
 * the most broadly accepted encoding across renderers.
 */
type Id3Fields = {
    title?: string;
    artist?: string;
    album?: string;
};
/**
 * Build an ID3v2.3 tag buffer for the given fields. Returns an empty buffer when
 * there is nothing worth tagging, so callers can prepend unconditionally.
 */
export declare function buildId3v2Tag(fields: Id3Fields): Buffer;
export {};
