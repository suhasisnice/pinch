import * as db from '../src/db/dbService';
import { ingestMessage } from '../src/services/captureService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { CapturedMessage } from '../modules/pinch-capture';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

/**
 * The two duplicate-handling bugs found from real use: PhonePe's own
 * notification and the bank's SMS both reporting one payment, and a genuine
 * back-and-forth between two people being mistaken for the same thing
 * reported twice. See findProbableDuplicate in db/repos/transactions.ts.
 */
describe('capture-time duplicate detection', () => {
  it('never files a low-confidence report of an already-posted payment to review', async () => {
    const at = Date.now();

    const sms: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Rs.329.00 debited from A/c XX1234 on 08-09-25 to Rahul. Avl Bal Rs.4,500.00 -HDFC Bank',
      receivedAt: at,
    };
    const smsResult = await ingestMessage(sms);
    expect(smsResult).toBe('POSTED');
    expect(await db.getAllTransactions()).toHaveLength(1);

    // The same payment, reported by the paying app's own notification a
    // little later, worded loosely enough to score under ACCEPT_THRESHOLD —
    // exactly the shape that used to skip the duplicate check entirely and
    // land in the review inbox asking "is PhonePe a sender you trust?".
    const notification: CapturedMessage = {
      source: 'NOTIFICATION',
      sender: 'com.phonepe.app',
      body: 'You paid ₹329 to Rahul',
      receivedAt: at + 45_000,
    };
    const notificationResult = await ingestMessage(notification);

    expect(notificationResult).toBe('SKIPPED');
    expect(await db.getAllTransactions()).toHaveLength(1);
    expect(await db.getPendingCaptureCount()).toBe(0);
  });

  it('does not drop a real reciprocal payment as a false duplicate', async () => {
    const at = Date.now();

    const sent: CapturedMessage = {
      source: 'SMS',
      sender: 'VM-HDFCBK',
      body: 'Sent Rs.200.00 From HDFC Bank A/C x1234 To Shreyas On 08/09/25 Ref 123456789011',
      receivedAt: at,
    };
    expect(await ingestMessage(sent)).toBe('POSTED');

    // Thirty seconds later Shreyas sends the same amount straight back — a
    // real, opposite-facing payment, not the first message reported twice.
    // Matching on amount alone used to read this as a duplicate of the
    // outgoing payment and silently skip it.
    const receivedBack: CapturedMessage = {
      source: 'NOTIFICATION',
      sender: 'com.phonepe.app',
      body: 'Shreyas sent ₹200 to you. UPI Ref 998877665511',
      receivedAt: at + 30_000,
    };
    expect(await ingestMessage(receivedBack)).toBe('POSTED');

    const all = await db.getAllTransactions();
    expect(all).toHaveLength(2);
    const credit = all.find((row) => row.direction === 'CREDIT');
    expect(credit?.merchant).toBe('Shreyas');
    expect(credit?.amount).toBe(200);
  });
});
