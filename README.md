# Pinch

An offline-first Android money app for college students living on an allowance.
Pinch reads bank SMS and payment notifications on the phone, turns them into
transactions, and answers four questions: how much can I safely spend, what have
I planned for, what am I saving toward, and who owes whom.

All data stays on the device. There is no server and no account.

## What it does

- **Automatic capture.** A custom Kotlin native module (`modules/pinch-capture`)
  listens for bank SMS and payment-app notifications. Personal (non-bank)
  messages are dropped before anything is stored.
- **Rule-based parser.** Pulls the amount, direction, payee and account out of
  each message. Anything it is unsure about goes to a review inbox instead of
  becoming a transaction.
- **Encrypted storage.** Transactions live in an on-device SQLite database
  encrypted with SQLCipher, behind an optional app lock.
- **Budgeting.** Safe-to-spend, planned spending, savings goals, splits and IOUs
  with friends, outings, a weekly recap and insights.

## Parser accuracy

Measured on 145 public sample bank messages (from
[bank-sms-parser](https://github.com/akhilnarang/bank-sms-parser), MIT, see
`tests/fixtures/public-sms/NOTICE.md`):

- 119 of 138 real transactions detected (86%)
- amount extracted correctly in every detected transaction

`tests/publicSms.test.ts` fails if detection drops below this.

## Tech stack

React Native (Expo 57), TypeScript, Kotlin native module, SQLite with SQLCipher
(`expo-sqlite`), Jest (70 test files, 900+ tests).

## Project layout

| Folder | What is in it |
| --- | --- |
| `src/screens` | Today, Transactions, Review, Plans, Goals, Wealth, Squad, Outings, Insights, Recap, Settings |
| `src/services` | SMS / notification parsing and privacy filtering |
| `src/math` | Budget, safe-to-spend, split and categoriser logic |
| `src/db` | Database schema, migrations and repositories |
| `modules/pinch-capture` | Kotlin module that captures SMS and notifications |
| `tests` | Jest tests, including the public SMS fixture set |
| `docs` | Product spec, design notes and plans |

## Run it

Needs Node.js, the Android SDK and a JDK. Android only.

```bash
npm install
npm test             # run the tests
npm run typecheck    # TypeScript check
npm run native:prebuild
npm run android      # build and run on a connected phone or emulator
npm run apk          # build an installable APK (debug-signed)
```

`npm run preview` opens a web preview of the screens with sample data
(no SMS capture on the web).

## Status

Personal project, in active development. Built with AI coding tools: I wrote
the specs and design, then reviewed and tested the results.
