declare module 'dns-packet' {
  export type Txt = Buffer | string;
  export type Record = {
    name: string;
    type: string;
    ttl?: number;
    class?: string;
    flush?: boolean;
    data?: Txt | Txt[] | { port: number; priority?: number; weight?: number; target: string } | string;
  };
  export type Packet = {
    type?: string;
    questions?: Array<{ name?: string; type?: string }>;
    answers?: Record[];
  };
  export function encode(packet: Packet): Buffer;
  export function decode(buffer: Buffer): Packet;
}
