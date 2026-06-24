# Telegram Interactive Bot — Design Spec

**Date:** 2026-06-24
**Status:** Approved
**Scope:** Transform the existing one-way Telegram notification provider into a full interactive bot serving as the primary mobile interface for Nudlers.

---

## 1. Problem Statement

The current Telegram integration (`utils/messaging/telegramProvider.js`) is a one-way notification channel — it can only send daily summaries, restart notifications, and test messages. Meanwhile, the system has grown to include budget tracking, anomaly detection, transaction reconciliation, balance projections, and MCP tools. None of these are accessible from Telegram.

The goal is to make the Telegram bot a complete daily-use financial management interface: query data, add expenses, categorize transactions, trigger syncs, and ask natural-language financial questions — all without opening the web UI.

---

## 2. Architecture

### Approach: Monolithic Bot Module

Single module inside the Next.js process. grammY framework with long-polling. Direct function imports for data access (no HTTP self-calls).

```
utils/telegram-bot/
  bot.ts              — grammY instance, middleware stack, polling lifecycle
  auth.ts             — chat ID whitelist guard middleware
  cache.ts            — in-memory TTL cache with write-through invalidation
  handlers/
    start.ts          — /start welcome + main menu keyboard
    status.ts         — /status → budget overview, cashflow, burndown
    transactions.ts   — /recent, /search, browse with pagination
    expense.ts        — /expense → quick parse or guided flow
    summary.ts        — /summary → on-demand AI daily summary
    triage.ts         — /triage → uncategorized transaction categorization flow
    sync.ts           — /sync → trigger bank scraping + status updates
    settings.ts       — /settings → AI model switch, summary mode, config view
    ai.ts             — free-text fallback → generateText() via aiClient
  keyboards.ts        — shared inline keyboard builders
  formatters.ts       — MarkdownV2 formatting, escaping, templates
  i18n.ts             — Hebrew string constants
  types.ts            — shared TypeScript types
```

### Lifecycle

- Bot polling started in `instrumentation.ts` alongside existing cron jobs and WhatsApp client
- Graceful shutdown on SIGTERM (grammY `bot.stop()`)
- Error boundary via `bot.catch()` — errors never crash the Next.js process

### Data Access

Direct imports from existing modules:
- `getDB()` from `pages/api/db.js` for database queries
- `generateDailySummary()` from `utils/summary.js`
- `generateText()` from `utils/aiClient.js`
- Transaction/budget/category query logic extracted from existing API routes

### AI Layer

Reuses the existing `aiClient.js` infrastructure. Supports any OpenAI-compatible provider:
- Gemini (via OpenRouter or direct)
- Claude (via OpenRouter or Anthropic API)
- DeepSeek (via OpenRouter or direct)

User configures `ai_base_url`, `ai_api_key`, `ai_model` in app_settings. Bot's `/settings` command allows switching model on the fly.

---

## 3. Authentication & Security

### Chat ID Whitelist

grammY middleware checks `ctx.chat.id` against the `telegram_to` setting (comma-separated chat IDs, already exists).

```
Update arrives
  → auth middleware: ctx.chat.id in whitelist?
    → No: log warning, drop update silently
    → Yes: pass to handler chain
```

### Vault Awareness

Commands requiring DB access check vault status. If vault is locked, return:
> "הכספת נעולה 🔒 יש לפתוח דרך הממשק"

### No Extra Auth

Single-user self-hosted app. Chat ID whitelist is sufficient. No PIN, no password prompt.

---

## 4. Commands & Features

### 4.1 Main Menu (`/start`)

Welcome message + inline keyboard grid:

```
📊 סטטוס תקציב  |  💳 עסקאות אחרונות
➕ הוצאה חדשה    |  🔍 חיפוש עסקאות
📋 סיכום יומי    |  🔄 סנכרון
🏷️ סיווג עסקאות  |  ⚙️ הגדרות
```

### 4.2 `/status` — Budget & Cashflow Overview

Queries `budgets`, `transactions`, `total_budget`, `accounts` tables.

Displays:
- **Monthly cashflow:** income vs expenses vs net (from monthly-summary API logic)
- **Budget utilization:** total spent/budget with emoji progress bar (▓░)
- **Top 3 categories** by spending with status indicators (✅ 🟡 ⚠️)
- **Burndown:** rate vs target, days remaining, on-track status
- **Account balances** (if available)

