# Telegram Bot Overhaul — Design Spec

**Date:** 2026-06-25
**Status:** Approved
**Scope:** Plugin adoption, message formatting overhaul, new commands, bug fixes

---

## 1. Overview

Overhaul the Nudlers Telegram bot to adopt official grammY plugins, redesign message formatting for readability, add new commands (`/cancel`, `/budget`, `/report`), and fix existing bugs.

### Goals
- Eliminate manual MarkdownV2 escaping via `@grammyjs/parse-mode` (`fmt` tagged templates)
- Cleaner message layouts with section separators and card-style transaction display
- Leverage grammY ecosystem: hydrate, menu, auto-chat-action, ratelimiter, autoquote
- Native Telegram command menu and bot description
- Fix broken `/search` flow

### Non-Goals
- Mini Apps / Web App integration
- Inline mode
- Multi-language support (Hebrew-only)
- Migration to webhook mode (stay on polling)

---

## 2. Plugin Adoption

### New Dependencies

| Package | Purpose |
|---------|---------|
| `@grammyjs/parse-mode` | `fmt` tagged templates, `autoParseMode()` middleware |
| `@grammyjs/hydrate` | `msg.editText()`, `msg.delete()` on message objects |
| `@grammyjs/menu` | Declarative menu system with navigation |
| `@grammyjs/auto-chat-action` | Auto "typing..." indicator while handlers process |
| `@grammyjs/ratelimiter` | Per-user rate limiting |
| `@roziscoding/grammy-autoquote` | Reply quotes user's original message |

### Removed Dependencies

| Package | Reason |
|---------|--------|
| `@grammyjs/conversations` | Installed but never used; custom session flows sufficient |

### Middleware Stack Order

```
1. session()
2. hydrate()
3. autoChatAction()
4. autoParseMode()
5. authMiddleware()
6. ratelimiter()
7. mainMenu (Menu plugin)
8. command handlers
9. callback query handlers
10. message:text handler (expense flow → search flow → AI fallback)
```

### Context Type Update

```typescript
type BotContext = HydrateFlavor<ParseModeFlavor<Context & SessionFlavor<BotSession>>>;
```

---

## 3. Message Formatting Overhaul

### Principle

Every message gets breathing room — clear sections, line breaks, visual hierarchy. All formatting uses `fmt` tagged templates instead of manual `escapeMarkdownV2()`.

### Formatting Rules

- `━` (thick line) for section separators
- `┄` (dotted line) for transaction card separators
- Empty line before/after each section
- Indentation with spaces for sub-items
- Emoji prefix per line type
- Bold for titles only, not data values

### Transaction Card Style

Used by `/recent`, `/search`, `/triage`:

```
📝 שופרסל דיזנגוף
💰 ₪245  ·  📅 23/06
🏷 מזון
```

Cards separated by `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`.

### Status Message (`/status`)

Sections: title → cashflow (income/expenses/net) → budget utilization (progress bar + rate) → top 3 categories → burndown indicator. Each section separated by `━━━━━━━━━━━━━━━━`.

### Budget Message (`/budget` — new)

Header with total progress bar → per-category rows sorted by % used descending. Each category shows: emoji + name, progress bar + percentage, amount/limit, remaining with status indicator.

### Report Message (`/report` — new)

Period selector (weekly/monthly) via inline keyboard. Sections: summary (total + daily avg) → by category (with percentages) → trend (vs previous period + biggest expense).

### i18n Changes

- Remove pre-escaped `\\.` sequences from all strings — no longer needed with `fmt`
- Add new strings for `/budget`, `/report`, `/cancel`
- Add separator constants

---

## 4. New Commands

### `/cancel`

Exit any active guided flow (expense, triage, search). Clears `ctx.session.conversation`, replies "❌ בוטל".

### `/budget`

Full per-category budget breakdown. Queries `budgets` + `transactions` tables. Shows progress bar per category, alerts for >80% usage, sorted by % used descending. Cached 2 minutes.

### `/report`

Weekly or monthly spending report. Inline keyboard to pick period. Shows:
- Total expenses and daily average
- Category breakdown with percentages
- Trend comparison vs previous period
- Biggest single expense

Queries `transactions` with date ranges. Cached 5 minutes.

---

## 5. Enhanced Existing Commands

### `/recent` — Simplify Edit Buttons

