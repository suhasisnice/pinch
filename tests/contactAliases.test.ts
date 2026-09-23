import * as db from '../src/db/dbService';
import {
  confirmCaptureIsDuplicate,
  ingestMessage,
  postTransaction,
} from '../src/services/captureService';
import { checkForSettlement } from '../src/services/settlementService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { disableConfirmGate } from './utils/settings';
import { CapturedMessage } from '../modules/pinch-capture';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
  // These are about ledger mechanics, not the confirm-before-logging gate.
  await disableConfirmGate();
});

/**
 * One person reaches the app under two names — the one in the phone's
 * contacts, which a UPI app's notification shows, and the one registered
 * against their handle, which the bank's SMS shows. Nothing in the strings
 * connects them, so the app has to be told once and then remember.
 */
describe('learning that two names are one person', () => {
  it('stores an alias and resolves either name to the same contact', async () => {
    const contactId = await db.addContact('Rajesh Kumar M');
    await db.addContactAlias(contactId, 'Ravi Anna');

    expect(await db.findContactIdByNameOrAlias('Rajesh Kumar M')).toBe(contactId);
    expect(await db.findContactIdByNameOrAlias('Ravi Anna')).toBe(contactId);
    expect(await db.findContactIdByNameOrAlias('ravi anna')).toBe(contactId);
    expect(await db.findContactIdByNameOrAlias('Someone Else')).toBeNull();
  });

  it('never stores a contact name as its own alias', async () => {
    const contactId = await db.addContact('Rajesh Kumar M');
    await db.addContactAlias(contactId, 'rajesh kumar m');

    expect(await db.getContactAliases(contactId)).toEqual([]);
  });

  it('does not reassign an alias already claimed by someone else', async () => {
    const first = await db.addContact('Rajesh Kumar M');
    const second = await db.addContact('Manjunatha');
    await db.addContactAlias(first, 'Ravi Anna');
    await db.addContactAlias(second, 'Ravi Anna');

    expect(await db.findContactIdByNameOrAlias('Ravi Anna')).toBe(first);
    expect(await db.getContactAliases(second)).toEqual([]);
  });

  it('reports two names as the same person only once it has been told', async () => {
    const contactId = await db.addContact('Rajesh Kumar M');
    expect(await db.sameKnownPerson('Ravi Anna', 'Rajesh Kumar M')).toBe(false);

    await db.addContactAlias(contactId, 'Ravi Anna');
    expect(await db.sameKnownPerson('Ravi Anna', 'Rajesh Kumar M')).toBe(true);
  });
});

/**
 * The bug this fixes, which nobody would have noticed: a repayment that
 * arrives naming the payer differently from the contact it should close a
 * debt against was booked as income, and the debt stayed open forever.
 */
describe('settling a debt when the repayment names the payer differently', () => {
  async function lendTo(contactName: string): Promise<number> {
    const contactId = await db.addContact(contactName);
    const transactionId = await postTransaction({
      amount: 500,
      direction: 'DEBIT',
      merchant: contactName,
      source: 'MANUAL',
    });
    await db.createIOU({
      contactId,
      amount: 500,
      direction: 'THEY_OWE_ME',
      transactionId,
      reason: 'Lunch',
    });
    return contactId;
  }

  it('still fails to match a name it has never been told about', async () => {
    // Not a regression — with nothing linking the two names there is
    // genuinely nothing to match on, which is why Review asks at all.
    await lendTo('Ravi Anna');

    const credited = await postTransaction({
      amount: 500,
      direction: 'CREDIT',
      merchant: 'Rajesh Kumar M',
      source: 'SMS',
    });
    expect(await checkForSettlement(credited!)).toBeNull();
  });

  it('closes the debt once the alias is known, instead of booking income', async () => {
    const contactId = await lendTo('Ravi Anna');
    await db.addContactAlias(contactId, 'Rajesh Kumar M');

    // postTransaction runs checkForSettlement itself, so this is the live
    // path rather than a hand-driven one: the repayment should already be
    // settled by the time it returns.
    const credited = await postTransaction({
      amount: 500,
      direction: 'CREDIT',
      merchant: 'Rajesh Kumar M',
      source: 'SMS',
    });

    const row = await db.getTransactionById(credited!);
    expect(row?.kind).toBe('SETTLE_IN');
    expect(await db.getOpenIOUs()).toHaveLength(0);

    // And it counts as a repayment rather than as new allowance to spend.
    const window = ['2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'] as const;
    expect(await db.getIncomeBetween(window[0], window[1])).toBe(0);
  });

  it('is still unsettled, and still income, without the alias', async () => {
    await lendTo('Ravi Anna');

    const credited = await postTransaction({
      amount: 500,
      direction: 'CREDIT',
      merchant: 'Rajesh Kumar M',
      source: 'SMS',
    });

    const row = await db.getTransactionById(credited!);
    expect(row?.kind).toBe('INCOME');
    expect(await db.getOpenIOUs()).toHaveLength(1);
  });
});

/**
 * The payoff: answering the duplicate question once means never being asked
 * about that person again.
 */
describe('answering "same one" teaches the duplicate matcher', () => {
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

  it('records the alias from the answer', async () => {
    const at = Date.now();
    await ingestMessage({ ...SMS, receivedAt: at });
    await ingestMessage({ ...NOTIFICATION, receivedAt: at + 30_000 });

    const [pending] = await db.getPendingCaptures();
    await confirmCaptureIsDuplicate(pending.id);

    expect(await db.sameKnownPerson('Ravi Anna', 'Rajesh Kumar M')).toBe(true);
  });

  it('merges the next one silently instead of asking again', async () => {
    const first = Date.now();
    await ingestMessage({ ...SMS, receivedAt: first });
    await ingestMessage({ ...NOTIFICATION, receivedAt: first + 30_000 });
    await confirmCaptureIsDuplicate((await db.getPendingCaptures())[0].id);

    // The same friend pays again the next day — a new payment, so a new
    // UPI reference, both channels reporting it as before.
    const later = first + 24 * 60 * 60 * 1000;
    const nextDaySms = {
      ...SMS,
      body: SMS.body.replace('100200300400', '100200300999'),
      receivedAt: later,
    };
    expect(await ingestMessage(nextDaySms)).toBe('POSTED');
    expect(await ingestMessage({ ...NOTIFICATION, receivedAt: later + 30_000 })).toBe('SKIPPED');

    // Two payments total — the original and the new one — and no question.
    expect(await db.getAllTransactions()).toHaveLength(2);
    expect(await db.getPendingCaptures()).toHaveLength(0);
  });

  it('leaves debits alone rather than inventing a contact for a shop', async () => {
    const at = Date.now();
    const spentSms: CapturedMessage = {
      source: 'SMS',
      sender: 'AD-ICICIB',
      body: 'Dear Customer, Acct XX999 is debited with Rs 60.00 on 14-Sep-26 towards SWIGGY.',
      receivedAt: at,
    };
    const spentNotification: CapturedMessage = {
      source: 'NOTIFICATION',
      sender: 'com.phonepe.app',
      body: 'Paid ₹60 to Bundl Technologies',
      receivedAt: at + 30_000,
    };
    await ingestMessage(spentSms);
    await ingestMessage(spentNotification);

    const pending = await db.getPendingCaptures();
    if (pending.length > 0) await confirmCaptureIsDuplicate(pending[0].id);

    // No contact created for a merchant, whichever way the duplicate went.
    expect(await db.getContacts()).toHaveLength(0);
  });
});
