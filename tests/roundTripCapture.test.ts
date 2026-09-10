import * as db from '../src/db/dbService';
import { ingestMessage } from '../src/services/captureService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { CapturedMessage } from '../modules/pinch-capture';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

/**
 * detectRoundTrips (math/transfers.ts) already recognises money sent to a
 * person and returned by that same person — the shape of testing payments
 * back and forth, or an ice-cream-money round-trip where the same two
 * people are on both legs. What was never proven is that it is actually
 * wired up live: that sending someone money and having it come straight
 * back, captured for real through ingestMessage -> postTransaction ->
 * checkForTransferMatch, ends up paired and out of both spending and
 * income within the same session — not just correct at the math layer.
 */
describe('round-trip detection wired to live capture', () => {
  it('pairs a real back-and-forth and drops both legs from spend and income', async () => {
    const at = Date.now();

    const sent: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Sent Rs.200.00 From HDFC Bank A/C x1234 To Shreyas On 08/09/25 Ref 123456789011',
      receivedAt: at,
    };
    expect(await ingestMessage(sent)).toBe('POSTED');

    const receivedBack: CapturedMessage = {
      source: 'NOTIFICATION',
      sender: 'com.phonepe.app',
      body: 'Shreyas sent ₹200 to you. UPI Ref 998877665511',
      receivedAt: at + 30_000,
    };
    expect(await ingestMessage(receivedBack)).toBe('POSTED');

    const all = await db.getAllTransactions();
    expect(all).toHaveLength(2);

    const debit = all.find((row) => row.direction === 'DEBIT')!;
    const credit = all.find((row) => row.direction === 'CREDIT')!;
    expect(debit.transfer_pair_id).toBe(credit.id);
    expect(credit.transfer_pair_id).toBe(debit.id);

    const dayStart = new Date(at - 24 * 60 * 60 * 1000).toISOString();
    const dayEnd = new Date(at + 24 * 60 * 60 * 1000).toISOString();
    expect(await db.getGrossSpendBetween(dayStart, dayEnd)).toBe(0);
    expect(await db.getIncomeBetween(dayStart, dayEnd)).toBe(0);
  });

  it('does not pair a real bill split even when the credit matches in size', async () => {
    // Debit goes to a merchant, the credit comes from a different person
    // reimbursing their share — the split-bill shape detectRoundTrips is
    // deliberately built to leave alone, since erasing it would hide a
    // real expense the user did bear.
    const at = Date.now();

    const paidShop: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Rs.200.00 debited from A/c XX1234 on 08-09-25 to Cream Stone. Avl Bal Rs.4,500.00 -HDFC Bank',
      receivedAt: at,
    };
    expect(await ingestMessage(paidShop)).toBe('POSTED');

    const friendShare: CapturedMessage = {
      source: 'NOTIFICATION',
      sender: 'com.phonepe.app',
      body: 'Priya sent ₹200 to you. UPI Ref 998877665522',
      receivedAt: at + 30_000,
    };
    expect(await ingestMessage(friendShare)).toBe('POSTED');

    const all = await db.getAllTransactions();
    expect(all.every((row) => row.transfer_pair_id === null)).toBe(true);
  });
});
