import { randomBytes } from 'crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import * as db from '../src/db/dbService';
import {
  BackupError,
  collectBackup,
  openBackup,
  restoreBackup,
  sealBackup,
} from '../src/services/backupService';
import { __resetStorage } from './mocks/async-storage';

const random = (n: number) => new Uint8Array(randomBytes(n));
// Tests use a light KDF; the app uses KDF_ITERATIONS.
const FAST = 1000;
const PASS = 'correct horse battery';

async function freshDb() {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
}

async function seed() {
  await db.addTransaction({
    amount: 450,
    direction: 'DEBIT',
    kind: 'SPEND',
    merchant: 'Swiggy',
    category: 'Food',
    occurredAt: '2026-09-20T12:00:00.000Z',
    source: 'MANUAL',
    rawText: null,
    externalRef: null,
    dedupKey: 'swiggy-1',
    outingId: null,
  });
  const goalId = await db.createGoal({ name: 'Goa trip', targetAmount: 8000, emoji: 'beach' });
  await db.contributeToGoal(goalId, 1200, 'MANUAL');
  await AsyncStorage.setItem('pinch.monthlyAllowance', '15000');
  await AsyncStorage.setItem('pinch.databaseKey', 'must-not-travel');
}

beforeEach(async () => {
  __resetStorage();
  await freshDb();
});

describe('backup round trip', () => {
  it('restores the ledger, goals and settings onto a fresh phone', async () => {
    await seed();
    const file = await sealBackup(await collectBackup(), PASS, random, FAST);

    // A new phone: empty database, no settings.
    __resetStorage();
    await freshDb();
    expect(await db.getActiveGoals()).toHaveLength(0);

    const payload = await openBackup(JSON.stringify(file), PASS);
    const { rows } = await restoreBackup(payload);
    expect(rows).toBeGreaterThan(0);

    const goals = await db.getActiveGoals();
    expect(goals.map((g) => [g.name, g.savedAmount])).toEqual([['Goa trip', 1200]]);
    const txns = await db.getTransactionsBetween(
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z'
    );
    expect(txns.map((t) => t.merchant)).toContain('Swiggy');
    expect(await AsyncStorage.getItem('pinch.monthlyAllowance')).toBe('15000');
  });

  it('never carries the device database key across', async () => {
    await seed();
    const payload = await collectBackup();
    expect(payload.settings['pinch.databaseKey']).toBeUndefined();
  });

  it('keeps nothing readable in the file', async () => {
    await seed();
    const text = JSON.stringify(await sealBackup(await collectBackup(), PASS, random, FAST));
    expect(text).not.toContain('Swiggy');
    // Base64 has no spaces, so a phrase with one can only appear if it leaked.
    expect(text).not.toContain('Goa trip');
  });
});

describe('opening a backup', () => {
  it('refuses a wrong passphrase', async () => {
    const file = await sealBackup(await collectBackup(), PASS, random, FAST);
    await expect(openBackup(JSON.stringify(file), 'wrong passphrase')).rejects.toMatchObject({
      reason: 'WRONG_PASSPHRASE',
    });
  });

  it('refuses a file that was edited', async () => {
    const file = await sealBackup(await collectBackup(), PASS, random, FAST);
    const bytes = atob(file.data).split('');
    bytes[10] = String.fromCharCode(bytes[10].charCodeAt(0) ^ 1);
    const tampered = { ...file, data: btoa(bytes.join('')) };
    await expect(openBackup(JSON.stringify(tampered), PASS)).rejects.toBeInstanceOf(BackupError);
  });

  it('refuses something that is not a backup', async () => {
    await expect(openBackup('{"hello":1}', PASS)).rejects.toMatchObject({
      reason: 'NOT_A_BACKUP',
    });
    await expect(openBackup('not json', PASS)).rejects.toMatchObject({ reason: 'NOT_A_BACKUP' });
  });

  it('refuses a short passphrase when sealing', async () => {
    await expect(sealBackup(await collectBackup(), 'short', random, FAST)).rejects.toMatchObject({
      reason: 'SHORT_PASSPHRASE',
    });
  });
});

describe('erase everything', () => {
  it('leaves no personal rows behind in any table', async () => {
    await seed();
    await db.createHolding({ name: 'Nifty 50', kind: 'MUTUAL_FUND', sipAmount: 1000, sipDay: 5 });
    await db.recordNetWorth(12000, new Date());
    await db.markMilestone('FIRST_1K', new Date());

    await db.resetData({
      ledger: true,
      periods: true,
      contacts: true,
      goals: true,
      outings: true,
      blocklist: true,
      personal: true,
    });

    const payload = await collectBackup();
    // MerchantRules is the shipped rule list, re-seeded on every launch.
    const leftovers = Object.entries(payload.tables).filter(
      ([name, rows]) => name !== 'MerchantRules' && rows.length > 0
    );
    expect(leftovers.map(([name]) => name)).toEqual([]);
  });
});
