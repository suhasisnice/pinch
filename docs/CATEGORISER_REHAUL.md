# Categoriser rehaul (0.9.21)

Started 2026-09-24. Batched with the fix queue (`docs/FIX_QUEUE.md`) into one build.

## Why

The categoriser before this pass had three stages: a `MerchantRules` substring match, a
naive-Bayes classifier over merchant-name words (`CategoryTokenWeights`), and then nothing.
It had these problems:

1. **Substring over-matching.** `instr(merchant, pattern)` meant `ola` matched Motorola,
   `bar` matched Barista, `jio` matched JioMart, and `book` matched both BookMyShow and
   textbooks. This was flagged in `docs/AUDIT.md` §6.8 and never fixed.
2. **Only the cleaned merchant name was read.** The VPA handle (`zomato@ybl`), the P2M/P2A
   marker and the rest of the SMS were thrown away, and they are often the strongest signal.
3. **People were treated as shops.** Correcting "Ramesh Kumar" to Food taught the word
   `kumar` to mean Food, so every Kumar the user paid afterwards was filed as Food.
4. **All or nothing.** At a confidence of 0.55 or above the category was applied silently.
   Below that the guess was thrown away. Phase 7 asks for a middle tier: "record with easy
   correction."
5. **A thin vocabulary.** About 55 seed rules and 200 seed words. Groceries were filed as Food.

## Decisions (user, 2026-09-24)

| Question | Answer |
| --- | --- |
| Categories | Add Groceries, Travel and Personal care, **plus** sub-categories under each |
| Where sub-categories show | Detail only. Rows show `Food · Delivery`. Charts and Today stay top-level. Tapping a category in Insights opens its sub-category breakdown. The picker shows the top level first, and sub-categories are one tap deeper. |
| Payments to people | Remember the category per payee. Never learn from the words in a person's name. |
| Medium confidence | Apply it and mark it as a guess. One tap confirms it (which also teaches the categoriser) or changes it. Low confidence stays blank. |

## Design

A pure engine in `src/math/categoriser.ts` (no DB) plus its data in
`src/math/categoryTaxonomy.ts` (categories, sub-categories, brands, keywords).

Cascade, first hit wins:

1. **Learned (USER, SURE).** A payee rule (exact VPA or exact name) for people, or a
   merchant rule (whole-word or `sameMerchant`) for shops.
2. **Brand (SURE).** A curated dictionary matched on whole words, on the compacted name, and
   on the VPA's user part. The longest match wins, so `swiggy instamart` beats `swiggy`.
3. **Keyword.** Generic words (`pharmacy`, `salon`, `xerox`, `cafe`, `hotel`, …), each
   marked strong (SURE) or weak (GUESS).
4. **Words (naive Bayes).** Existing seeds plus user corrections. A score of 0.8 or more is
   SURE, 0.55 to 0.8 is a GUESS.
5. Otherwise blank.

**Payee type.** A VPA that is a phone number, or a `P2A` marker, means a PERSON. A merchant
QR handle (`paytmqr`, `q…@ybl`, `bharatpe`, `razorpay`, …) or a `P2M` marker means a MERCHANT.
A name made of 2–4 plain words with no brand or keyword in it is probably a PERSON. For a
PERSON, only stage 1 runs, and learning writes a payee rule but never token weights.

**Storage (migration v20).**

- New columns on `Transactions`: `subcategory` and `category_source` (`USER` | `SURE` |
  `GUESS` | `LEGACY`).
- New columns on `MerchantRules`: `subcategory` and `is_payee`.
- Pure seed rows (hit_count 0) are deleted from `MerchantRules`, since the brand dictionary
  replaces them, and `connection.ts` stops seeding.
- Grocery seed words move from Food to Groceries.
- Existing categorised rows are marked `LEGACY`. The revalidation sweep
  (`PARSER_RULES_VERSION` 12) then resolves them:
  - Manual rows, and rows matching a user-taught rule, become `USER`.
  - `Cash` stays as it is.
  - Every other row is re-run through the new engine, and keeps its old category if the
    engine has no opinion.

