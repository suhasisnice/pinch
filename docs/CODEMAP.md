# Code map

Drafted by the local model (gpt-oss:20b) from each file's header and exports on 2026-09-24. A map for finding things, not a source of truth. Regenerate: `node scripts/codemap.js`.

## modules/pinch-capture/android/src/main/java/com/suhasisnice/pinchcapture

- `modules/pinch-capture/android/src/main/java/com/suhasisnice/pinchcapture/CaptureBuffer.kt` — holds buffered JSON messages, exposes add() and listener.
- `modules/pinch-capture/android/src/main/java/com/suhasisnice/pinchcapture/FinancialSms.kt` — filters SMS for financial content, exposes isWorthKeeping().
- `modules/pinch-capture/android/src/main/java/com/suhasisnice/pinchcapture/PinchCaptureModule.kt` — React Native module for capturing messages, exposes events and lifecycle hooks.
- `modules/pinch-capture/android/src/main/java/com/suhasisnice/pinchcapture/PinchNotificationListener.kt` — listens for banking notifications, buffers relevant ones.
- `modules/pinch-capture/android/src/main/java/com/suhasisnice/pinchcapture/SmsReceiver.kt` — receives SMS, concatenates parts, buffers potential bank messages.

## plugins

- `plugins/withAbiFilter.js` — config plugin adding abiFilters to Gradle for single-arch APKs.
- `plugins/withGradleTuning.js` — config plugin setting Gradle properties for faster builds and smaller APKs.
- `plugins/withPackageQueries.js` — config plugin adding <queries> for WhatsApp package visibility.
- `plugins/withSqlCipherOpenssl.js` — exports a config plugin that copies libcrypto.so into jniLibs for SQLCipher.

## scripts

- `scripts/adb-reverse.js` — exports a CLI that finds adb and forwards Metro port via adb reverse.
- `scripts/android-sync.js` — exports fingerprint, patchVersion, and a CLI to sync or prebuild Android project.
- `scripts/codemap.js` — exports a CLI that generates CODEMAP.md mapping files to their key exports.
- `scripts/ensure-android-sdk.js` — exports a CLI that writes android/local.properties pointing to the Android SDK.
- `scripts/gradle.js` — exports a CLI that runs the Gradle wrapper with correct platform launcher.
- `scripts/llm.js` — exports a CLI with log, brief, explain, handoff, ask jobs for local model interactions.
- `scripts/shoot.js` — exports a CLI that takes screenshots of preview URLs using a headless browser.

## src/components

- `src/components/AddExpenseSheet.tsx` — default AddExpenseSheet component, TxnType type, and related transaction posting helpers.
- `src/components/AffordSheet.tsx` — default AffordSheet component, Fact helper, verdictColor, verdictHeadline.
- `src/components/BackupSheet.tsx` — default BackupSheet component, BackupError, MIN_PASSPHRASE constants.
- `src/components/BalanceCard.tsx` — default BalanceCard component, UpdateBalanceSheet helper.
- `src/components/BudgetBreakdownSheet.tsx` — default BudgetBreakdownSheet component.
- `src/components/CapSheet.tsx` — default CapSheet component, CapDraft interface.
- `src/components/ContactPicker.tsx` — default ContactPicker component.
- `src/components/Dialog.tsx` — showDialog, showConfirm, showMessage functions, DialogHost component.
- `src/components/FilterSheet.tsx` — default FilterSheet component, uses transaction filtering logic
- `src/components/FreshStartSheet.tsx` — default FreshStartSheet component, shows spending summary
- `src/components/Heroes.tsx` — JarsHero, ChartHero, FacesHero components for tab heroes
- `src/components/Icon.tsx` — default Icon component, IconName type, helper functions for icon lookup
- `src/components/LabelIcon.tsx` — default LabelIcon component, LabelIconBadge helper
- `src/components/LinkedGroupRow.tsx` — default LinkedGroupRow component for grouped ledger rows
- `src/components/MarkAsLoanSheet.tsx` — default MarkAsLoanSheet component for creating loans
- `src/components/Moment.tsx` — celebrate function and MomentHost component for transient messages
- `src/components/Money.tsx` — MoneyAmount component formats numeric amounts with styling and optional plus sign
- `src/components/QuickReimburseSheet.tsx` — QuickReimburseSheet component for fast end‑of‑day reimburse actions
- `src/components/ReconcileSheet.tsx` — ReconcileSheet component offers actions for ledger balance discrepancies
- `src/components/ReimburseLinkSheet.tsx` — ReimburseLinkSheet component links payments to expenses and calculates net amounts
- `src/components/Ring.tsx` — Ring component renders a circular progress indicator with optional child content
- `src/components/SplitModal.tsx` — SplitModal component handles splitting a transaction among participants
- `src/components/TransactionDetailSheet.tsx` — TransactionDetailSheet component displays, edits, splits, or deletes a transaction
- `src/components/WealthParts.tsx` — WealthParts exports multiple sheets: PaydayChecklist, Stepper, PlanSheet, InvestSheet, HabitBars, Milestones, etc.
- `src/components/WeekStrip.tsx` — WeekStrip component, WeekDay interface, Column helper
- `src/components/haptics.ts` — haptic helper object with tick, toggle, press, success, reject
- `src/components/motion.tsx` — motion utilities: duration, easing, useReducedMotion, useCountUp, AnimatedMoney, FadeSlideIn, usePressScale
- `src/components/ui.tsx` — UI library: Screen, Button, Card, FAB, Chip, SearchBar, ProgressBar, Loading, Sheet, Avatar, etc.

