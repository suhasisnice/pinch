import * as dbService from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

describe('dbService (real SQLite via sql.js)', () => {
  beforeEach(async () => {
    dbService.__resetDatabaseForTests();
    const adapter = await createSqlJsAdapter();
    await dbService.initDatabase(adapter);
  });

  test('addTransaction inserts a row and returns its id', async () => {
    const id = await dbService.addTransaction(42.5, 'Campus Cafe', 'DEBIT');
    expect(id).toBeGreaterThan(0);

    const row = await dbService.getTransactionById(id);
    expect(row).toMatchObject({ id, amount: 42.5, merchant: 'Campus Cafe', type: 'DEBIT' });
    expect(typeof row?.timestamp).toBe('string');
  });

  test('addTransaction assigns increasing ids across inserts', async () => {
    const id1 = await dbService.addTransaction(10, 'Store A', 'DEBIT');
    const id2 = await dbService.addTransaction(20, 'Store B', 'CREDIT');
    expect(id2).toBeGreaterThan(id1);
  });

  test('createIOU + getOpenIOUs: a new IOU is open by default', async () => {
    const contactId = await dbService.addContact('Alex');
    const txId = await dbService.addTransaction(60, 'Pizza Place', 'DEBIT');

    await dbService.createIOU(txId, contactId, 20);

    const open = await dbService.getOpenIOUs();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      transaction_id: txId,
      contact_id: contactId,
      split_amount: 20,
      is_settled: 0,
    });
  });

  test('getOpenIOUs excludes settled IOUs', async () => {
    const contactId = await dbService.addContact('Sam');
    const txId = await dbService.addTransaction(90, 'Groceries', 'DEBIT');
    await dbService.createIOU(txId, contactId, 30);

    const settled = await dbService.resolveIOUByAmount(30);
    expect(settled).toBe(true);

    const open = await dbService.getOpenIOUs();
    expect(open).toHaveLength(0);
  });

  test('resolveIOUByAmount matches within floating point tolerance', async () => {
    const contactId = await dbService.addContact('Priya');
    const txId = await dbService.addTransaction(33.33, 'Dinner', 'DEBIT');
    await dbService.createIOU(txId, contactId, 11.11);

    // Simulates a repayment credit that's a hair off due to float math.
    const settled = await dbService.resolveIOUByAmount(11.115);
    expect(settled).toBe(true);

    const open = await dbService.getOpenIOUs();
    expect(open).toHaveLength(0);
  });

  test('resolveIOUByAmount returns false when nothing matches', async () => {
    const contactId = await dbService.addContact('Jordan');
    const txId = await dbService.addTransaction(50, 'Concert', 'DEBIT');
    await dbService.createIOU(txId, contactId, 25);

    const settled = await dbService.resolveIOUByAmount(9999);
    expect(settled).toBe(false);

    const open = await dbService.getOpenIOUs();
    expect(open).toHaveLength(1);
  });

  test('resolveIOUByAmount picks the closest match among multiple open IOUs', async () => {
    const contactId = await dbService.addContact('Chris');
    const txId = await dbService.addTransaction(100, 'Trip', 'DEBIT');
    await dbService.createIOU(txId, contactId, 15);
    await dbService.createIOU(txId, contactId, 25);
    await dbService.createIOU(txId, contactId, 35);

    const settled = await dbService.resolveIOUByAmount(24.995);
    expect(settled).toBe(true);

    const open = await dbService.getOpenIOUs();
    expect(open.map((i) => i.split_amount).sort()).toEqual([15, 35]);
  });

  test('addContact / getContacts CRUD', async () => {
    await dbService.addContact('Ghost Friend', true);
    await dbService.addContact('Real Friend', false);

    const contacts = await dbService.getContacts();
    expect(contacts).toHaveLength(2);
    expect(contacts.find((c) => c.name === 'Ghost Friend')?.is_ghost).toBe(1);
    expect(contacts.find((c) => c.name === 'Real Friend')?.is_ghost).toBe(0);
  });

  test('getAllTransactions returns every inserted transaction', async () => {
    await dbService.addTransaction(5, 'A', 'DEBIT');
    await dbService.addTransaction(10, 'B', 'CREDIT');
    await dbService.addTransaction(15, 'C', 'DEBIT');

    const all = await dbService.getAllTransactions();
    expect(all).toHaveLength(3);
  });

  test('functions throw a clear error if called before initDatabase', async () => {
    dbService.__resetDatabaseForTests();
    await expect(dbService.addTransaction(1, 'X', 'DEBIT')).rejects.toThrow(/not initialized/i);
  });
});
