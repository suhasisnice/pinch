# Reading SMS accurately: rules + learned templates + a small model

Research note, 2026-10-01. Nothing here is built yet. It answers one question:
should Pinch replace its hand-written rules with a trained model?

**Short answer: no. Keep the rules, add two things around them, and never let
any single part log money on its own guess.**

## 1. What I measured today

I scored Pinch's parser on 145 sample bank messages from an open-source project
(`akhilnarang/bank-sms-parser`, MIT, 17 banks and card issuers, details masked).
The expected answers come from that project's own parser, which its tests check.

| Question | Result |
|---|---|
| Real transactions Pinch noticed at all | 92 of 138 (67%) |
| Of those, sign (in or out) correct | 92 of 92 (100%) |
| Of those, amount correct | 91 of 92 (99%) |
| Of those, name correct | 40 of 92 (43%) |
| Logged without asking, wrong amount | 1 (a foreign-currency card spend: it logged the card limit, ₹99,999.90, instead of SGD 100, at full confidence) |
| Logged without asking, not a real payment | 2 (card bill "payment received" notices) |

Why the 46 were missed:

| Count | Reason | Example wording |
|---|---|---|
| 19 | No verb it knows | `Dr.` / `Cr.`, "Txn reversal of", "refunded by" |
| 17 | No account number in the text | "your account is credited INR 15179 by UPI Ref No…" |
| 5 | No amount found | foreign currency, interest credit |
| 5 | A safety filter fired by mistake | "Never Share PIN/OTP" in the footer; "reversed" |

Caveats: this set has one message per wording (so rare wordings count as much
as common ones), it leans towards credit cards, and I supplied the sender names.
Your own messages will score differently. Re-run:
`PINCH_CORPUS_DIR=private/public-sms npm run corpus:score`.

**What this says.** The sign bug you hit (PhonePe ₹38) is real but not the main
weakness. The main weaknesses are *silently ignoring* real payments and *missing
names*. A model that only improves the sign would fix the wrong thing.

## 2. What exists outside

- **A ready model**: `allwin-antony/indian-bank-sms-ner` (Apache-2.0). A small
  language model (MiniLM) that tags amount, account, merchant and bank in a
  message. 22 MB compressed. Its author reports: amount 99%, account 90%,
  merchant 82%, direction 98.4%. It was trained on 5,743 real messages that
  were labelled by a rule parser and checked by Gemini; the messages are not
  published.
- **The same author's app** (`allwin-antony/Expense_tracker`) does not use that
  model to read amounts. It uses a 171 KB word-pattern classifier (fastText
  style, plain code, no ML library) only to decide "transaction / promo / OTP /
  info", then rules pull out the fields.
- **Samsung's paper** (arXiv 2002.02755) has the same shape: classify first,
  then rule-style extraction.
- **PennyWise** (AGPL, 157 banks, 24 countries): one hand-written parser per
  bank, chosen by sender. Its AI is a chat feature, not the parser.
- **No public set of real, labelled Indian bank SMS exists.** The ones on
  Kaggle and Hugging Face are made-up bank statements.
- **The regulation helps us.** Every business SMS in India must match a
  template registered with the telecom operators (DLT): fixed words, with
  blanks for the changing parts. So a bank cannot send free-form text. Each
  bank has a small, fixed set of sentence shapes.
- **Running a model on the phone**: `react-native-executorch` works with our
  Expo setup but its smallest text model is 91 MB. Google's on-phone Gemini
  Nano only exists on recent flagships (Pixel 8+, Galaxy S24+), so it cannot be
  the main path for a student app.

## 3. Why not replace the rules with a model

1. On the thing that matters most (sign and amount) the rules already beat the
   published model: 100% and 99% here against its 98.4% and 99%.
2. Money needs exact figures. A model that is right 98% of the time puts a
   wrong row in the ledger about once a week for an active user, and it cannot
   say why.
3. The only trained model available learned from a rule parser's answers. It
   can copy that parser's mistakes but not exceed it by much.
4. 22–91 MB and a native library, for an app that is otherwise small and offline.
5. We have no labelled data of our own yet. Training comes after measuring.

## 4. The idea: three opinions, and silence is not allowed

