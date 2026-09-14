import * as db from '../src/db/dbService';
import { acceptCapture, ingestMessage } from '../src/services/captureService';
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

/**
 * Modelled on a payment that really did get counted twice — details changed,
 * shape kept exactly. PhonePe's notification named the sender with the
 * phone's own contact name; ICICI's SMS for the identical payment used the
 * name registered against the UPI handle. The two strings share nothing, so
 * requiring a merchant match (added to stop *different* people with equal
 * amounts merging) let this through as two separate credits.
 *
 * It is not merged automatically either, because the same shape — equal
 * amounts, seconds apart — is what a group settling a shared bill looks
 * like, and merging those would lose somebody's money. It becomes a
 * question instead.
 */
describe('one payment, two sources that name the sender differently', () => {
  const NOTIFICATION: CapturedMessage = {
    source: 'NOTIFICATION',
    sender: 'com.phonepe.app',
    body: 'Ravi Anna sent ₹20 to you.',
    receivedAt: 0,
  };
  const SMS: CapturedMessage = {
    source: 'SMS',
    sender: 'AD-ICICIB',
    body:
      'Dear Customer, Acct XX999 is credited with Rs 20.00 on 14-Sep-26 from Rajesh Kumar M. ' +
      'UPI:100200300400-ICICI Bank.',
    receivedAt: 0,
  };

  it('asks instead of counting it twice, when the notification lands first', async () => {
    const at = Date.now();
    expect(await ingestMessage({ ...NOTIFICATION, receivedAt: at })).toBe('POSTED');
    expect(await ingestMessage({ ...SMS, receivedAt: at + 40_000 })).toBe('QUEUED');

    // Still exactly one payment counted while the question is open.
    const all = await db.getAllTransactions();
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(20);

    const [pending] = await db.getPendingCaptures();
    expect(pending.possible_duplicate_of).toBe(all[0].id);
  });

  it('asks the same way when the bank SMS lands first', async () => {
    const at = Date.now();
    expect(await ingestMessage({ ...SMS, receivedAt: at })).toBe('POSTED');
    expect(await ingestMessage({ ...NOTIFICATION, receivedAt: at + 40_000 })).toBe('QUEUED');

    expect(await db.getAllTransactions()).toHaveLength(1);
    const [pending] = await db.getPendingCaptures();
    expect(pending.possible_duplicate_of).not.toBeNull();
  });

  it('answering "different" posts it as its own payment', async () => {
    const at = Date.now();
    await ingestMessage({ ...NOTIFICATION, receivedAt: at });
    await ingestMessage({ ...SMS, receivedAt: at + 40_000 });

    const [pending] = await db.getPendingCaptures();
    await acceptCapture(pending.id);

    expect(await db.getAllTransactions()).toHaveLength(2);
  });

  it('answering "same one" leaves the payment counted exactly once', async () => {
    const at = Date.now();
    await ingestMessage({ ...NOTIFICATION, receivedAt: at });
    await ingestMessage({ ...SMS, receivedAt: at + 40_000 });

    const [pending] = await db.getPendingCaptures();
    await db.rejectCapture(pending.id);

    expect(await db.getAllTransactions()).toHaveLength(1);
    expect(await db.getPendingCaptures()).toHaveLength(0);
  });

  it('does not ask about two same-amount payments that arrive minutes apart', async () => {
    // Outside the near-simultaneous window there is nothing ambiguous —
    // differently-named senders are simply two payments.
    const at = Date.now();
    await ingestMessage({ ...NOTIFICATION, receivedAt: at });
    expect(await ingestMessage({ ...SMS, receivedAt: at + 5 * 60_000 })).toBe('POSTED');

    expect(await db.getAllTransactions()).toHaveLength(2);
  });

  it('does not ask when both reports arrive on the same channel', async () => {
    // One real event produces at most one message per channel, so two SMS
    // seconds apart are two payments however similarly they read.
    const at = Date.now();
    const first = {
      ...SMS,
      body: 'Dear Customer, Acct XX999 is credited with Rs 20.00 on 14-Sep-26 from Manjunatha. UPI:100200300401-ICICI Bank.',
      receivedAt: at,
    };
    expect(await ingestMessage(first)).toBe('POSTED');
    expect(await ingestMessage({ ...SMS, receivedAt: at + 20_000 })).toBe('POSTED');

    expect(await db.getAllTransactions()).toHaveLength(2);
  });
});
