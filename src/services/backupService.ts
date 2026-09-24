import AsyncStorage from '@react-native-async-storage/async-storage';
import { gcm } from '@noble/ciphers/aes';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { getAdapter } from '../db/connection';
import { LATEST_VERSION } from '../db/migrations';

/**
 * Backups: the whole database and Pinch's own settings, in one file the user
 * keeps wherever they like (Drive, Files, a chat with themselves).
 *
 * Pinch is offline and has no account, so this file is the only way history
 * survives a lost phone. It is sealed with AES-256-GCM under a key stretched
 * from a passphrase only the user knows (PBKDF2-SHA256), so wherever the file
 * ends up, it reads as noise without that passphrase. Pinch never stores the
 * passphrase, and cannot recover a forgotten one — the sheet says so.
 *
 * The crypto is @noble/ciphers and @noble/hashes: audited, pure JS, and so
 * the whole format is exercised by the Jest suite, not only on a phone.
 */

export const BACKUP_FORMAT = 'pinch-backup';
export const BACKUP_VERSION = 1;
/** OWASP's 2023 floor for PBKDF2-SHA256 is 600k; this is a phone, but it runs once per backup. */
export const KDF_ITERATIONS = 310_000;
export const MIN_PASSPHRASE = 8;

const SETTINGS_PREFIX = 'pinch.';
/** Device-bound: a restored copy must never carry these across. */
const DEVICE_ONLY_SETTINGS = new Set(['pinch.databaseKey', 'pinch.appLock']);

export interface BackupPayload {
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  settings: Record<string, string>;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  kdf: { name: 'pbkdf2-sha256'; iterations: number; salt: string };
  iv: string;
  data: string;
}

export class BackupError extends Error {
  constructor(
    public readonly reason: 'NOT_A_BACKUP' | 'WRONG_PASSPHRASE' | 'TOO_NEW' | 'SHORT_PASSPHRASE',
    message: string
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  return pbkdf2Async(sha256, new TextEncoder().encode(passphrase.normalize('NFKC')), salt, {
    c: iterations,
    dkLen: 32,
  });
}

export async function sealBackup(
  payload: BackupPayload,
  passphrase: string,
  randomBytes: (n: number) => Uint8Array,
  iterations = KDF_ITERATIONS
): Promise<BackupFile> {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new BackupError(
      'SHORT_PASSPHRASE',
      `Use at least ${MIN_PASSPHRASE} characters for the passphrase.`
    );
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, iterations);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const data = gcm(key, iv).encrypt(plaintext);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: { name: 'pbkdf2-sha256', iterations, salt: toBase64(salt) },
    iv: toBase64(iv),
    data: toBase64(data),
  };
}

export async function openBackup(text: string, passphrase: string): Promise<BackupPayload> {
  let file: BackupFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new BackupError('NOT_A_BACKUP', 'That file is not a Pinch backup.');
  }
  if (file?.format !== BACKUP_FORMAT || file.kdf?.name !== 'pbkdf2-sha256') {
    throw new BackupError('NOT_A_BACKUP', 'That file is not a Pinch backup.');
  }
  if (file.version > BACKUP_VERSION) {
    throw new BackupError('TOO_NEW', 'This backup is from a newer Pinch. Update the app first.');
  }

  const key = await deriveKey(passphrase, fromBase64(file.kdf.salt), file.kdf.iterations);
  let plaintext: Uint8Array;
  try {
    // GCM authenticates as it decrypts: a wrong passphrase or an edited file
    // fails here rather than producing garbage.
    plaintext = gcm(key, fromBase64(file.iv)).decrypt(fromBase64(file.data));
  } catch {
    throw new BackupError('WRONG_PASSPHRASE', 'That passphrase does not open this backup.');
  }
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload;
  if (payload.schemaVersion > LATEST_VERSION) {
    throw new BackupError('TOO_NEW', 'This backup is from a newer Pinch. Update the app first.');
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Collecting and restoring
// ---------------------------------------------------------------------------

async function userTables(): Promise<string[]> {
  const rows = await getAdapter().getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name;`
  );
  return rows.map((r) => r.name);
}

export async function collectBackup(now: Date = new Date()): Promise<BackupPayload> {
  const db = getAdapter();
  const tables: BackupPayload['tables'] = {};
  for (const name of await userTables()) {
    tables[name] = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM "${name}";`);
  }

  const settings: Record<string, string> = {};
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (k) => k.startsWith(SETTINGS_PREFIX) && !DEVICE_ONLY_SETTINGS.has(k)
  );
  for (const [key, value] of await AsyncStorage.multiGet(keys)) {
    if (value !== null) settings[key] = value;
  }

  const version = await db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version;`);
  return {
    schemaVersion: version?.user_version ?? LATEST_VERSION,
    createdAt: now.toISOString(),
    tables,
    settings,
  };
}

/**
 * Replaces everything on this phone with the backup. Only columns that exist
 * in both are copied, so a backup from an older schema restores into the
 * current one with newer columns left at their defaults.
 */
export async function restoreBackup(payload: BackupPayload): Promise<{ rows: number }> {
  const db = getAdapter();
  const current = new Set(await userTables());
  let rows = 0;

  await db.execAsync(`PRAGMA foreign_keys = OFF;`);
  await db.execAsync(`BEGIN;`);
  try {
    for (const name of current) await db.execAsync(`DELETE FROM "${name}";`);
    for (const [name, records] of Object.entries(payload.tables)) {
      if (!current.has(name) || records.length === 0) continue;
      const columns = new Set(
        (await db.getAllAsync<{ name: string }>(`PRAGMA table_info("${name}");`)).map((c) => c.name)
      );
      for (const record of records) {
        const keys = Object.keys(record).filter((k) => columns.has(k));
        if (keys.length === 0) continue;
        await db.runAsync(
          `INSERT INTO "${name}" (${keys.map((k) => `"${k}"`).join(', ')})
           VALUES (${keys.map(() => '?').join(', ')});`,
          keys.map((k) => record[k])
        );
        rows++;
      }
    }
    await db.execAsync(`COMMIT;`);
  } catch (error) {
    await db.execAsync(`ROLLBACK;`);
    throw error;
  } finally {
    await db.execAsync(`PRAGMA foreign_keys = ON;`);
  }

  const settings = Object.entries(payload.settings).filter(
    ([k]) => k.startsWith(SETTINGS_PREFIX) && !DEVICE_ONLY_SETTINGS.has(k)
  );
  if (settings.length > 0) await AsyncStorage.multiSet(settings);
  return { rows };
}

export function backupFileName(now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `pinch-backup-${d}.pinch`;
}

// ---------------------------------------------------------------------------
// Base64 without Buffer (Hermes has btoa/atob; Node 16+ does too)
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
