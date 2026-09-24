> DRAFT, written by the local model (gpt-oss:20b) and corrected by Claude against the code on 2026-09-24. Items marked TODO need the owner. Not legal advice.

# Privacy Policy for Pinch

**Last updated: 24 September 2026**

Pinch (“we”, “our”, “us”) is an offline‑first personal‑finance app for Indian college students. This policy explains what data we read, store, and share, and how you can control it.

---

## What Pinch reads

| Data | Why it is read | How it is handled |
|------|----------------|-------------------|
| **SMS** | To record payments automatically from bank and UPI transaction messages. | On the phone, Pinch checks each SMS (`FinancialSms.kt`). A personal message is dropped before it's stored. A financial message is kept in the encrypted database as evidence for the transaction, with any OTP code masked. |
| **Notifications** (only if you grant notification access) | To record payments from bank and UPI app notifications. | The same rules as SMS: read on the phone, only financial ones kept. |
| **Contacts** | To pick the people you split a bill with. | The name and phone number of a contact you pick are saved in the encrypted database. They never leave the phone. |
| **Device storage** | To store the encrypted database and user‑generated data. | All data is kept on the device only. |

---

## What it stores and where

| Item | Storage location | Encryption |
|------|------------------|------------|
| **Financial data** (budgets, balances, net‑worth history, merchant rules, etc.) | `pinch-secure.db` (SQLite) | SQLCipher with a 256‑bit key stored in `expo-secure-store` (Android Keystore). |
| **Financial SMS and notifications** | In the same encrypted database. OTP codes are masked before storage. | Same as above. |
| **App settings** (lock preferences, theme, etc.) | On the device (TODO: confirm which settings live in AsyncStorage and which in secure-store) | TODO |
| **Backups** | User‑chosen file via the system share sheet. | AES‑256‑GCM, key derived from a passphrase with PBKDF2‑SHA256 (310 k rounds). The backup file contains only the encrypted database; lock settings and keys never leave the device. |

The old plaintext `pinch.db` is migrated to `pinch-secure.db` on first launch and then deleted.

---

## What leaves the phone

| Data | Destination | Purpose |
|------|-------------|---------|
| **Encrypted backup file** | User‑chosen location (e.g., Google Drive, email, local storage) | Allows the user to restore the app on a new device. |
| **No other data** | | |

All other data remains on the device. The app does **not** use the Internet for any data transfer.

---

## Permissions and why

| Permission | Reason | How it is used |
|------------|--------|----------------|
| `READ_SMS` / `RECEIVE_SMS` | To record payments from bank and UPI transaction messages. | Only financial messages are processed; all others are discarded immediately. |
| `READ_CONTACTS` | To pick the people you split a bill with. | The contacts you pick are saved on the device only. |
| Notification access | To record payments from bank and UPI app notifications. | Optional. You can switch it off in Android settings. |
| `POST_NOTIFICATIONS` | Budget warnings, heads-ups and reminders. | Local notifications only; nothing is sent. |
| `INTERNET` | Reserved for future download-only features (fund NAVs, parser rules). | Not used today. |
| `WRITE_EXTERNAL_STORAGE` | None used. | Declared but blocked (`blockedPermissions`). |

TODO: confirm that the prominent disclosure in onboarding comes before every one of these prompts. You can revoke any permission in Android's app settings.

---

## Backups

Pinch does **not** use Android Auto‑Backup (`android.allowBackup: false`).  
Backups are user‑initiated via the “Backup” sheet in Settings. The backup file is encrypted and can be restored only on a device running Pinch. No backup data is stored on Google Play or any server.

---

## Deleting your data

| Action | Effect | How to do it |
|--------|--------|--------------|
| **Erase everything** | Removes every personal record: transactions, stored messages, people, goals, plans, caps and personal settings. Tested so that no personal table keeps any rows. | Settings → Erase everything. |
| **Clear spending history** | Removes transactions but keeps your setup. TODO: list exactly what is kept. | Settings. |
| **Delete the app** | All data stored on the device is deleted. | Uninstall the app. |


---

## Children (users under 18)

TODO (owner decision): Pinch targets college students, and some are under 18. The app has no age check. Decide the Play age rating and what this section says; DPDP rules for children's data may apply.

---

## Contact

If you have questions or concerns about this privacy policy, please contact us at:

TODO: a real contact email. (The model made up pinchapp.com.)

---