```
message
  │
  ├─ 1. Known shape?   (template memory)  ── yes ─► read the blanks, log it
  │
  ├─ 2. Rules          (today's parser)   ─┐
  ├─ 3. Small model    (second opinion)   ─┤
  │                                        ├─ both agree, rules confident ─► log it
  │                                        ├─ they disagree               ─► Review
  │                                        └─ rules say nothing, model
  │                                           says "this is a payment"    ─► Review
  └─ nobody thinks it is a payment ─► ignore
```

**Part 1: template memory (new, no ML).** Blank out the changing parts of a
message (numbers, dates, names, UPI ids) and what is left is the bank's
template, for example
`INR <amt> debited A/c no. <acct> <date> UPI/P2M/<ref>/<name> … Axis Bank`.
Store each template once with: is it a payment, which way the money goes,
which blank is the amount and which is the name. After you confirm one message
of a template in Review, every later message with the same shape is read by
position. No guessing, and one correction fixes that wording forever (and
`revalidateHistory` can repair old rows of the same shape). The app can ship
with a starter list built from public samples and your own corpus. This is how
log-analysis tools work (the "Drain" method), applied to SMS.

**Part 2: the rules stay** for shapes nobody has confirmed yet.

**Part 3: a small model as a second opinion, not the reader.** A word-pattern
classifier of about 200 KB, written in plain TypeScript, answering two
questions only: "is this a payment?" and "in or out?". It never reads an
amount. Its two jobs:
- *Catch what the rules ignore.* Today a missed message vanishes. With this,
  it lands in Review with "This looks like a payment. Is it?"
- *Check the sign.* If rules and model disagree, ask instead of logging.

**The rule that ties it together:** a row is logged without asking only when
the template is confirmed, or when the rules are confident *and* the model
agrees. Everything else that might be money goes to Review. Two independent
readers being wrong in the same way on the same message is far rarer than one.

**Later, only if needed:** the 22 MB tagging model, or Gemini Nano where the
phone has it, used only to suggest a *name* when the rules find none. A wrong
name is harmless compared with a wrong sign, so this is the right place for a
heavier model, and it can be an optional download.

## 5. Targets to hold it to

Measured on your own messages plus the public set, on every change:

- Logged without asking and wrong (sign or amount): under 1 in 200.
- Real payment silently ignored: under 1 in 100.
- Sent to Review: under 15 in 100, falling as templates get confirmed.

## 6. Order of work

1. **Fix the rules against the public set** (about a day, no ML): `Dr.`/`Cr.`,
   "refunded/reversal", credits with no account number, the footer-OTP false
   alarm, and the foreign-currency amount bug. Keep the 145 messages as a
   permanent test. Expect "noticed" to go from 67% to above 90%.
2. **Measure on your backup** (needs you to type the passphrase once in your
   own terminal). This gives the real numbers and the labelled data.
3. **Template memory**: one new table, one migration. Biggest accuracy gain
   per line of code, and it is the part that "learns".
4. **Small classifier**: train on this laptop from step 2's labels, ship the
   weights as a JSON file.
5. **Name helper**: only if names are still poor after 1–4.

Also worth borrowing from `bank-sms-parser`: it tags a message as the *first
notice*, an *early notice*, a *repeat*, or a *late detail* of one payment.
That is the clean fix for the duplicate you saw 35 minutes apart.

## Sources

- https://huggingface.co/allwin-antony/indian-bank-sms-ner
- https://github.com/allwin-antony/Expense_tracker
- https://arxiv.org/abs/2002.02755
- https://github.com/akhilnarang/bank-sms-parser
- https://github.com/saurabhgupta050890/transaction-sms-parser
- https://github.com/sarim2000/pennywiseai-tracker
- https://www.smsgatewaycenter.com/blog/trai-dlt-mandatory-variable-tagging-sms-templates/
- https://docs.webengage.com/docs/trai-sms-dlt-regulations-india
- https://jiemingzhu.github.io/pub/pjhe_icws2017.pdf (Drain)
- https://docs.swmansion.com/react-native-executorch/docs/0.8.x/benchmarks/model-size
- https://developers.google.com/ml-kit/genai
- https://arxiv.org/pdf/2401.12708 (when a model should decline to answer)
