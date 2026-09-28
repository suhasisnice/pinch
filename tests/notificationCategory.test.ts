import * as db from '../src/db/dbService';
import { postTransaction } from '../src/services/captureService';
import { categoriseFromNotification } from '../src/services/classificationService';
import {
  addNotificationResponseListener,
  CATEGORY_ACTION_PREFIX,
} from '../src/notifications/notificationService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { disableConfirmGate } from './utils/settings';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mock = require('expo-notifications');

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
  await disableConfirmGate();
});

const row = async (id: number) => (await db.getTransactionById(id))!;

/**
 * The Food / Transport / Shopping buttons on "What was this?" (0.9.22).
 * They used to set the category and learn from the merchant name alone,
 * which taught a person's name words as a shop's.
 */
describe('categorising from a notification button', () => {
  it('learns a person by UPI handle, never by the words in their name', async () => {
    const id = await postTransaction({
      amount: 60,
      direction: 'DEBIT',
      merchant: 'TENZIN DORJEE',
      rawText: 'Rs.60 debited from A/c XX1234 to VPA 9876543210@ybl TENZIN DORJEE UPI Ref 11',
      source: 'SMS',
      silent: true,
    });
    await categoriseFromNotification(id!, 'Food');

    expect(await row(id!)).toMatchObject({ category: 'Food', category_source: 'USER' });
    const weights = await db.getCategoryTokenWeights();
    expect(weights.Food?.tenzin).toBeUndefined();
    expect(weights.Food?.dorjee).toBeUndefined();

    // Someone else sharing the surname is not touched.
    const other = await postTransaction({
      amount: 90,
      direction: 'DEBIT',
      merchant: 'PEMA DORJEE',
      rawText: 'Rs.90 debited from A/c XX1234 to VPA 9123456780@ybl PEMA DORJEE UPI Ref 12',
      source: 'SMS',
      silent: true,
    });
    expect((await row(other!)).category).toBeNull();
  });

  it('reaches earlier payments to the same shop', async () => {
    const earlier = await db.addTransaction({
      amount: 120, direction: 'DEBIT', kind: 'SPEND', merchant: 'Sharma Tiffin Point',
      source: 'SMS', occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const now = await db.addTransaction({
      amount: 130, direction: 'DEBIT', kind: 'SPEND', merchant: 'Sharma Tiffin Point',
      source: 'SMS', occurredAt: new Date().toISOString(),
    });
    await categoriseFromNotification(now, 'Food');
    expect((await row(earlier)).category).toBe('Food');
  });

  it('never overrides a category the user has since set in the app', async () => {
    const id = await db.addTransaction({
      amount: 300, direction: 'DEBIT', kind: 'SPEND', merchant: 'Some Place',
      source: 'SMS', occurredAt: new Date().toISOString(), category: 'Academics',
    });
    await categoriseFromNotification(id, 'Shopping');
    expect((await row(id)).category).toBe('Academics');
  });

  it('picks up a button pressed while the app was closed, once', () => {
    const seen: string[] = [];
    mock.__simulateLaunchResponse({ transactionId: 7 }, `${CATEGORY_ACTION_PREFIX}Food`);

    addNotificationResponseListener((_payload, action) => seen.push(action)).remove();
    // A second listener (Try again, a remount) must not answer it again.
    addNotificationResponseListener((_payload, action) => seen.push(action)).remove();

    expect(seen).toEqual([`${CATEGORY_ACTION_PREFIX}Food`]);
  });
});
