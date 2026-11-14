import crypto from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from '@/shared/utils/file';

const PKCE_TTL_MS = 10 * 60 * 1000;

type PkceEntry = { verifier: string; redirectUri: string; expiresAt: number };
type PkceStore = Record<string, PkceEntry>;

const pkceState = new Map<string, PkceEntry>();

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function pkcePath(): string {
  return resolveDataDir('spotify-pkce.json');
}

function readStore(): PkceStore {
  try {
    const parsed = JSON.parse(readFileSync(pkcePath(), 'utf8')) as PkceStore;
    const now = Date.now();
    const fresh: PkceStore = {};
    for (const [key, entry] of Object.entries(parsed ?? {})) {
      if (entry && entry.expiresAt > now && typeof entry.verifier === 'string') {
        fresh[key] = entry;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeStore(store: PkceStore): void {
  try {
    const file = pkcePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(store));
  } catch {
    // The in-memory copy still completes the flow in this process.
  }
}

export function createPkcePair(
  stateKey: string,
  redirectUri = '',
): { codeChallenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  const entry: PkceEntry = { verifier, redirectUri, expiresAt: Date.now() + PKCE_TTL_MS };
  pkceState.set(stateKey, entry);
  const store = readStore();
  store[stateKey] = entry;
  writeStore(store);
  return { codeChallenge: challenge };
}

export function consumePkceVerifier(
  stateKey: string,
): { verifier: string; redirectUri: string } | undefined {
  const memory = pkceState.get(stateKey);
  pkceState.delete(stateKey);
  const store = readStore();
  const disk = store[stateKey];
  if (store[stateKey]) {
    delete store[stateKey];
    writeStore(store);
  }
  const entry = memory ?? disk;
  if (!entry || entry.expiresAt <= Date.now()) {
    return undefined;
  }
  return { verifier: entry.verifier, redirectUri: entry.redirectUri };
}
