# Spotify-Inspired Finance App — Master UI Prompt for Claude Code

Design and implement the application's UI as a premium **Spotify-inspired personal finance app for college students**.

Use the provided Spotify design system as the visual foundation, but translate its design language into finance. This is NOT a Spotify clone and must not contain music-specific UI, branding, fake playlists, album-art dependencies, or unnecessary imitation.

## Core visual idea

**Dark. Vibrant. Confident. Minimal. Data-forward. Tactile.**

The interface should feel like a polished consumer product that could have been designed by a professional product-design team.

It must NOT look like:

- a generic AI-generated dashboard
- a banking admin panel
- a Bootstrap/Tailwind component gallery
- a crypto app
- excessive glassmorphism
- a purple gradient AI app

Use the Spotify aesthetic's strongest qualities:

- near-black background
- dark layered surfaces
- vibrant green accent
- bold typography
- strong hierarchy
- compact lists
- confident pills/buttons
- subtle elevation
- expressive but restrained cards
- excellent information density
- purposeful motion

## Color system

Use these exact base colors unless a documented accessibility reason requires a derived shade:

Spotify Green: `#1ed760`
Near Black: `#121212`
Surface: `#181818`
Mid Dark: `#1f1f1f`
White: `#ffffff`
Silver: `#b3b3b3`
Negative: `#f3727f`
Warning: `#ffa42b`
Announcement: `#539df5`

Green is semantic. Use it for primary actions, active navigation, positive states, progress, completion, and important emphasis. Do not make entire sections green simply to make them look colorful.

## Typography

Use a modern system sans-serif with excellent number rendering.

Screen title: 24px / 700
Feature heading: 18px / 600
Body: 16px / 400–600
Caption: 14px / 400
Small bold: 12px / 700
Primary action: 14px / 700 / uppercase / slight letter spacing
Hero financial amount: 32–42px / 600–700

Financial numbers are the visual heroes.

## Layout

Use an 8-point spacing system:

4 / 8 / 12 / 16 / 24 / 32 / 40 / 48

Default horizontal page padding: 20–24px.

Use substantial negative space around major numbers and section headings.

Do not fill every inch of the screen.

## Surfaces and radius

Background: `#121212`

Main surfaces: `#181818`

Interactive/elevated surfaces: `#1f1f1f`

Use 8–16px corners for most containers.

Use pill radius for primary/secondary buttons and compact chips.

Use circular shapes for icon actions where appropriate.

Avoid giant rounded containers around every element.

## Elevation

Use very subtle elevation.

Prefer contrast between surfaces over heavy shadows.

Dialogs and bottom sheets can have stronger separation.

## Navigation

Five persistent bottom tabs:

**Today | Outings | Savings | Split | Insights**

Use one consistent icon family.

Active tab uses Spotify green.

Inactive tabs use silver.

The navigation should remain visually stable while content transitions subtly.

## Translate Spotify concepts into finance

Do not directly copy Spotify functionality. Translate its interaction grammar:

Spotify hierarchy → finance hierarchy

Album art → contextual finance icons / category visuals

Playlist → savings goal / outing / financial collection

Track row → transaction row

Progress bar → budget or savings progress

Play button → primary action

Discover Weekly → personalized financial insight

Now Playing → focused transaction/goal detail

Library → organized goals/financial records

The result must still feel unmistakably like a finance product.

## Today

Question answered:

**What can I safely spend today?**

Screen hierarchy:

1. Today title
2. Bank balance
3. Available budget
4. Protected amount
5. Large "Safe to spend today" amount
6. Thin budget progress indicator
7. Transaction ledger
8. Small attention/action area

Example hero:

`₹187`

`SAFE TO SPEND TODAY`

`₹92 remaining today`

The transaction list should feel premium and dense, like a high-quality media list:

Merchant
Category · Time
Amount aligned right

Do not wrap every transaction in a separate card.

## Outings

Question answered:

**What future occasion am I preparing financially for?**

Use tasteful expressive cards/rows.

Example:

🎂 Rahul's Birthday

Oct 4

₹900 reserved / ₹1,500 planned

ON TRACK

The visual focus is the event name + money + date.

Avoid turning the page into a travel planner.

## Savings

Question answered:

**What do I want to afford and what can I realistically save?**

Prioritize:

- total saved
- realistic monthly saving capacity
- goals
- progress
- contribution pace
- estimated completion

Goal rows should feel like premium library items with clear metadata.

Example:

