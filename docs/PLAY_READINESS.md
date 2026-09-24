# Play readiness and hardening (0.9.17)

Where this came from: the user asked for research on the global standards,
the regulations, and what it takes to be secure and accepted on Google Play.
They then chose what to close in one pass (MCQ, 2026-09-24):

- the wrong Plans numbers
- the security quick wins
- backup, export and delete
- the Expo upgrade

For the "one soup" UI they chose **different hero shapes per tab**.

## What changed

### Security and privacy

| Gap | Fix | Where |
|---|---|---|
| Every incoming SMS was stored, friends' texts included (Play SMS policy and DPDP data-minimisation risk) | SMS from phone numbers, or not about money, is dropped at the receiver and in the inbox read, before JS ever sees it. JS keeps a second lock. OTP codes are masked before storing. | `modules/pinch-capture/.../FinancialSms.kt`, `src/services/smsPrivacy.ts` |
| Personal SMS already stored on existing phones | Migration v18 removes them, and OTP messages, unless they sit behind a transaction or review item | `src/db/migrations.ts` |
| Plaintext database | SQLCipher (`expo-sqlite` `useSQLCipher`). A random 256-bit key lives in `expo-secure-store` (Android Keystore). An old plaintext `pinch.db` is exported into `pinch-secure.db` on first launch, then deleted. | `src/db/expoAdapter.ts` |
| `allowBackup=true` put the finance DB into Android auto-backup | `android.allowBackup: false` | `app.json` |
| Overlay and storage permissions nothing used | `blockedPermissions` | `app.json` |
| No app lock | Optional lock with fingerprint, face or the device PIN. It must succeed once before it can be turned on, and it relocks after 60s in the background. | `src/security/AppLock.tsx`, Settings → Privacy |
| No way to survive a lost phone | Encrypted backup. AES-256-GCM, key from a passphrase via PBKDF2-SHA256 (310k rounds, `@noble/*`). Shared through the system share sheet and restored from a picked file. Device-only settings (the DB key, the lock) never travel. | `src/services/backupService.ts`, `backupFiles.ts`, `components/BackupSheet.tsx` |
| "Erase everything" left holdings, net-worth history, milestones, balances and learned merchant weights behind | A new `personal` reset option, plus `clearPersonalSettings()`. A test asserts no personal table has rows afterwards. | `src/db/repos/maintenance.ts` |

### Numbers

- Plans' "set aside this month" had its own outdated formula. It showed ₹25,231 on a ₹15,000 allowance. It now comes from the budget engine.
- Goal pace is read over at least 30 days (`MIN_PACE_DAYS`), so a first lump sum isn't mistaken for a daily rate.
- Goals without a deadline no longer show "remaining ÷ 30 a day"; they show a projected date.

### Platform

- Expo 51 → **57** (RN 0.74 → 0.86, React 19.2, TypeScript 6). Expo 57 targets API 36, which Play requires from 31 Aug 2026.
- react-navigation 6 → 7.
- The `pinch-capture` module uses `expo-module-gradle-plugin`, so it builds against whatever SDK the app targets.
- tsconfig now follows `expo/tsconfig.base` (bundler resolution). Jest compiles tests as CommonJS through a ts-jest override.
- `Ring` no longer uses an animated SVG component, which broke on the new stack.

### Distinction (UI)

Each tab has its own hero shape (`src/components/Heroes.tsx`). Today stays centred; the others are left-aligned.

| Tab | Hero shape |
|---|---|
| Today | Ring |
| Plans | Jars filling from the bottom |
| Wealth | Full-width net-worth chart |
| People | Faces sized by what's owed |

## Still needed before a Play release (not code: the user's to do)

1. **Privacy policy URL.** Required because the app reads SMS and contacts. It must say:
   - only financial SMS are read;
   - everything stays on the phone;
   - backups are user-initiated and encrypted.
2. **Permissions Declaration Form** for READ_SMS / RECEIVE_SMS. Choose the "SMS-based money management" exception and attach a short demo video.
3. **Data safety form.** Data "collected": financial info, messages and contacts, each processed on the device only. "Shared": nothing. Encrypted: yes. The user can request deletion: yes, via Settings → Erase everything.
4. **Financial features declaration.** Budgeting and personal finance management only: no loans, no payments, no investing done by the app.
5. **Closed test with 12 testers for 14 days**, if the Play account is a personal one created after Nov 2023.
6. **Prominent disclosure** before the SMS and contacts permission prompts. The onboarding copy should be checked against Play's wording.
7. **Age.** DPDP requires verifiable parental consent for users under 18. Some first-years are 17; an age question at onboarding is the simplest guard. Not built.

## Known limits

- **Not yet verified on a device:** SQLCipher, the plaintext-to-encrypted move, the lock and share/pick flows. The native build compiles, but there's no phone here.
- **Backup timing:** PBKDF2 at 310k rounds in pure JS may take a few seconds on older phones. The sheet shows "Working…" meanwhile.
- **MerchantRules** survive "Erase everything". It's the shipped rule list, but it also holds any rule the user edited.
- **Signing key.** Release APKs are signed with Expo's template `debug.keystore`, a public key shared by every Expo project. 0.9.17 keeps it so it installs over 0.9.16 without an uninstall.
  - Before Play: create a private upload keystore, and let Play App Signing hold the app key.
  - A Play install is a fresh install anyway.
  - For sideloaded phones: make a backup, install the newly signed build, then restore.
- **INTERNET** is still declared. Nothing in the app uses it today; it's kept for the planned download-only features (fund NAVs, parser rules). Blocking it would make "offline" a guarantee instead of a promise.