### 4.3 `/recent` — Browse Recent Transactions

- Last 10 credit card transactions, paginated (◀️ ▶️ inline buttons)
- Each transaction shows: date, name, amount, category
- ✏️ button per transaction → inline keyboard of categories → instant re-categorization
- Cache: 30s TTL, busted on category update

### 4.4 `/search <query>` — Transaction Search

- Free-text search by description
- Results paginated with inline keyboards
- Filter buttons: by category, by date range, by amount range
- Complex filter state stored in session, not in callback data

### 4.5 `/expense` — Quick Expense Entry

**Two modes:**

1. **Quick parse:** `/expense קפה 15` or `/expense 15 EUR coffee אוכל`
   - Parses: name, amount, optional currency code, optional category
   - Currency support: ILS (default), EUR, USD, GBP
   - Income: prefix `+` for positive amounts (`/expense +500 החזר`)

2. **Guided flow:** `/expense` alone →
   - Ask name → ask amount → category picker (inline keyboard) → confirm
   - Cancel button available at every step

Uses same logic as MCP `add_manual_expense` tool.
Cache invalidation: busts budget/transaction caches on successful write.

### 4.6 `/summary` — On-Demand Daily Summary

Calls existing `generateDailySummary()`. Same AI-powered report as the daily cron, but on demand. Includes anomaly preamble if any detected.

### 4.7 `/triage` — Uncategorized Transaction Categorization

"Swipe-style" categorization flow:
1. Fetch all uncategorized transactions from DB
2. Display first transaction with inline keyboard of common categories
3. User taps category → update DB → show next transaction
4. Repeat until list empty
5. Summary: "סיום! סיווגת 8 עסקאות ✅"

Buttons are stateless (transaction ID + category in callback data) — survives bot restart mid-flow.

### 4.8 `/sync` — Trigger Bank Sync

- Triggers scraper run via existing `trigger_full_sync` logic
- Shows "מסנכרן... ⏳" message
- Updates message with results when sync completes (or times out)
- Reports per-vendor success/failure

### 4.9 `/settings` — Bot Settings

Inline keyboard submenu:
- Current AI model display + switch (preconfigured options)
- Summary mode toggle (calendar / billing cycle)
- Bot status info (uptime, cache stats)

### 4.10 Free-Text → AI Fallback

Any message not matching a command routes to `generateText()` with a financial context system prompt.

**System prompt includes** (loaded from cache):
- Current month budget status
- Recent transactions summary
- Category list
- Account info

Supports Hebrew and English naturally (AI handles both).

**Graceful degradation:** If AI fails, respond:
> "לא הצלחתי לעבד את הבקשה. נסה פקודה ספציפית כמו /status או /recent"

---

## 5. Session State Management

### grammY Session Middleware (In-Memory)

```typescript
interface BotSession {
  conversation?: {
    type: 'expense' | 'triage' | 'search_filter';
    step: string;
    data: Record<string, unknown>;
  };
  pagination?: {
    command: string;
    offset: number;
    filters?: Record<string, unknown>;
  };
}
```

**Why in-memory:**
- Single user — no persistence needed across restarts
- Restart = session resets = user starts over (acceptable)
- No DB pollution with ephemeral state

### Callback Data Strategy (64-char limit)

Short prefixes + IDs. Filter state in session, not callback.

```
"cat:Food"           → set category to Food
"pg:recent:20"       → paginate recent, offset 20
"tr:edit:12345"      → edit transaction #12345
"tri:cat:12345:Food" → triage: categorize txn 12345 as Food
"exp:confirm"        → confirm expense entry
"exp:cancel"         → cancel expense flow
"menu:status"        → main menu → status
```

### Multi-Step Flow Guards

- **Double-tap mitigation:** First action in callback handler = update session state + replace keyboard with loading indicator. Second tap sees updated state, becomes no-op.
- **`answerCallbackQuery()`:** Always called, even on error (with error text as toast).
- **Clean restart:** Running `/triage` again fully resets `session.conversation` and re-fetches from DB.

---

## 6. Cache Layer

### In-Memory TTL Map

```typescript
const cache = new Map<string, { data: unknown; expires: number }>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.data as Promise<T>;
  const promise = fn();
  promise.then(data => cache.set(key, { data, expires: Date.now() + ttlMs }));
  return promise;
}
```

