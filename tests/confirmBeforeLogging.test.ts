import * as db from '../src/db/dbService';
import {
  acceptCapture,
  backfillFromInbox,
  ingestMessage,
} from '../src/services/captureService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { disableConfirmGate, enableConfirmGate } from './utils/settings';
import { CapturedMessage } from '../modules/pinch-capture';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
  await enableConfirmGate();
});

const CONFIDENT: CapturedMessage = {
  source: 'SMS',
  sender: 'VM-HDFCBK',
  body: 'Rs.369.00 spent on your SBI Credit Card ending 9124 at AmazonSellerServices on 11/09/26.',
  receivedAt: 0,
};

const WINDOW = ['2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'] as const;

/**
 * Holding a payment rather than logging it is the one behaviour here that
 * can cost the user money if it goes wrong, in either direction: log
 * something they did not agree to, or quietly lose something they did. So
 * the tests are about both halves — nothing counts before the answer, and
 * nothing is lost while waiting for it.
 */
describe('holding a confident payment until it is confirmed', () => {
  it('does not count toward the budget before it is confirmed', async () => {
    expect(await ingestMessage({ ...CONFIDENT, receivedAt: Date.now() })).toBe('QUEUED');

    expect(await db.getAllTransactions()).toHaveLength(0);
    expect(await db.getGrossSpendBetween(WINDOW[0], WINDOW[1])).toBe(0);
  });

  it('waits in Review rather than being lost, so a missed notification costs nothing', async () => {
    await ingestMessage({ ...CONFIDENT, receivedAt: Date.now() });

    const pending = await db.getPendingCaptures();
    expect(pending).toHaveLength(1);
    expect(pending[0].parsed_amount).toBe(369);
    // Confidently parsed — the question is "do you want this counted", not
    // "did we read this right".
    expect(pending[0].confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('counts once confirmed, and only once', async () => {
    await ingestMessage({ ...CONFIDENT, receivedAt: Date.now() });
    const [pending] = await db.getPendingCaptures();

    const transactionId = await acceptCapture(pending.id);
    expect(transactionId).not.toBeNull();

    expect(await db.getAllTransactions()).toHaveLength(1);
    expect(await db.getGrossSpendBetween(WINDOW[0], WINDOW[1])).toBe(369);
    expect(await db.getPendingCaptures()).toHaveLength(0);
  });

  it('never counts when rejected', async () => {
    await ingestMessage({ ...CONFIDENT, receivedAt: Date.now() });
    const [pending] = await db.getPendingCaptures();

    await db.rejectCapture(pending.id);

    expect(await db.getAllTransactions()).toHaveLength(0);
    expect(await db.getPendingCaptures()).toHaveLength(0);
  });

  it('still records the raw message and an outcome, gate or no gate', async () => {
    await ingestMessage({ ...CONFIDENT, receivedAt: Date.now() });

    const [raw] = await db.getRecentRawEvents(10);
    expect(raw.body).toContain('AmazonSellerServices');
    const [parsed] = await db.getParsedEventsForRawEvent(raw.id);
    expect(parsed.outcome).toBe('QUEUED');
  });

  it('logs straight away once the gate is off', async () => {
    await disableConfirmGate();
    expect(await ingestMessage({ ...CONFIDENT, receivedAt: Date.now() })).toBe('POSTED');
    expect(await db.getAllTransactions()).toHaveLength(1);
  });
});

/**
 * Replaying months of old SMS must not demand a confirmation for each one.
 * `silent` is already how the backfill says it is catching up on history
 * rather than reporting something that just happened.
 */
describe('a bulk import is not held for confirmation', () => {
  it('posts imported history directly even with the gate on', async () => {
    const result = await backfillFromInbox(10);

    // The mock inbox returns a fixed set of messages; what matters is that
    // none of them ended up waiting on a confirmation.
    expect(result.queuedForReview).toBe(0);
    expect(await db.getPendingCaptures()).toHaveLength(0);
  });
});