## src/db

- `src/db/connection.ts` — database connection: getAdapter, isInitialized, initDatabase, __resetDatabaseForTests, seedMerchantRules
- `src/db/dbService.ts` — re‑exports database API: initDatabase, getAdapter, isInitialized, __resetDatabaseForTests, and all repo modules
- `src/db/expoAdapter.ts` — createExpoAdapter for native SQLite, key handling, legacy migration
- `src/db/expoAdapter.web.ts` — createExpoAdapter for web using sql.js, in-memory demo database
- `src/db/migrations.ts` — Migration interface, migration builders, migration list, and runMigrations function
- `src/db/schema.ts` — exports MIGRATIONS, LATEST_VERSION, runMigrations, initSchema, CATEGORIES, Category type, DEFAULT_MERCHANT_RULES.
- `src/db/types.ts` — Types and interfaces for database rows and transaction metadata

## src/db/repos

- `src/db/repos/balance.ts` — BalanceSnapshot/BalanceState interfaces, recordBalance, getLatestBalanceSnapshot, getBalanceState, getBalanceHistory
- `src/db/repos/budget.ts` — BudgetPeriod interface, dayDiff, decorate, createBudgetPeriod, getCurrentBudgetPeriod, updateBudgetPeriod, ensureBudgetPeriod, startBudgetPeriod, getAllBudgetPeriods
- `src/db/repos/caps.ts` — getSpendCaps, setSpendCap, deleteSpendCap, getSpendRowsBetween, SpendRow interface
- `src/db/repos/capture.ts` — NewCapture interface, recordCapture, getPendingCaptures, getPendingCaptureCount, getCaptureById, setCaptureStatus, rejectCapture, pruneCaptures, categoriseMerchant, learnMerchantRule, getCategoryTokenWeights, smartCategoriseMerchant, bumpTokenWeights
- `src/db/repos/goals.ts` — GoalProgress interface, createGoal, archiveGoal, deleteGoal, updateGoal, getActiveGoals, getGoalById, contributeToGoal, getGoalContributionsBetween, getContributions, getTotalReserved
- `src/db/repos/holdings.ts` — HoldingRow, HoldingSummary interfaces, createHolding, updateHolding, setHoldingPlan, setHoldingValue, archiveHolding, getHoldings, setTransactionHolding, getUnassignedInvested, getInvestedNetBetween, getContributionsByHoldingBetween, getInvestingHistory, getContributedBetween
- `src/db/repos/ious.ts` — NewIOU interface, createIOU, getIOUById, getOpenIOUs, getOpenIOUsForContact, getOpenReceivableByTransaction, getIOUsForOuting, deleteIOU, settleIOU, settleContactBalance, getSettlementsForIOU, getContactBalances, addContact, getContacts, getContactById, findContactIdByName, addContactAlias, findContactIdByNameOrAlias, getContactAliases, sameKnownPerson, updateContact, findOrCreateContactByName, findOrCreateContact, mergeContacts
- `src/db/repos/maintenance.ts` — exports ResetOptions interface and resetData, countData functions for data erasure.
- `src/db/repos/notifications.ts` — exports NewNotificationLog interface and logNotification, getRecentNotifications, countSince, countAllSince, getLastOfType, getRecentBodies, markNotificationRead, recordNotificationAction, pruneNotifications functions.
- `src/db/repos/outings.ts` — exports OutingSummary interface and createOuting, closeOuting, reopenOuting, deleteOuting, updateOuting, getOutings, reserveForOuting, releaseOutingReserve, getOutingReserved, getReserveHistory, getTotalOutingReserved, getOutingById, getActiveOuting, getOutingTransactions, getCandidateTransactions functions.
- `src/db/repos/progress.ts` — exports monthKey, recordNetWorth, getNetWorthHistory, getMilestones, markMilestone, getKeptBetween functions.
- `src/db/repos/rawEvents.ts` — exports RawEventRow interface and recordRawEvent, getRawEventById, getRecentRawEvents, getUnresolvedRawEvents, ParsedEventRow, NewParsedEvent, recordParsedEvent, getParsedEventsForRawEvent, getLatestParsedEvent, RejectionGroup, getRejectionBreakdown, countUnresolvedRawEvents functions.
- `src/db/repos/reimbursements.ts` — exports getReimbursementLinks, getAppliedFromPayment, canBeReimbursement, ReimbursementCandidate interface, getReimbursementCandidates, linkReimbursement, unlinkReimbursement functions.
- `src/db/repos/transactions.ts` — exports NewTransaction interface and addTransaction, setTransactionStatus, getTransactionById, getAllTransactions, getTransactionsBetween, setTransactionCategory, setTransactionOuting, deleteTransaction, updateTransaction, setTransactionExcluded, getExcludedTransactions, getMonthlySpend, getCategoryByMonth, getRepeatMerchants, addToBlocklist, removeFromBlocklist, getBlocklist, isBlocked, getGrossSpendBetween, getIncomeBetween, getOpenReceivablesOnSpendBetween, getSpendByCategory, getDailySpend, findProbableDuplicate functions.