### TTL Strategy

| Data | TTL | Reason |
|---|---|---|
| Auth whitelist (`telegram_to`) | 5 min | Almost never changes |
| Budget totals | 2 min | Changes on write operations |
| Categories list | 5 min | Rarely changes |
| Recent transactions | 30 sec | Stale fast after sync |
| Monthly summary data | 1 min | Heavy query, tolerable staleness |
| AI context snapshot | 2 min | Rebuilt for free-text queries |

### Write-Through Invalidation

Write operations bust relevant cache keys immediately:
- `/expense` success → bust `budget:*`, `transactions:*`
- `/triage` category update → bust `transactions:*`
- `/sync` complete → bust all data caches
- `/settings` change → bust `settings:*`

---

## 7. Message Formatting

### MarkdownV2

All bot messages use Telegram MarkdownV2 format. A dedicated `formatters.ts` module handles:

- **Auto-escaping** of all MarkdownV2 special characters in dynamic values: `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`
- **Consistent templates** for each command output
- **Currency formatting:** ₪ symbol, thousands separator
- **Date formatting:** Hebrew locale (DD/MM)
- **Progress bars:** emoji blocks (▓░) for budget utilization

### Language

All bot UI text in Hebrew. AI responses may be mixed Hebrew/English based on user input language.

---

## 8. Error Handling

### Three-Layer Strategy

**Layer 1 — grammY Error Boundary (`bot.catch`):**
- Catches unhandled errors from any handler
- Logs full error with stack trace
- Sends generic Hebrew error message to user
- Never crashes the Next.js process

**Layer 2 — Per-Handler Try/Catch:**
- Specific error types get specific Hebrew messages:
  - DB connection failure: "בעיית חיבור למסד נתונים"
  - Vault locked: "הכספת נעולה 🔒 יש לפתוח דרך הממשק"
  - AI error: `mapAIError()` → Hebrew translation
  - Scraper timeout: "הסנכרון לוקח זמן, ננסה שוב מאוחר יותר"
  - No data: "לא נמצאו נתונים לתקופה זו"

**Layer 3 — Callback Query Error Toast:**
- Inline button errors shown as toast via `answerCallbackQuery({ text: errorMsg, show_alert: true })`
- User sees feedback without losing keyboard context

---

## 9. Dependencies

### New Dependencies

| Package | Purpose | Size |
|---|---|---|
| `grammy` | Telegram Bot framework | ~50KB |
| `@grammyjs/conversations` | Multi-step flow management | ~10KB |

### Existing Dependencies (reused)

- `openai` — AI client (already installed)
- `date-fns` — Date formatting (already installed)
- `node-cron` — Already used for daily summary scheduling
- `pino` — Logging (already installed)

---

## 10. Migration from Current Telegram Provider

The existing `telegramProvider.js` (one-way sender) remains unchanged. The bot module is additive:

- Daily summary cron continues using `sendNotification()` dispatcher
- Bot adds interactive capabilities on top
- Both share the same `telegram_bot_token` and `telegram_to` settings
- No breaking changes to existing messaging infrastructure

---

## 11. File Changes Summary

### New Files
- `utils/telegram-bot/bot.ts`
- `utils/telegram-bot/auth.ts`
- `utils/telegram-bot/cache.ts`
- `utils/telegram-bot/keyboards.ts`
- `utils/telegram-bot/formatters.ts`
- `utils/telegram-bot/i18n.ts`
- `utils/telegram-bot/types.ts`
- `utils/telegram-bot/handlers/start.ts`
- `utils/telegram-bot/handlers/status.ts`
- `utils/telegram-bot/handlers/transactions.ts`
- `utils/telegram-bot/handlers/expense.ts`
- `utils/telegram-bot/handlers/summary.ts`
- `utils/telegram-bot/handlers/triage.ts`
- `utils/telegram-bot/handlers/sync.ts`
- `utils/telegram-bot/handlers/settings.ts`
- `utils/telegram-bot/handlers/ai.ts`

### Modified Files
- `instrumentation.ts` — add bot polling startup
- `package.json` — add `grammy`, `@grammyjs/conversations`

### Unchanged
- `utils/messaging/telegramProvider.js` — existing one-way sender preserved
- `utils/messaging/dispatcher.js` — daily summary dispatch unchanged
- All existing API routes — untouched