💻 Laptop

₹18,000 / ₹60,000

₹1,800 / month · Jul 2027

ON TRACK

Goal creation should feel like a focused guided flow, not a giant form.

## Split

Question answered:

**What do I owe, and what do others owe me?**

Top-level amounts:

You owe

Owed to you

Net

Then clean people/group rows.

Support:

- equal
- item
- exact
- percentage
- shares
- custom
- lending
- borrowing
- repayments

Contact selection should feel native and simple.

## Insights

Question answered:

**Where is my money going, what changed, and what could I realistically improve?**

Make this feel like a premium editorial analytics feed rather than a BI dashboard.

Use:

- bold summary numbers
- simple charts
- horizontal comparisons
- concise annotations
- drill-down content
- "What changed?"
- "Where am I leaking money?"
- "What if...?"

Example insight:

**Food spending ↑ ₹420**

Most of the increase came from 4 additional delivery orders.

**View food spending →**

Avoid arbitrary financial scores and chart overload.

## Buttons

Primary:

Filled Spotify-green pill.

Secondary:

Dark pill.

Tertiary:

Outlined.

Icon actions:

Compact circular/rounded control.

Examples:

ADD EXPENSE
CREATE GOAL
CREATE OUTING
SETTLE
SAVE ₹400

Do not use giant floating action buttons.

## Forms and sheets

Use dark fields with subtle borders.

Focused inputs receive a clear green ring.

Errors receive a restrained red ring and concise explanation.

Use bottom sheets for small/medium interactions:

- add expense
- category selection
- split method
- funding source
- review transaction
- filter
- confirmations

Bottom sheets should feel connected to the originating screen.

## Transaction design

This is one of the most important components in the app.

Every transaction row should have:

- small meaningful icon
- merchant/counterparty name
- category or status
- timestamp or secondary metadata
- right-aligned amount

Examples:

Swiggy
Food · 12:42
−₹180

Allowance
Income · 09:40
+₹10,000

Rahul
Needs review · 08:22
−₹1,000

Use semantic color only when it improves comprehension.

## Motion

Use short, polished transitions around 150–220ms.

Animate:

- allocation changes
- progress updates
- transaction insertion
- navigation
- debt settlement
- confirmation

Do not animate everything.

## Empty/error/warning states

These should use the same dark design system.

Example:

Nothing here yet.

Start with your first savings goal.

CREATE GOAL

Errors use `#f3727f`.

Warnings use `#ffa42b`.

Info uses `#539df5`.

Do not rely on color alone; include text/icon semantics.

## Product-level design rules

1. The app should feel like one coherent product.
2. Every page must use the same typography, spacing, radii and surfaces.
3. Do not create one-off components unless genuinely necessary.
4. Numbers and financial decisions have priority over decoration.
5. Use cards for grouped concepts, not every row.
6. Prefer visual hierarchy and whitespace over borders everywhere.
7. Avoid generic fintech clichés.
8. Avoid generic AI-app aesthetics.
9. Never add a new UI pattern merely because the framework makes it easy.
10. When uncertain, choose the simpler, more intentional composition.

## Component architecture

Create reusable components first:

- AppShell
- BottomNavigation
- ScreenHeader
- SectionHeader
- MoneyAmount
- MetricBlock
- MoneyRow
- TransactionRow
- GoalRow
- OutingRow
- PersonRow
- InsightBlock
- ProgressBar
- BudgetBar
- StatusLabel
- AmountInput
- SearchField
- SegmentedControl
- PrimaryButton
- SecondaryButton
- OutlinedButton
- IconButton
- BottomSheet
- ConfirmationSheet
- EmptyState
- ErrorState
- ReviewItem
- Divider

All styling should come from shared design tokens.

## Final quality bar

Before considering the UI complete, inspect every page as if it were being reviewed by a senior product designer.

Ask:

- Is the hierarchy obvious in 2–3 seconds?
- Is the most important number visually dominant?
- Are there unnecessary cards?
- Is the green accent being used meaningfully?
- Does every screen feel related to every other screen?
- Are spacing and typography consistent?
- Does anything look auto-generated, generic, or decorative for no reason?
- Does the app still look excellent when there is very little data?
- Does it remain excellent when there is a lot of data?

The goal is not to imitate Spotify pixel-for-pixel.

The goal is to **translate the confidence, hierarchy, darkness, typography, green accent, compact information architecture, and tactile interactions of Spotify into a sophisticated personal finance product.**