## src/dev

- `src/dev/demoData.ts` — Demo data seeding utilities for a sample user profile

## src/math

- `src/math/budget.ts` — Pure budget calculations, confidence, reserves, and spendability logic
- `src/math/classification.ts` — Non‑spend transaction classification helpers
- `src/math/insights.ts` — Insight calculations: micro‑transactions, late night, categories, streaks
- `src/math/insightsSummary.ts` — Human‑readable findings and hero metrics derived from insights
- `src/math/merchantClassifier.ts` — Naïve Bayes merchant name classification and similarity checks
- `src/math/moments.ts` — Small state change detectors for goals and milestones
- `src/math/patterns.ts` — exports SpendItem, CapScope, Callout, constants, keyFor, tally, findCallouts, SpendCap, CapLevel, capLevel, capMatches, capCrossing, suggestedCap
- `src/math/payday.ts` — exports PayPlan, DEFAULT_PAY_PLAN, MAX_PLAN_SHARE, PaydayKey, PaydayItem, PaydayInput, Payday, roundPlan, clampPlan, payday, splitAcrossGoals, paydayFromData
- `src/math/progress.ts` — exports netWorth, keptRate, HABIT_RATE, habitStreak, habitLine, MilestoneState, MilestoneDef, MILESTONES, reachedMilestones, nextMilestone, milestoneTitle, HabitInsight, habitInsight
- `src/math/recovery.ts` — exports MIN_MISSION_DAYS, MAX_MISSION_DAYS, MIN_TARGET_SHARE, Mission, MissionStatus, MissionProgress, planMission, missionProgress, shouldReplan, addDays, localDay
- `src/math/reimbursement.ts` — exports ReimbursableSpend, ReimbursementAllocation, ReimbursementPlan, planReimbursement, ReimbursementLink, LedgerItem, groupLinkedTransactions
- `src/math/riskWindows.ts` — exports Block, BLOCK_START, LOOKBACK_WEEKS, RISK_RATIO, RISK_MIN_AVERAGE, RISK_MIN_WEEKS, MAX_WINDOWS, LEAD_MINUTES, TimedSpend, RiskWindow, windowOf, findRiskWindows, nextWarningAt, windowName, afterPaydaySpend
- `src/math/splitEngine.ts` — exports SplitMode, SPLIT_MODES, SPLIT_MODE_LABELS, SPLIT_MODE_HINTS, PAYER_ID, SplitParticipant, SplitShare, SplitResult, distribute, calculateSplit, computeSplit, suggestExactAmounts
- `src/math/survivalMode.ts` — exports SURVIVAL_MODE_THRESHOLD, isSurvivalMode, daysLeftInMonth, computeDailySurvivalCap
- `src/math/transactionFilter.ts` — exports transaction filtering types, presets, and apply/summarise functions
- `src/math/transfers.ts` — exports transfer detection logic, scoring, and round‑trip detection
- `src/math/wealth.ts` — exports wealth calculations: holdings, SIP, projections, ladder, and helper utilities
- `src/math/weeklyRecap.ts` — exports weekly recap builder and related slide types

