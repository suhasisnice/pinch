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

describe('payment method, category and failed status wired to live capture', () => {
  it('captures a card purchase with its category, subcategory and payment method', async () => {
    const message: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Rs.1299.00 spent on HDFC Bank Card x1234 at AMAZON on 08-09-26. Not you? Call 18002586161',
      receivedAt: Date.now(),
    };
    expect(await ingestMessage(message)).toBe('POSTED');

    const [row] = await db.getAllTransactions();
    expect(row).toMatchObject({
      merchant: 'Amazon',
      category: 'Shopping',
      subcategory: 'Online Shopping',
      payment_method: 'CARD',
      category_source: 'AUTO',
      status: 'COMPLETED',
    });
    expect(row.confidence).toBeGreaterThan(0);
  });

  it('captures salary as plain income, not a debt settlement, with its rail as payment method', async () => {
    const message: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Rs 45,000 credited to A/c XX1234 via NEFT from EMPLOYER PVT LTD on 01-09-26. Ref 712345678901',
      receivedAt: Date.now(),
    };
    expect(await ingestMessage(message)).toBe('POSTED');

    const [row] = await db.getAllTransactions();
    expect(row.kind).toBe('INCOME');
    expect(row.direction).toBe('CREDIT');
    expect(row.payment_method).toBe('NEFT');
    expect(row.status).toBe('COMPLETED');
  });

  it('keeps a failed payment out of spend totals while still posting it', async () => {
    const at = Date.now();
    const message: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Your payment of Rs.700 to OLIVE CAFE from A/c XX1234 has failed.',
      receivedAt: at,
    };
    expect(await ingestMessage(message)).toBe('POSTED');

    const [row] = await db.getAllTransactions();
    expect(row.status).toBe('FAILED');
    expect(row.direction).toBe('DEBIT');

    const dayStart = new Date(at - 24 * 60 * 60 * 1000).toISOString();
    const dayEnd = new Date(at + 24 * 60 * 60 * 1000).toISOString();
    expect(await db.getGrossSpendBetween(dayStart, dayEnd)).toBe(0);
  });

  it('captures fuel spending with its category and card payment method', async () => {
    const message: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Rs.1200 spent on Card ending 5678 at HPCL Petrol Pump on 08-09-26.',
      receivedAt: Date.now(),
    };
    expect(await ingestMessage(message)).toBe('POSTED');

    const [row] = await db.getAllTransactions();
    expect(row).toMatchObject({
      category: 'Transport',
      subcategory: 'Fuel',
      payment_method: 'CARD',
      status: 'COMPLETED',
    });
  });

  it('categorises a mobile recharge as Subscriptions, not a new Bills & Utilities pattern', async () => {
    // jio/airtel were already seeded to Subscriptions before Bills &
    // Utilities existed — deliberately left alone rather than reclassified,
    // to avoid disturbing already-categorised rows on existing installs.
    const message: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Rs.299 paid to JIO via UPI from A/c XX1234. Ref 612345678901',
      receivedAt: Date.now(),
    };
    expect(await ingestMessage(message)).toBe('POSTED');

    const [row] = await db.getAllTransactions();
    expect(row.merchant).toBe('Jio');
    expect(row.category).toBe('Subscriptions');
    expect(row.subcategory).toBe('Mobile Recharge');
    expect(row.payment_method).toBe('UPI');
  });

  it('sends money to a person without reading their name as a Food or Shopping merchant', async () => {
    const message: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Rs 5000 transferred to Rahul via UPI from A/c XX1234. Ref 512345678901',
      receivedAt: Date.now(),
    };
    expect(await ingestMessage(message)).toBe('POSTED');

    const [row] = await db.getAllTransactions();
    expect(row.direction).toBe('DEBIT');
    expect(row.category).not.toBe('Food');
    expect(row.category).not.toBe('Shopping');
    expect(row.category).toBeNull();
    expect(row.payment_method).toBe('UPI');
  });
});