## Build checklist

- [x] Taxonomy, brands and keywords (`categoryTaxonomy.ts`)
- [x] Engine (`categoriser.ts`) and its tests (the substring bugs, people, VPA, guess tiers)
- [x] Migration v20, repos (rules and payee memory, setCategory with source/sub)
- [x] Service wiring: postTransaction, backfill/legacy resolve, learning, propagation, confirm-guess
- [x] UI: two-level picker (detail and add sheets), `· guess` on rows plus a confirm in the
      detail sheet, `Food · Delivery` on rows, colours and icons for the 3 new categories
- [x] Insights: category tap opens a sub-category breakdown (on the filtered Transactions screen)
- [x] Fix queue items (see `FIX_QUEUE.md`)
- [ ] `npm test`, `npm run typecheck`, version bump, APK plus the readelf check

## What shipped (0.9.21)

**Categoriser**

- `src/math/categoryTaxonomy.ts` holds:
  - 13 categories and their sub-categories;
  - about 400 brand names, a few of them marked guess-only;
  - keyword groups, each marked strong or weak;
  - a list of Indian name words.
- `src/math/categoriser.ts` is the pure engine: `categorise`, `readPayee` and `findVpa`.
- Every match is on whole words. A short name must match a word exactly, so "ola" no longer
  matches Motorola.
- People are detected from P2A/P2M markers, a phone-number VPA, merchant-QR handles, the user's
  contacts, and the name words.
- A correction for a person writes `vpa:` and `name:` payee rules, and never token weights.
  Name words are never learned from anyone's correction.
- Confirming a guess (`confirmCategoryGuess`) turns it into USER and teaches the categoriser.
- Propagation no longer overwrites another row the user set by hand.
- The rule version is now 12, so every install re-checks its LEGACY categories once:
  - One that matches a rule the user taught becomes USER.
  - Otherwise the new engine decides.
  - A category that only an old substring seed could have produced is cleared.
  - Anything else is kept as a GUESS.

**UI**

- `CategoryPicker` (top level, then an optional sub-category) is used in the detail and Add sheets.
- Rows show "Food · Delivery", or "Food · guess".
- The detail sheet asks "Looks like X. Right?" with Yes / Change.
- The Transactions screen, filtered to one category (Insights' drill-down), shows an "Inside Food"
  breakdown. Tapping a line filters to that sub-category.
- New colours and icons for Groceries, Travel and Personal care.

**Tests:** `tests/categoriser.test.ts` (engine) and `tests/categoriserService.test.ts` (real SQL:
people, guesses, the LEGACY sweep, migration v20).

**Not done / known limits**

- ~~The notification quick-category actions have no handler.~~ Wrong: `App.tsx` did handle them. Fixed in
  0.9.22 were two problems in that handler:
  - It learned from the merchant name alone, so a person paid by UPI taught their name words as a shop's.
  - It ignored the other payments to the same payee.

  It now calls `categoriseFromNotification`, which works the same way as the detail sheet. A button pressed
  while the app was closed is also no longer lost (`getLastNotificationResponse`).
- A shopkeeper's personal UPI ID with no shop words in it stays blank until the user sets it once.
  After that, the per-payee rule remembers it.
- `NAME_WORDS` is a hand list. It was widened in 0.9.22 with North-East, Bengali, Odia, Tamil,
  Malayali and Parsi names. What is still missing is covered by `isAmbiguousName` (0.9.22).
  - A name of only plain words, with no shop or person signal, is remembered for that exact payee.
  - Words that a correction taught never reach another ambiguous name, so correcting Tenzin Dorjee
    cannot file Pema Dorjee.
  - A name on a Google Pay consumer handle (`@okaxis` / `@okhdfcbank` / `@oksbi` / `@okicici`) is a
    person.
  - Common shop endings (junction, plaza, bazaar, …) were added to the shop words, so "Bhukkad Junction"
    still learns from "Bhukkad Dhaba".
