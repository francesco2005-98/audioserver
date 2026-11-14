export declare const Namespaces: {
    readonly HEARTBEAT: "urn:x-cast:com.google.cast.tp.heartbeat";
    readonly CONNECTION: "urn:x-cast:com.google.cast.tp.connection";
    readonly RECEIVER: "urn:x-cast:com.google.cast.receiver";
    readonly MEDIA: "urn:x-cast:com.google.cast.media";
};
export type KnownNamespace = (typeof Namespaces)[keyof typeof Namespaces];
