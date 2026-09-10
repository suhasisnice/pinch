import * as db from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import {
  addNotificationResponseListener,
  deliver,
  TXN_DECISION_CATEGORY,
  TXN_DECLINE_ACTION,
} from '../src/notifications/notificationService';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/notifications/engine';
import * as Notifications from 'expo-notifications';
import { __simulateNotificationResponse } from './mocks/expo-notifications';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

describe('accept/decline on a transaction notification', () => {
  it('gives a transaction-pulse notification the decision buttons', async () => {
    const txId = await db.addTransaction({
      amount: 200,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Olive Cafe',
    });
    const spy = jest.spyOn(Notifications, 'scheduleNotificationAsync');

    await deliver(
      {
        type: 'TXN_PULSE',
        tier: 'STEADY',
        title: 'Logged',
        body: '₹200 at Olive Cafe',
        payload: { transactionId: txId },
      },
      DEFAULT_NOTIFICATION_SETTINGS
    );

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ categoryIdentifier: TXN_DECISION_CATEGORY }),
      })
    );
    spy.mockRestore();
  });

  it('leaves a notification with no single transaction alone', async () => {
    const spy = jest.spyOn(Notifications, 'scheduleNotificationAsync');

    await deliver(
      { type: 'STREAK', tier: '7', title: '7-day streak', body: 'Nice.' },
      DEFAULT_NOTIFICATION_SETTINGS
    );

    const call = spy.mock.calls[0][0];
    expect(call.content).not.toHaveProperty('categoryIdentifier');
    spy.mockRestore();
  });

  it('excludes the transaction when Decline is tapped', async () => {
    const txId = await db.addTransaction({
      amount: 229,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Olive Cafe',
    });

    let seenAction: string | null = null;
    const subscription = addNotificationResponseListener((payload, actionIdentifier) => {
      seenAction = actionIdentifier;
      if (actionIdentifier !== TXN_DECLINE_ACTION) return;
      db.setTransactionExcluded(payload.transactionId as number, true);
    });

    __simulateNotificationResponse({ transactionId: txId }, TXN_DECLINE_ACTION);
    subscription.remove();

    expect(seenAction).toBe(TXN_DECLINE_ACTION);
    expect((await db.getTransactionById(txId))?.excluded_at).not.toBeNull();
  });

  it('does nothing on a plain tap or Accept', async () => {
    const txId = await db.addTransaction({
      amount: 229,
      direction: 'DEBIT',
      kind: 'SPEND',
      merchant: 'Olive Cafe',
    });

    const subscription = addNotificationResponseListener((payload, actionIdentifier) => {
      if (actionIdentifier !== TXN_DECLINE_ACTION) return;
      db.setTransactionExcluded(payload.transactionId as number, true);
    });

    __simulateNotificationResponse({ transactionId: txId }, 'ACCEPT');
    subscription.remove();

    expect((await db.getTransactionById(txId))?.excluded_at).toBeNull();
  });
});