**Problem:** 10 edit buttons per page, one per transaction, clutters the view.
**Fix:** Single "✏️ ערוך קטגוריה" button at bottom. Tapping shows numbered transaction list → user picks number → category picker appears.

### `/search` — Fix Broken Flow

**Problem:** `bot.ts:50-53` clears session conversation but never calls `handleSearch` with the query.
**Fix:** Call `handleSearch(ctx, query, 0)` after capturing query text.

### `/summary` — Format AI Output

**Problem:** AI response sent without `parse_mode`.
**Fix:** Apply formatting to AI output or send as plain text with proper structure.

### `/expense` — Card-Style Confirmation

**Problem:** Confirmation message is dense single-line.
**Fix:** Use card layout with clear name/amount/category lines.

### `/settings` — Expand Options

Add notification toggle and billing cycle day configuration.

### `/start` — Richer Welcome

Add bot description text and quick-start tips.

---

## 6. Bot Profile Setup

On bot startup, register commands and description with Telegram:

```typescript
await bot.api.setMyCommands([
    { command: 'start', description: 'תפריט ראשי' },
    { command: 'status', description: 'סטטוס תקציב' },
    { command: 'recent', description: 'עסקאות אחרונות' },
    { command: 'expense', description: 'הוצאה חדשה' },
    { command: 'search', description: 'חיפוש עסקאות' },
    { command: 'budget', description: 'פירוט תקציב' },
    { command: 'report', description: 'דוח שבועי/חודשי' },
    { command: 'summary', description: 'סיכום יומי' },
    { command: 'sync', description: 'סנכרון בנקים' },
    { command: 'triage', description: 'סיווג עסקאות' },
    { command: 'settings', description: 'הגדרות' },
    { command: 'cancel', description: 'ביטול פעולה' },
]);

await bot.api.setMyDescription(
    'הבוט הפיננסי של Nudlers 💰\nמעקב הוצאות, תקציבים וסנכרון בנקים ישראליים'
);
await bot.api.setMyShortDescription('מעקב הוצאות ותקציבים');
```

---

## 7. Rate Limiting

- `/sync` — max 1 call per 5 minutes per user
- General — max 30 messages per minute per user
- Applied after auth middleware so unauthorized users don't consume rate limit slots

---

## 8. Auto Chat Action

"Typing..." indicator shown automatically for:
- `/status`, `/budget`, `/report`, `/summary`, `/sync` — long-running DB/API calls
- `/expense` quick-add — DB insert
- AI fallback — LLM call

Handled by `@grammyjs/auto-chat-action` plugin globally — no per-handler code needed.

---

## 9. File Changes

| File | Action | Summary |
|------|--------|---------|
| `package.json` | Update | Add 6 deps, remove 1 |
| `bot.ts` | Refactor | Plugin setup, middleware chain, `/cancel`, search fix, bot profile |
| `types.ts` | Update | Add `HydrateFlavor`, `ParseModeFlavor` to context type |
| `formatters.ts` | Refactor | Remove `escapeMarkdownV2`/`formatTransaction`, add `fmt`-based card builders, separators |
| `i18n.ts` | Update | New strings, remove pre-escaped sequences, add separator constants |
| `keyboards.ts` | Refactor | `mainMenuKeyboard()` → Menu plugin, simplify edit buttons |
| `handlers/status.ts` | Refactor | `fmt` templates, section separators |
| `handlers/transactions.ts` | Refactor | Card-style, simplified edit, search fix |
| `handlers/expense.ts` | Refactor | `fmt` templates, card-style confirmation |
| `handlers/summary.ts` | Refactor | Format AI output |
| `handlers/triage.ts` | Refactor | `fmt` templates, card-style |
| `handlers/sync.ts` | Refactor | `hydrate` for editText, `fmt` |
| `handlers/settings.ts` | Refactor | `fmt`, expanded settings |
| `handlers/ai.ts` | Update | Format response, link preview control |
| `handlers/budget.ts` | **New** | Per-category budget breakdown |
| `handlers/report.ts` | **New** | Weekly/monthly report with period picker |

---

## 10. Testing

- All existing tests updated for new context type flavors
- Mock updates for `fmt` output format (entities instead of escaped strings)
- New test files: `budget.test.ts`, `report.test.ts`
- Test `/cancel` clears session state
- Test search flow actually calls handler
- Test rate limiting on `/sync`