## src/navigation

- `src/navigation/RootNavigator.tsx` — exports navigation stack and tab definitions, RootNavigator component

## src/notifications

- `src/notifications/engine.ts` — exports notification planning logic, settings, and delivery history types
- `src/notifications/messages.ts` — exports notification message templates, types, and title mapping
- `src/notifications/notificationService.ts` — exports notification configuration, scheduling, and response handling functions
- `src/notifications/roasts.ts` — exports RoastContext, RoastKind, roast, allLines, ordinal, ratio

## src/screens

- `src/screens/GoalsScreen.tsx` — exports GoalsScreen, GoalRow, CreateGoalSheet, IconPicker, ManageGoalSheet
- `src/screens/InsightsScreen.tsx` — exports InsightsScreen, FindingRow, WhereItWent, PaceChart, AgainstNormal, toneColor, heroColor
- `src/screens/OutingsScreen.tsx` — exports OutingsScreen, LiveOuting, CreateOutingSheet, OutingDetailSheet, affordabilityLabel, affordabilityStyle
- `src/screens/PlansScreen.tsx` — exports PlansScreen, PlansSwitch
- `src/screens/RecapScreen.tsx` — exports RecapScreen, weekRange, loadWeeklyRecap, SlideBody, CloseButton, describe
- `src/screens/ReviewScreen.tsx` — exports ReviewScreen, rejectWithOptionToBlock, guessHolding
- `src/screens/SettingsScreen.tsx` — exports SettingsScreen, NavRow, Toggle, NavRow, Toggle
- `src/screens/SquadScreen.tsx` — main squad view, contact rows, debt sheets, and add expense modal
- `src/screens/TodayScreen.tsx` — today’s budget snapshot, quips, and cap sheet
- `src/screens/TransactionsScreen.tsx` — transaction list, detail sheet, filters, and split modal
- `src/screens/WealthScreen.tsx` — wealth snapshot, holdings list, investment sheet, milestones, and plan sheet

## src/security

- `src/security/AppLock.tsx` — app lock gate, identity confirmation, and lock status utilities

## src/services

- `src/services/backupFiles.ts` — share backup, pick backup text, and restore from text helpers
- `src/services/backupService.ts` — backup format, sealing, opening, collecting, restoring, and file naming
- `src/services/budgetService.ts` — budget snapshot, kind totals, savings goal, and budget preview utilities
- `src/services/captureService.ts` — ingestMessage, reprocessRawEvent, postTransaction, acceptCapture, ingestBatch, backfillFromInbox, etc.
- `src/services/classificationService.ts` — classifyStoredTransactions, classifyNewTransaction, learnFromCategoryCorrection, backfillCategories.
- `src/services/interventionService.ts` — planTransactionInterventions, scheduleHeadsUps, refreshRecovery, getWeekPatterns.
- `src/services/onboardingService.ts` — runFirstRunSetup.
- `src/services/parserService.ts` — parseMessage, explainRejection, buildDedupKey, ACCEPT_THRESHOLD.
- `src/services/revalidationService.ts` — revalidateHistory, revalidateIfRulesChanged, PARSER_RULES_VERSION.
- `src/services/settlementService.ts` — checkForSettlement, backfillSettlements.
- `src/services/smsPrivacy.ts` — isPersonalSender, isWorthKeeping, redactOtp.
- `src/services/transferService.ts` — exports transfer detection helpers and async functions for finding/marking transfers
- `src/services/wealthService.ts` — exports wealth snapshot, cushion, pay plan, and goal payment utilities

## src/settings

- `src/settings/settingsStore.ts` — exports async getters/setters for monthly allowance, notification settings, and other user prefs

## src/theme

- `src/theme/theme.ts` — exports color palette, spacing, typography, and helper functions for UI theming
- `src/theme/todayTone.ts` — exports setTodayTone and useTodayTone for reactive today color

## src

- `src/types.ts` — exports Transaction, IOU types and related enums

## src/utils

- `src/utils/format.ts` — exports formatAmount, formatMoney, formatTime, and related formatting helpers
- `src/utils/nudge.ts` — exports sendNudge and re‑exports nudge message builders and sanitiser.
- `src/utils/nudgeMessage.ts` — exports buildNudgeMessage, sanitizePhoneForWhatsApp, normalizePhoneForWhatsApp, buildWhatsAppUrl.
