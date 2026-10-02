import * as db from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';

describe('lookalike pairs', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString();
  const pay = (amount: number, source: 'SMS' | 'NOTIFICATION', minute: number) =>
    db.addTransaction({
      amount, direction: 'DEBIT', kind: 'SPEND', merchant: `Shop ${minute}`, source, occurredAt: at(minute),
    });

  it('flags the same amount on two channels 35 minutes apart, and nothing else', async () => {
    const first = await pay(38, 'NOTIFICATION', 0);
    const second = await pay(38, 'SMS', 35);
    await pay(50, 'SMS', 0);
    await pay(50, 'SMS', 20); // same channel: two real payments
    await pay(60, 'NOTIFICATION', 0);
    await pay(60, 'SMS', 180); // more than two hours on

    expect(await db.getLookalikePairs(at(0))).toEqual([
      expect.objectContaining({ firstId: first, secondId: second, amount: 38 }),
    ]);

    await db.setTransactionExcluded(second, true);
    expect(await db.getLookalikePairs(at(0))).toEqual([]);
  });
});
