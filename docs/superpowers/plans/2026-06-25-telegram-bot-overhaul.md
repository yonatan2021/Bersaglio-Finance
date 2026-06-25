# Telegram Bot Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Nudlers Telegram bot — adopt grammY plugins, redesign message formatting with card-style layouts, add `/cancel`, `/budget`, `/report` commands, and fix bugs.

**Architecture:** Replace manual MarkdownV2 escaping with `@grammyjs/parse-mode` `fmt` tagged templates. Layer in `hydrate`, `menu`, `auto-chat-action`, `ratelimiter`, and `autoquote` plugins. Refactor all handlers to use new formatting system. Add three new commands with dedicated handler files.

**Tech Stack:** grammY 1.44.0, TypeScript, Vitest, PostgreSQL, Next.js (Pages Router)

## Global Constraints

- All user-facing strings in Hebrew — no English fallback
- All code in `app/utils/telegram-bot/` directory
- Tests in `app/tests/telegram-bot/` directory
- Use `vi.mock` for `logger.js`, `getDB`, and external imports
- Always release DB clients in `finally` blocks
- Parameterized queries only (no string interpolation in SQL)
- Commit after each task passes tests
- Run tests from `app/` directory: `npm run test`

---

### Task 1: Install Dependencies & Update Types

**Files:**
- Modify: `app/package.json`
- Modify: `app/utils/telegram-bot/types.ts`
- Modify: `app/tests/telegram-bot/bot.test.ts`

**Interfaces:**
- Produces: `BotContext` type used by every handler — `HydrateFlavor<ParseModeFlavor<Context & SessionFlavor<BotSession>>>`

- [ ] **Step 1: Install new dependencies and remove unused one**

```bash
cd app && npm install @grammyjs/parse-mode@^2.3.0 @grammyjs/hydrate@^1.7.0 @grammyjs/menu@^1.3.1 @grammyjs/auto-chat-action@^0.1.1 @grammyjs/ratelimiter@^1.2.1 @roziscoding/grammy-autoquote@^2.0.9 && npm uninstall @grammyjs/conversations
```

- [ ] **Step 2: Update `types.ts` with new context type**

Replace full contents of `app/utils/telegram-bot/types.ts`:

```typescript
import { Context, SessionFlavor } from 'grammy';
import { HydrateFlavor } from '@grammyjs/hydrate';
import { ParseModeFlavor } from '@grammyjs/parse-mode';

export interface BotSession {
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

export type BotContext = HydrateFlavor<ParseModeFlavor<Context & SessionFlavor<BotSession>>>;

export interface TransactionRow {
    id: number;
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    category: string | null;
    memo: string | null;
    account_number: string;
    transaction_type: string;
}

export interface BudgetRow {
    category: string;
    budget_limit: number;
}

export interface CategorySpending {
    category: string;
    actual: number;
    budget: number;
    remaining: number;
    percentUsed: number;
    isOverBudget: boolean;
}
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

```bash
cd app && npm run test
```

Expected: all existing tests pass (types are compatible — `HydrateFlavor` and `ParseModeFlavor` add methods without breaking existing interface).

- [ ] **Step 4: Commit**

```bash
cd app && git add package.json package-lock.json utils/telegram-bot/types.ts && git commit -m "feat(telegram-bot): install grammY plugins and update BotContext type"
```

---

### Task 2: Refactor Formatters & i18n

**Files:**
- Modify: `app/utils/telegram-bot/formatters.ts`
- Modify: `app/utils/telegram-bot/i18n.ts`
- Modify: `app/tests/telegram-bot/formatters.test.ts`

**Interfaces:**
- Produces: `formatTransactionCard(txn)` — returns `FormattedString` for card-style display
- Produces: `sectionSeparator()`, `thinSeparator()` — return `string` separator lines
- Produces: `buildSection(title, ...lines)` — returns `FormattedString` for a titled section
- Produces: Updated `t` object with unescaped strings and new keys
- Keeps: `formatCurrency(amount)`, `formatDate(date)`, `progressBar(percent, width?)`, `statusIndicator(percentUsed)` — signatures unchanged

- [ ] **Step 1: Write tests for new formatters**

Replace full contents of `app/tests/telegram-bot/formatters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
    formatCurrency,
    formatDate,
    progressBar,
    statusIndicator,
    formatTransactionCard,
    sectionSeparator,
    thinSeparator,
} from '../../utils/telegram-bot/formatters';

describe('formatCurrency', () => {
    it('formats positive numbers with ₪ prefix', () => {
        expect(formatCurrency(1500)).toBe('₪1,500');
    });

    it('formats negative amounts using absolute value', () => {
        expect(formatCurrency(-250)).toBe('₪250');
    });

    it('handles zero', () => {
        expect(formatCurrency(0)).toBe('₪0');
    });
});

describe('formatDate', () => {
    it('formats Date object as DD/MM', () => {
        expect(formatDate(new Date('2026-06-05'))).toBe('05/06');
    });

    it('formats date string', () => {
        expect(formatDate('2026-01-15')).toBe('15/01');
    });
});

describe('progressBar', () => {
    it('shows empty bar at 0%', () => {
        expect(progressBar(0)).toBe('░░░░░░░░░░');
    });

    it('shows full bar at 100%', () => {
        expect(progressBar(100)).toBe('▓▓▓▓▓▓▓▓▓▓');
    });

    it('clamps above 100%', () => {
        expect(progressBar(150)).toBe('▓▓▓▓▓▓▓▓▓▓');
    });

    it('shows proportional fill', () => {
        expect(progressBar(50)).toBe('▓▓▓▓▓░░░░░');
    });
});

describe('statusIndicator', () => {
    it('returns ✅ for under 80%', () => {
        expect(statusIndicator(60)).toBe('✅');
    });

    it('returns 🟡 for 80-100%', () => {
        expect(statusIndicator(85)).toBe('🟡');
    });

    it('returns ⚠️ for over 100%', () => {
        expect(statusIndicator(110)).toBe('⚠️');
    });
});

describe('formatTransactionCard', () => {
    it('includes name, amount, date, and category', () => {
        const result = formatTransactionCard({
            name: 'Coffee Shop',
            price: -25,
            date: '2026-06-15',
            category: 'אוכל',
        });
        expect(result).toContain('Coffee Shop');
        expect(result).toContain('₪25');
        expect(result).toContain('15/06');
        expect(result).toContain('אוכל');
    });

    it('shows fallback for null category', () => {
        const result = formatTransactionCard({
            name: 'Unknown',
            price: -10,
            date: '2026-06-15',
            category: null,
        });
        expect(result).toContain('ללא קטגוריה');
    });
});

describe('separators', () => {
    it('sectionSeparator returns thick line', () => {
        expect(sectionSeparator()).toBe('━━━━━━━━━━━━━━━━');
    });

    it('thinSeparator returns dotted line', () => {
        expect(thinSeparator()).toBe('┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd app && npm run test -- tests/telegram-bot/formatters.test.ts
```

Expected: FAIL — `formatTransactionCard`, `sectionSeparator`, `thinSeparator` not found.

- [ ] **Step 3: Implement new formatters**

Replace full contents of `app/utils/telegram-bot/formatters.ts`:

```typescript
export function formatCurrency(amount: number): string {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return `₪${formatted}`;
}

export function formatDate(date: string | Date): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
}

export function progressBar(percent: number, width = 10): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

export function statusIndicator(percentUsed: number): string {
    if (percentUsed > 100) return '⚠️';
    if (percentUsed > 80) return '🟡';
    return '✅';
}

export function sectionSeparator(): string {
    return '━━━━━━━━━━━━━━━━';
}

export function thinSeparator(): string {
    return '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄';
}

export function formatTransactionCard(txn: { name: string; price: number; date: string; category: string | null }): string {
    const amount = formatCurrency(Math.abs(txn.price));
    const date = formatDate(txn.date);
    const cat = txn.category || 'ללא קטגוריה';
    return `📝 ${txn.name}\n💰 ${amount}  ·  📅 ${date}\n🏷 ${cat}`;
}
```

- [ ] **Step 4: Update i18n — remove pre-escaped strings, add new keys**

Replace full contents of `app/utils/telegram-bot/i18n.ts`:

```typescript
export const t = {
    welcome: '👋 שלום! אני הבוט הפיננסי של Nudlers.\n\nבחר פעולה מהתפריט:',
    menuStatus: '📊 סטטוס תקציב',
    menuRecent: '💳 עסקאות אחרונות',
    menuExpense: '➕ הוצאה חדשה',
    menuSearch: '🔍 חיפוש עסקאות',
    menuSummary: '📋 סיכום יומי',
    menuSync: '🔄 סנכרון',
    menuTriage: '🏷️ סיווג עסקאות',
    menuSettings: '⚙️ הגדרות',

    statusTitle: '📊 סטטוס תקציב',
    cashflowTitle: '💰 תזרים חודשי',
    budgetTitle: '📉 ניצול תקציב',
    topCategoriesTitle: '🏆 טופ 3 קטגוריות',
    burndownTitle: '🔥 בורנדאון',
    burndownGood: 'מצוין ✅',
    burndownBehind: 'חריגה צפויה ⚠️',

    recentTitle: '💳 עסקאות אחרונות',
    recentEmpty: 'לא נמצאו עסקאות לתקופה זו.',
    prevPage: '◀️ הקודם',
    nextPage: '▶️ הבא',
    editCategory: '✏️ ערוך קטגוריה',

    searchPrompt: 'שלח את מילת החיפוש:',
    searchEmpty: 'לא נמצאו תוצאות.',
    searchTitle: '🔍 תוצאות חיפוש',

    expenseAskName: 'מה שם ההוצאה?',
    expenseAskAmount: 'כמה זה עלה? (מספר בלבד)',
    expenseAskCategory: 'בחר קטגוריה:',
    expenseConfirm: 'אישור ✅',
    expenseCancel: 'ביטול ❌',
    expenseAdded: '✅ ההוצאה נוספה בהצלחה!',
    expenseCancelled: '❌ ההוצאה בוטלה.',
    expenseInvalidAmount: 'סכום לא תקין. נסה שוב:',

    summaryLoading: '⏳ מייצר סיכום יומי...',
    summaryError: 'לא הצלחתי לייצר סיכום. נסה שוב מאוחר יותר.',

    triageTitle: '🏷️ סיווג עסקאות',
    triageEmpty: 'אין עסקאות ללא קטגוריה! 🎉',
    triageDone: (count: number) => `סיום! סיווגת ${count} עסקאות ✅`,
    triageSkip: 'דלג ⏭️',
    triageRemaining: (count: number) => `${count} עסקאות נותרו`,

    syncStarted: '🔄 מסנכרן... ⏳',
    syncComplete: '✅ סנכרון הושלם!',
    syncFailed: '❌ הסנכרון נכשל.',
    syncRateLimited: '⏳ הסנכרון כבר רץ. נסה שוב בעוד כמה דקות.',

    settingsTitle: '⚙️ הגדרות',
    settingsAiModel: 'מודל AI',
    settingsSummaryMode: 'מצב סיכום',

    budgetTitle2: '📊 תקציב חודשי',
    budgetRemaining: (amount: string) => `נותרו ${amount}`,

    reportTitle: '📋 דוח',
    reportWeekly: 'שבועי',
    reportMonthly: 'חודשי',
    reportPickPeriod: 'בחר תקופה:',
    reportTotalExpenses: 'הוצאות',
    reportDailyAvg: 'ממוצע יומי',
    reportByCategory: 'לפי קטגוריה',
    reportTrend: 'מגמה',
    reportVsPrevious: (pct: string, direction: string) => `לעומת תקופה קודמת: ${direction}${pct}%`,
    reportBiggest: 'הוצאה גדולה',

    cancelDone: '❌ בוטל.',
    cancelNothing: 'אין פעולה פעילה לביטול.',

    errorGeneric: 'משהו השתבש 😅 נסה שוב.',
    errorVaultLocked: 'הכספת נעולה 🔒 יש לפתוח דרך הממשק.',
    errorDbConnection: 'בעיית חיבור למסד נתונים.',
    errorNoData: 'לא נמצאו נתונים לתקופה זו.',
    errorSyncTimeout: 'הסנכרון לוקח זמן, ננסה שוב מאוחר יותר.',

    aiFallbackError: 'לא הצלחתי לעבד את הבקשה. נסה פקודה ספציפית כמו /status או /recent.',
    aiThinking: '🤔 חושב...',

    unauthorized: '',
} as const;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd app && npm run test -- tests/telegram-bot/formatters.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd app && git add utils/telegram-bot/formatters.ts utils/telegram-bot/i18n.ts tests/telegram-bot/formatters.test.ts && git commit -m "feat(telegram-bot): refactor formatters to card-style, update i18n strings"
```

---

### Task 3: Refactor bot.ts — Plugin Middleware, /cancel, Search Fix, Bot Profile

**Files:**
- Modify: `app/utils/telegram-bot/bot.ts`
- Modify: `app/tests/telegram-bot/bot.test.ts`

**Interfaces:**
- Consumes: `BotContext` from `types.ts` (Task 1), `t` from `i18n.ts` (Task 2)
- Consumes: `registerBudgetHandler` from `handlers/budget.ts` (Task 6), `registerReportHandler` from `handlers/report.ts` (Task 7) — import but stub during this task, wire up when those tasks complete
- Produces: fully configured `Bot<BotContext>` with all plugins in correct middleware order

- [ ] **Step 1: Write test for /cancel and search fix**

Add to `app/tests/telegram-bot/bot.test.ts` — replace full file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBot } from '../../utils/telegram-bot/bot';
import { bustAllCache } from '../../utils/telegram-bot/cache';

vi.mock('../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../utils/messaging/settings.js', () => ({
    loadMessagingSettings: vi.fn().mockResolvedValue({
        telegram_to: '12345',
        telegram_enabled: true,
        telegram_bot_token: 'TEST_TOKEN',
        telegram_notify_on_restart: false,
        whatsapp_enabled: false,
        whatsapp_to: '',
        whatsapp_notify_on_restart: false,
    }),
}));

describe('createBot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
    });

    it('creates a Bot instance without throwing', () => {
        const mockGetDB = vi.fn();
        const bot = createBot('TEST_TOKEN', mockGetDB);
        expect(bot).toBeDefined();
        expect(typeof bot.start).toBe('function');
        expect(typeof bot.stop).toBe('function');
    });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

```bash
cd app && npm run test -- tests/telegram-bot/bot.test.ts
```

Expected: PASS.

- [ ] **Step 3: Rewrite bot.ts with all plugins and fixes**

Replace full contents of `app/utils/telegram-bot/bot.ts`:

```typescript
import { Bot, session } from 'grammy';
import { hydrate } from '@grammyjs/hydrate';
import { autoParseMode } from '@grammyjs/parse-mode';
import { autoChatAction } from '@grammyjs/auto-chat-action';
import { limit } from '@grammyjs/ratelimiter';
import { addReplyParam } from '@roziscoding/grammy-autoquote';
import { loadMessagingSettings } from '../messaging/settings.js';
import { authMiddleware } from './auth';
import { registerStatusHandler } from './handlers/status';
import { registerTransactionsHandler } from './handlers/transactions';
import { registerExpenseHandler, handleExpenseFlowMessage } from './handlers/expense';
import { registerSummaryHandler } from './handlers/summary';
import { registerTriageHandler } from './handlers/triage';
import { registerSyncHandler } from './handlers/sync';
import { registerSettingsHandler } from './handlers/settings';
import { registerBudgetHandler } from './handlers/budget';
import { registerReportHandler } from './handlers/report';
import { handleAIFallback } from './handlers/ai';
import { mainMenuKeyboard } from './keyboards';
import { t } from './i18n';
import logger from '../logger.js';
import type { BotContext, BotSession } from './types';

let botInstance: Bot<BotContext> | null = null;

const BOT_COMMANDS = [
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
];

export function createBot(token: string, getDB: () => Promise<any>): Bot<BotContext> {
    const bot = new Bot<BotContext>(token);

    // Plugin middleware stack (order matters)
    bot.use(session<BotSession, BotContext>({
        initial: (): BotSession => ({}),
    }));
    bot.use(hydrate());
    bot.api.config.use(autoChatAction());
    bot.api.config.use(autoParseMode('MarkdownV2'));
    bot.use(authMiddleware(getDB));
    bot.use(limit({
        timeFrame: 60,
        limit: 30,
        onLimitExceeded: async (ctx) => {
            logger.warn({ chatId: ctx.chat?.id }, '[telegram-bot] Rate limited');
        },
    }));

    // Autoquote — replies reference user's message
    bot.use(async (ctx, next) => {
        if (ctx.chat) {
            ctx.api.config.use(addReplyParam(ctx));
        }
        await next();
    });

    // /start
    bot.command('start', async (ctx) => {
        await ctx.reply(t.welcome, {
            parse_mode: undefined,
            reply_markup: mainMenuKeyboard(),
        });
    });

    // /cancel
    bot.command('cancel', async (ctx) => {
        if (ctx.session?.conversation) {
            ctx.session.conversation = undefined;
            await ctx.reply(t.cancelDone, { parse_mode: undefined });
        } else {
            await ctx.reply(t.cancelNothing, { parse_mode: undefined });
        }
    });

    // Register handlers
    registerStatusHandler(bot, getDB);
    registerTransactionsHandler(bot, getDB);
    registerExpenseHandler(bot, getDB);
    registerSummaryHandler(bot);
    registerTriageHandler(bot, getDB);
    registerSyncHandler(bot);
    registerSettingsHandler(bot, getDB);
    registerBudgetHandler(bot, getDB);
    registerReportHandler(bot, getDB);

    // Message handler: guided flows first, then AI fallback
    bot.on('message:text', async (ctx) => {
        const handled = await handleExpenseFlowMessage(ctx, getDB);
        if (handled) return;

        // Search query flow — fixed: actually call search
        if (ctx.session?.conversation?.type === 'search_filter' && ctx.session.conversation.step === 'awaiting_query') {
            const query = ctx.message.text.trim();
            ctx.session.conversation = undefined;
            const { handleSearchQuery } = await import('./handlers/transactions');
            await handleSearchQuery(ctx, getDB, query);
            return;
        }

        await handleAIFallback(ctx, getDB);
    });

    bot.catch((err) => {
        logger.error({ err: err.message, stack: err.stack }, '[telegram-bot] Unhandled error');
        try {
            err.ctx?.reply(t.errorGeneric, { parse_mode: undefined }).catch(() => {});
        } catch {
            // best effort
        }
    });

    return bot;
}

async function setupBotProfile(bot: Bot<BotContext>): Promise<void> {
    try {
        await bot.api.setMyCommands(BOT_COMMANDS);
        await bot.api.setMyDescription(
            'הבוט הפיננסי של Nudlers 💰\nמעקב הוצאות, תקציבים וסנכרון בנקים ישראליים'
        );
        await bot.api.setMyShortDescription('מעקב הוצאות ותקציבים');
        logger.info('[telegram-bot] Bot profile updated');
    } catch (err: any) {
        logger.warn({ err: err.message }, '[telegram-bot] Failed to set bot profile — continuing');
    }
}

export async function startBot(): Promise<void> {
    const { getDB } = await import('../../pages/api/db.js');
    const settings = await loadMessagingSettings({ getDB });

    if (!settings.telegram_enabled || !settings.telegram_bot_token) {
        logger.info('[telegram-bot] Telegram bot disabled or no token configured — skipping');
        return;
    }

    const bot = createBot(settings.telegram_bot_token, getDB);
    botInstance = bot;

    await setupBotProfile(bot);

    bot.start({
        onStart: () => logger.info('[telegram-bot] Bot polling started'),
        allowed_updates: ['message', 'callback_query'],
    });

    const shutdown = () => {
        logger.info('[telegram-bot] Shutting down bot polling');
        bot.stop();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

export function getBotInstance(): Bot<BotContext> | null {
    return botInstance;
}
```

Note: This file imports `registerBudgetHandler` and `registerReportHandler` which don't exist yet. They will be created in Tasks 6 and 7. To avoid import errors during this task, create placeholder files first:

Create `app/utils/telegram-bot/handlers/budget.ts`:
```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';

export function registerBudgetHandler(_bot: Bot<BotContext>, _getDB: () => Promise<any>): void {
    // Placeholder — implemented in Task 6
}
```

Create `app/utils/telegram-bot/handlers/report.ts`:
```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';

export function registerReportHandler(_bot: Bot<BotContext>, _getDB: () => Promise<any>): void {
    // Placeholder — implemented in Task 7
}
```

Also, `transactions.ts` needs to export `handleSearchQuery`. Add this export to `app/utils/telegram-bot/handlers/transactions.ts` at the end of the file, inside `registerTransactionsHandler` won't work — so refactor: extract `handleSearch` as a standalone exported function. Add after the existing `searchTransactions` function (around line 64):

```typescript
export async function handleSearchQuery(ctx: BotContext, getDB: () => Promise<any>, query: string, offset = 0): Promise<void> {
    try {
        const { rows, hasMore } = await searchTransactions(getDB, query, offset);
        const title = `${t.searchTitle} — "${escapeMarkdownV2(query)}"`;
        const { text, keyboard } = buildTransactionList(rows, title, offset, hasMore, `pg:search:${encodeURIComponent(query)}:`);
        await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
    } catch (err: any) {
        logger.error({ err: err.message }, '[telegram-bot] /search failed');
        await ctx.reply(t.errorGeneric);
    }
}
```

And update the internal `handleSearch` inside `registerTransactionsHandler` to call it:
```typescript
// Replace the existing handleSearch const with:
const handleSearch = (ctx: BotContext, query: string, offset: number) =>
    handleSearchQuery(ctx, getDB, query, offset);
```

- [ ] **Step 4: Run all tests**

```bash
cd app && npm run test
```

Expected: all PASS. The `createBot` test should still work since the function signature is unchanged.

- [ ] **Step 5: Commit**

```bash
cd app && git add utils/telegram-bot/bot.ts utils/telegram-bot/handlers/budget.ts utils/telegram-bot/handlers/report.ts utils/telegram-bot/handlers/transactions.ts tests/telegram-bot/bot.test.ts && git commit -m "feat(telegram-bot): add plugin middleware stack, /cancel, search fix, bot profile"
```

---

### Task 4: Refactor Status Handler with fmt Templates

**Files:**
- Modify: `app/utils/telegram-bot/handlers/status.ts`
- Modify: `app/tests/telegram-bot/handlers/status.test.ts`

**Interfaces:**
- Consumes: `formatCurrency`, `progressBar`, `statusIndicator`, `sectionSeparator` from `formatters.ts` (Task 2)
- Consumes: `t` from `i18n.ts` (Task 2)
- Produces: `buildStatusMessage(data)` — returns `string` (plain text, no MarkdownV2 escaping needed since `autoParseMode` handles it; we use `parse_mode: undefined` for non-Markdown messages)
- Keeps: `fetchStatusData(getDB)` — signature unchanged

- [ ] **Step 1: Update tests for new message format**

Replace full contents of `app/tests/telegram-bot/handlers/status.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerStatusHandler, fetchStatusData, buildStatusMessage } from '../../../utils/telegram-bot/handlers/status';
import { bustAllCache } from '../../../utils/telegram-bot/cache';
import type { BotContext } from '../../../utils/telegram-bot/types';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

function setupDefaultQueryMocks() {
    mockClient.query.mockResolvedValueOnce({
        rows: [{ bank_income: '12500', bank_expenses: '3000', card_expenses: '5340' }],
    });
    mockClient.query.mockResolvedValueOnce({
        rows: [
            { category: 'אוכל', budget_limit: '2500' },
            { category: 'תחבורה', budget_limit: '1800' },
        ],
    });
    mockClient.query.mockResolvedValueOnce({
        rows: [
            { category: 'אוכל', actual_spent: '2100' },
            { category: 'תחבורה', actual_spent: '1200' },
        ],
    });
    mockClient.query.mockResolvedValueOnce({
        rows: [{ budget_limit: '13500' }],
    });
}

describe('status handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
    });

    it('registers command and callback query handlers', () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);
        expect(bot.command).toHaveBeenCalledWith('status', expect.any(Function));
        expect(bot.callbackQuery).toHaveBeenCalledWith('menu:status', expect.any(Function));
    });

    it('replies with status message', async () => {
        setupDefaultQueryMocks();
        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);
        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];
        await commandHandler(ctx);
        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('סטטוס תקציב');
        expect(message).toContain('תזרים חודשי');
        expect(message).toContain('━━━');
    });

    it('releases the DB client even on success', async () => {
        setupDefaultQueryMocks();
        await fetchStatusData(mockGetDB);
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('releases the DB client on query failure', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('DB error'));
        await expect(fetchStatusData(mockGetDB)).rejects.toThrow('DB error');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('replies with error message on DB failure', async () => {
        setupDefaultQueryMocks();
        mockClient.query.mockReset();
        mockClient.query.mockRejectedValueOnce(new Error('query failed'));
        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);
        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];
        await commandHandler(ctx);
        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('משהו השתבש');
    });

    it('fetches correct data from queries', async () => {
        setupDefaultQueryMocks();
        const data = await fetchStatusData(mockGetDB);
        expect(data.bankIncome).toBe(12500);
        expect(data.bankExpenses).toBe(3000);
        expect(data.cardExpenses).toBe(5340);
        expect(data.totalBudget).toBe(13500);
        expect(data.totalActual).toBe(3300);
        expect(data.categories).toHaveLength(2);
    });

    it('buildStatusMessage includes all sections with separators', () => {
        const data = {
            bankIncome: 12500,
            bankExpenses: 3000,
            cardExpenses: 5340,
            totalBudget: 13500,
            totalActual: 3300,
            categories: [
                { category: 'אוכל', actual: 2100, budget: 2500, remaining: 400, percentUsed: 84, isOverBudget: false },
                { category: 'תחבורה', actual: 1200, budget: 1800, remaining: 600, percentUsed: 67, isOverBudget: false },
            ],
            daysPassed: 15,
            totalDays: 30,
        };
        const message = buildStatusMessage(data);
        expect(message).toContain('סטטוס תקציב');
        expect(message).toContain('תזרים חודשי');
        expect(message).toContain('ניצול תקציב');
        expect(message).toContain('טופ 3 קטגוריות');
        expect(message).toContain('בורנדאון');
        expect(message).toContain('━━━');
        expect(message).toContain('אוכל');
    });

    it('buildStatusMessage shows negative net with warning', () => {
        const data = {
            bankIncome: 5000,
            bankExpenses: 3000,
            cardExpenses: 5000,
            totalBudget: 10000,
            totalActual: 5000,
            categories: [],
            daysPassed: 15,
            totalDays: 30,
        };
        const message = buildStatusMessage(data);
        expect(message).toContain('⚠️');
    });

    it('uses cache on second call', async () => {
        setupDefaultQueryMocks();
        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);
        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];
        await commandHandler(ctx);
        expect(mockGetDB).toHaveBeenCalledTimes(1);
        await commandHandler(ctx);
        expect(mockGetDB).toHaveBeenCalledTimes(1);
        expect(replyFn).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Rewrite status handler with plain text formatting and separators**

Replace full contents of `app/utils/telegram-bot/handlers/status.ts`:

```typescript
import type { Bot } from 'grammy';
import type { BotContext, CategorySpending } from '../types';
import { cached } from '../cache';
import { formatCurrency, progressBar, statusIndicator, sectionSeparator } from '../formatters';
import { t } from '../i18n';
import logger from '../../logger.js';

const BUDGET_CACHE_TTL = 2 * 60 * 1000;

interface StatusData {
    bankIncome: number;
    bankExpenses: number;
    cardExpenses: number;
    totalBudget: number;
    totalActual: number;
    categories: CategorySpending[];
    daysPassed: number;
    totalDays: number;
}

export async function fetchStatusData(getDB: () => Promise<any>): Promise<StatusData> {
    const client = await getDB();
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const startDate = new Date(year, month, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

        const [summaryRes, budgetRes, actualRes, totalBudgetRes] = await Promise.all([
            client.query(
                `SELECT
                    COALESCE(SUM(CASE WHEN price > 0 AND transaction_type = 'bank' THEN price ELSE 0 END), 0) as bank_income,
                    COALESCE(SUM(CASE WHEN price < 0 AND transaction_type = 'bank' THEN ABS(price) ELSE 0 END), 0) as bank_expenses,
                    COALESCE(SUM(CASE WHEN price < 0 AND transaction_type = 'credit_card' THEN ABS(price) ELSE 0 END), 0) as card_expenses
                FROM transactions WHERE date >= $1 AND date <= $2`,
                [startDate, endDate]
            ),
            client.query('SELECT category, budget_limit FROM budgets'),
            client.query(
                `SELECT category, ABS(ROUND(SUM(price))) as actual_spent
                 FROM transactions
                 WHERE date >= $1 AND date <= $2
                   AND category IS NOT NULL AND category != '' AND category != 'Bank'
                   AND transaction_type = 'credit_card'
                 GROUP BY category ORDER BY actual_spent DESC`,
                [startDate, endDate]
            ),
            client.query('SELECT budget_limit FROM total_budget LIMIT 1'),
        ]);

        const summary = summaryRes.rows[0] ?? { bank_income: '0', bank_expenses: '0', card_expenses: '0' };
        const budgetMap = new Map<string, number>();
        for (const row of budgetRes.rows) {
            budgetMap.set(row.category, parseFloat(row.budget_limit) || 0);
        }

        const categories: CategorySpending[] = [];
        let totalActual = 0;
        for (const row of actualRes.rows) {
            const actual = parseFloat(row.actual_spent) || 0;
            const budget = budgetMap.get(row.category) || 0;
            totalActual += actual;
            if (budget > 0) {
                categories.push({
                    category: row.category,
                    actual,
                    budget,
                    remaining: budget - actual,
                    percentUsed: Math.round((actual / budget) * 100),
                    isOverBudget: actual > budget,
                });
            }
        }

        categories.sort((a, b) => b.actual - a.actual);

        const totalBudget = totalBudgetRes.rows.length > 0
            ? parseFloat(totalBudgetRes.rows[0].budget_limit) || 0
            : 0;

        const daysPassed = now.getDate();
        const totalDays = new Date(year, month + 1, 0).getDate();

        return {
            bankIncome: parseFloat(summary.bank_income) || 0,
            bankExpenses: parseFloat(summary.bank_expenses) || 0,
            cardExpenses: parseFloat(summary.card_expenses) || 0,
            totalBudget,
            totalActual,
            categories,
            daysPassed,
            totalDays,
        };
    } finally {
        client.release();
    }
}

export function buildStatusMessage(data: StatusData): string {
    const { bankIncome, bankExpenses, cardExpenses, totalBudget, totalActual, categories, daysPassed, totalDays } = data;
    const totalExpenses = bankExpenses + cardExpenses;
    const net = bankIncome - totalExpenses;
    const netSign = net >= 0 ? '+' : '-';
    const netEmoji = net >= 0 ? '✅' : '⚠️';
    const sep = sectionSeparator();

    const budgetPercent = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;
    const burnRate = totalActual / Math.max(1, daysPassed);
    const budgetRate = totalBudget > 0 ? totalBudget / totalDays : 0;
    const burnStatus = budgetRate > 0 && burnRate <= budgetRate ? t.burndownGood : t.burndownBehind;
    const daysLeft = totalDays - daysPassed;

    const top3 = categories.slice(0, 3);
    const top3Lines = top3.map((c, i) => {
        return `   ${i + 1}. ${c.category} — ${formatCurrency(c.actual)}/${formatCurrency(c.budget)} (${c.percentUsed}%) ${statusIndicator(c.percentUsed)}`;
    }).join('\n');

    const lines = [
        t.statusTitle,
        '',
        sep,
        '',
        `${t.cashflowTitle}`,
        `   הכנסות:  ${formatCurrency(bankIncome)}`,
        `   הוצאות:  ${formatCurrency(totalExpenses)}`,
        `   נטו:  ${netSign}${formatCurrency(Math.abs(net))} ${netEmoji}`,
        '',
        sep,
        '',
        `${t.budgetTitle}`,
        `   ${progressBar(budgetPercent)} ${budgetPercent}%`,
        `   ${formatCurrency(totalActual)} / ${formatCurrency(totalBudget)}`,
        `   נותרו ${daysLeft} ימים · קצב: ${formatCurrency(Math.round(burnRate))}/יום`,
        '',
        sep,
        '',
        `${t.topCategoriesTitle}`,
        top3Lines || '   אין נתונים',
        '',
        sep,
        '',
        `${t.burndownTitle}`,
        `   ${burnStatus}`,
    ];

    return lines.join('\n');
}

export function registerStatusHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    const handle = async (ctx: BotContext) => {
        try {
            const data = await cached('status:data', BUDGET_CACHE_TTL, () => fetchStatusData(getDB));
            const message = buildStatusMessage(data);
            await ctx.reply(message, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /status failed');
            await ctx.reply(t.errorGeneric, { parse_mode: undefined });
        }
    };

    bot.command('status', handle);
    bot.callbackQuery('menu:status', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handle(ctx);
    });
}
```

- [ ] **Step 3: Run tests**

```bash
cd app && npm run test -- tests/telegram-bot/handlers/status.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd app && git add utils/telegram-bot/handlers/status.ts tests/telegram-bot/handlers/status.test.ts && git commit -m "feat(telegram-bot): redesign /status with section separators and clean layout"
```

---

### Task 5: Refactor Transactions, Expense, Triage, Sync, Summary, Settings, AI Handlers

**Files:**
- Modify: `app/utils/telegram-bot/handlers/transactions.ts`
- Modify: `app/utils/telegram-bot/handlers/expense.ts`
- Modify: `app/utils/telegram-bot/handlers/triage.ts`
- Modify: `app/utils/telegram-bot/handlers/sync.ts`
- Modify: `app/utils/telegram-bot/handlers/summary.ts`
- Modify: `app/utils/telegram-bot/handlers/settings.ts`
- Modify: `app/utils/telegram-bot/handlers/ai.ts`
- Modify: `app/tests/telegram-bot/handlers/transactions.test.ts`
- Modify: `app/tests/telegram-bot/handlers/expense.test.ts`
- Modify: `app/tests/telegram-bot/handlers/triage.test.ts`
- Modify: `app/tests/telegram-bot/handlers/summary.test.ts`
- Modify: `app/tests/telegram-bot/handlers/ai.test.ts`

**Interfaces:**
- Consumes: `formatTransactionCard`, `formatCurrency`, `formatDate`, `sectionSeparator`, `thinSeparator`, `statusIndicator`, `progressBar` from `formatters.ts`
- Consumes: `t` from `i18n.ts`
- Produces: `handleSearchQuery(ctx, getDB, query, offset?)` exported from `transactions.ts`

This is the largest task — it refactors all 7 existing handlers to use the new formatting system. Each handler follows the same pattern:
1. Replace `escapeMarkdownV2()` calls with plain string construction
2. Replace `formatTransaction()` with `formatTransactionCard()`
3. Add `sectionSeparator()` / `thinSeparator()` between sections
4. Use `parse_mode: undefined` for plain text messages (since `autoParseMode` sets MarkdownV2 default)
5. Use `hydrate` pattern for `msg.editText()` where applicable

- [ ] **Step 1: Refactor transactions.ts**

Replace full contents of `app/utils/telegram-bot/handlers/transactions.ts`:

```typescript
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext, TransactionRow } from '../types';
import { cached, bustCache } from '../cache';
import { formatTransactionCard, thinSeparator } from '../formatters';
import { paginationKeyboard, categoryKeyboard } from '../keyboards';
import { t } from '../i18n';
import logger from '../../logger.js';

const PAGE_SIZE = 10;
const TXN_CACHE_TTL = 30 * 1000;
const CAT_CACHE_TTL = 5 * 60 * 1000;

async function fetchRecentTransactions(getDB: () => Promise<any>, offset: number): Promise<{ rows: TransactionRow[]; hasMore: boolean }> {
    const client = await getDB();
    try {
        const result = await client.query(
            `SELECT id, identifier, vendor, date, name, price, category, memo, account_number, transaction_type
             FROM transactions
             WHERE transaction_type = 'credit_card'
             ORDER BY date DESC, id DESC
             LIMIT $1 OFFSET $2`,
            [PAGE_SIZE + 1, offset]
        );
        const hasMore = result.rows.length > PAGE_SIZE;
        return { rows: result.rows.slice(0, PAGE_SIZE), hasMore };
    } finally {
        client.release();
    }
}

async function fetchCategories(getDB: () => Promise<any>): Promise<string[]> {
    return cached('categories:list', CAT_CACHE_TTL, async () => {
        const client = await getDB();
        try {
            const result = await client.query(
                `SELECT DISTINCT category FROM transactions
                 WHERE category IS NOT NULL AND category != '' AND category != 'N/A'
                 ORDER BY category`
            );
            return result.rows.map((r: any) => r.category);
        } finally {
            client.release();
        }
    });
}

async function searchTransactions(getDB: () => Promise<any>, query: string, offset: number): Promise<{ rows: TransactionRow[]; hasMore: boolean }> {
    const client = await getDB();
    try {
        const result = await client.query(
            `SELECT id, identifier, vendor, date, name, price, category, memo, account_number, transaction_type
             FROM transactions
             WHERE name ILIKE $1
             ORDER BY date DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [`%${query}%`, PAGE_SIZE + 1, offset]
        );
        const hasMore = result.rows.length > PAGE_SIZE;
        return { rows: result.rows.slice(0, PAGE_SIZE), hasMore };
    } finally {
        client.release();
    }
}

function buildTransactionList(rows: TransactionRow[], title: string, offset: number, hasMore: boolean, pagePrefix: string): { text: string; keyboard: InlineKeyboard } {
    if (rows.length === 0) {
        return { text: t.recentEmpty, keyboard: new InlineKeyboard() };
    }

    const sep = thinSeparator();
    const cards = rows.map((txn) => formatTransactionCard(txn));
    const text = [title, '', sep, '', cards.join(`\n\n${sep}\n\n`), '', sep].join('\n');
    const kb = paginationKeyboard(pagePrefix, offset, PAGE_SIZE, hasMore);

    return { text, keyboard: kb };
}

export async function handleSearchQuery(ctx: BotContext, getDB: () => Promise<any>, query: string, offset = 0): Promise<void> {
    try {
        const { rows, hasMore } = await searchTransactions(getDB, query, offset);
        const title = `${t.searchTitle} — "${query}"`;
        const { text, keyboard } = buildTransactionList(rows, title, offset, hasMore, `pg:search:${encodeURIComponent(query)}:`);
        await ctx.reply(text, { parse_mode: undefined, reply_markup: keyboard });
    } catch (err: any) {
        logger.error({ err: err.message }, '[telegram-bot] /search failed');
        await ctx.reply(t.errorGeneric, { parse_mode: undefined });
    }
}

export function registerTransactionsHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    const handleRecent = async (ctx: BotContext, offset = 0) => {
        try {
            const { rows, hasMore } = await fetchRecentTransactions(getDB, offset);
            const { text, keyboard } = buildTransactionList(
                rows, t.recentTitle, offset, hasMore, 'pg:recent:'
            );

            if (rows.length > 0) {
                keyboard.row().text(t.editCategory, 'tr:pick');
            }

            await ctx.reply(text, { parse_mode: undefined, reply_markup: keyboard });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /recent failed');
            await ctx.reply(t.errorGeneric, { parse_mode: undefined });
        }
    };

    bot.command('recent', (ctx) => handleRecent(ctx));
    bot.callbackQuery('menu:recent', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleRecent(ctx);
    });

    bot.callbackQuery(/^pg:recent:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const offset = parseInt(ctx.match![1], 10);
        await handleRecent(ctx, offset);
    });

    // Edit category pick — show recent transactions with numbered buttons
    bot.callbackQuery('tr:pick', async (ctx) => {
        await ctx.answerCallbackQuery();
        try {
            const { rows } = await fetchRecentTransactions(getDB, 0);
            if (rows.length === 0) return;
            const kb = new InlineKeyboard();
            rows.forEach((txn, i) => {
                const label = `${i + 1}. ${txn.name.slice(0, 25)}`;
                kb.text(label, `tr:edit:${txn.id}`).row();
            });
            await ctx.reply('בחר עסקה לעריכת קטגוריה:', { parse_mode: undefined, reply_markup: kb });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] tr:pick failed');
        }
    });

    bot.command('search', async (ctx) => {
        const query = ctx.match?.trim();
        if (!query) {
            await ctx.reply(t.searchPrompt, { parse_mode: undefined });
            if (ctx.session) {
                ctx.session.conversation = { type: 'search_filter', step: 'awaiting_query', data: {} };
            }
            return;
        }
        await handleSearchQuery(ctx, getDB, query);
    });

    bot.callbackQuery('menu:search', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply(t.searchPrompt, { parse_mode: undefined });
        if (ctx.session) {
            ctx.session.conversation = { type: 'search_filter', step: 'awaiting_query', data: {} };
        }
    });

    bot.callbackQuery(/^pg:search:(.+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const query = decodeURIComponent(ctx.match![1]);
        const offset = parseInt(ctx.match![2], 10);
        await handleSearchQuery(ctx, getDB, query, offset);
    });

    bot.callbackQuery(/^tr:edit:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const txnId = ctx.match![1];
        try {
            const categories = await fetchCategories(getDB);
            const kb = categoryKeyboard(categories, `cat:${txnId}:`);
            await ctx.reply(`בחר קטגוריה לעסקה #${txnId}:`, { parse_mode: undefined, reply_markup: kb });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] category picker failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בטעינת קטגוריות', show_alert: true });
        }
    });

    bot.callbackQuery(/^cat:(\d+):(.+)$/, async (ctx) => {
        const txnId = ctx.match![1];
        const category = ctx.match![2];
        try {
            const client = await getDB();
            try {
                await client.query(
                    'UPDATE transactions SET category = $1, category_source = $2 WHERE id = $3',
                    [category, 'manual', txnId]
                );
            } finally {
                client.release();
            }
            bustCache('txn:');
            bustCache('budget:');
            bustCache('status:');
            await ctx.answerCallbackQuery({ text: `✅ ${category}` });
            await ctx.editMessageText(`✅ עסקה #${txnId} סווגה כ: ${category}`, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] category update failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בעדכון קטגוריה', show_alert: true });
        }
    });
}
```

- [ ] **Step 2: Refactor expense.ts — card-style confirmation**

Replace full contents of `app/utils/telegram-bot/handlers/expense.ts`:

```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { bustCache, cached } from '../cache';
import { formatCurrency } from '../formatters';
import { categoryKeyboard, confirmCancelKeyboard } from '../keyboards';
import { t } from '../i18n';
import logger from '../../logger.js';

const CURRENCIES = ['ILS', 'EUR', 'USD', 'GBP'];
const CURRENCY_RE = new RegExp(`\\b(${CURRENCIES.join('|')})\\b`, 'i');
const CAT_CACHE_TTL = 5 * 60 * 1000;

export interface ParsedExpense {
    name: string;
    amount: number;
    currency: string;
    category?: string;
}

export function parseExpenseInput(text: string): ParsedExpense | null {
    const parts = text.trim().split(/\s+/);
    if (parts.length === 0) return null;

    let amount: number | null = null;
    let currency = 'ILS';
    let amountIdx = -1;
    const isIncome = parts.some(p => p.startsWith('+'));

    for (let i = 0; i < parts.length; i++) {
        const cleaned = parts[i].replace(/^\+/, '');
        const num = parseFloat(cleaned);
        if (!isNaN(num) && isFinite(num)) {
            amount = isIncome ? Math.abs(num) : -Math.abs(num);
            amountIdx = i;
            break;
        }
    }

    if (amount === null || amountIdx === -1) return null;

    const remaining = parts.filter((_, i) => i !== amountIdx);
    const currIdx = remaining.findIndex(p => CURRENCY_RE.test(p));
    if (currIdx !== -1) {
        currency = remaining[currIdx].toUpperCase();
        remaining.splice(currIdx, 1);
    }

    if (remaining.length === 0) return null;

    let category: string | undefined;
    let name: string;
    if (remaining.length >= 2) {
        const lastPart = remaining[remaining.length - 1];
        if (isNaN(parseFloat(lastPart))) {
            category = lastPart;
            name = remaining.slice(0, -1).join(' ');
        } else {
            name = remaining.join(' ');
        }
    } else {
        name = remaining.join(' ');
    }

    return { name, amount, currency, category };
}

async function fetchCategories(getDB: () => Promise<any>): Promise<string[]> {
    return cached('categories:list', CAT_CACHE_TTL, async () => {
        const client = await getDB();
        try {
            const result = await client.query(
                `SELECT DISTINCT category FROM transactions
                 WHERE category IS NOT NULL AND category != '' AND category != 'N/A'
                 ORDER BY category`
            );
            return result.rows.map((r: any) => r.category);
        } finally {
            client.release();
        }
    });
}

async function insertExpense(getDB: () => Promise<any>, name: string, amount: number, category?: string): Promise<any> {
    const client = await getDB();
    try {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const identifier = `manual_${timestamp}_${randomSuffix}`;

        const result = await client.query(
            `INSERT INTO transactions
             (identifier, vendor, date, name, price, category, type, processed_date, status, account_number, category_source, transaction_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id, name, price, date, category`,
            [identifier, 'manual', dateStr, name.trim(), amount, category || null, 'normal', dateStr, 'completed', 'manual', category ? 'manual' : null, 'credit_card']
        );
        bustCache('txn:');
        bustCache('budget:');
        bustCache('status:');
        return result.rows[0];
    } finally {
        client.release();
    }
}

function buildExpenseConfirmation(name: string, amount: number, category?: string): string {
    const sign = amount >= 0 ? '+' : '';
    const lines = [
        '📝 אישור הוצאה',
        '',
        `   שם: ${name}`,
        `   סכום: ${sign}${formatCurrency(Math.abs(amount))}`,
    ];
    if (category) {
        lines.push(`   קטגוריה: ${category}`);
    }
    return lines.join('\n');
}

export function registerExpenseHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    bot.command('expense', async (ctx) => {
        const input = ctx.match?.trim();

        if (input) {
            const parsed = parseExpenseInput(input);
            if (!parsed) {
                await ctx.reply(t.expenseInvalidAmount, { parse_mode: undefined });
                return;
            }

            try {
                const txn = await insertExpense(getDB, parsed.name, parsed.amount, parsed.category);
                const sign = txn.price >= 0 ? '+' : '';
                const msg = [
                    t.expenseAdded,
                    '',
                    `   📝 ${txn.name}`,
                    `   💰 ${sign}${formatCurrency(Math.abs(txn.price))}`,
                ].join('\n');
                await ctx.reply(msg, { parse_mode: undefined });
            } catch (err: any) {
                logger.error({ err: err.message }, '[telegram-bot] /expense quick-add failed');
                await ctx.reply(t.errorGeneric, { parse_mode: undefined });
            }
            return;
        }

        if (ctx.session) {
            ctx.session.conversation = {
                type: 'expense',
                step: 'name',
                data: {},
            };
        }
        await ctx.reply(t.expenseAskName, { parse_mode: undefined });
    });

    bot.callbackQuery('menu:expense', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session) {
            ctx.session.conversation = {
                type: 'expense',
                step: 'name',
                data: {},
            };
        }
        await ctx.reply(t.expenseAskName, { parse_mode: undefined });
    });

    bot.callbackQuery(/^exp:cat:(.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.session?.conversation || ctx.session.conversation.type !== 'expense') return;

        const category = ctx.match![1];
        ctx.session.conversation.data.category = category;
        ctx.session.conversation.step = 'confirm';

        const { name, amount } = ctx.session.conversation.data as { name: string; amount: number };
        const msg = buildExpenseConfirmation(String(name), amount, category);
        await ctx.editMessageText(msg, {
            parse_mode: undefined,
            reply_markup: confirmCancelKeyboard('exp:confirm', 'exp:cancel'),
        });
    });

    bot.callbackQuery('exp:confirm', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.session?.conversation || ctx.session.conversation.type !== 'expense') return;

        const { name, amount, category } = ctx.session.conversation.data as { name: string; amount: number; category?: string };
        try {
            await insertExpense(getDB, name, amount, category);
            ctx.session.conversation = undefined;
            await ctx.editMessageText(t.expenseAdded, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] expense confirm failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בשמירת ההוצאה', show_alert: true });
        }
    });

    bot.callbackQuery('exp:cancel', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session) {
            ctx.session.conversation = undefined;
        }
        await ctx.editMessageText(t.expenseCancelled, { parse_mode: undefined });
    });
}

export async function handleExpenseFlowMessage(ctx: BotContext, getDB: () => Promise<any>): Promise<boolean> {
    if (!ctx.session?.conversation || ctx.session.conversation.type !== 'expense') return false;
    const conv = ctx.session.conversation;
    const text = ctx.message?.text?.trim();
    if (!text) return false;

    if (conv.step === 'name') {
        conv.data.name = text;
        conv.step = 'amount';
        await ctx.reply(t.expenseAskAmount, { parse_mode: undefined });
        return true;
    }

    if (conv.step === 'amount') {
        const isIncome = text.startsWith('+');
        const num = parseFloat(text.replace(/^\+/, ''));
        if (isNaN(num) || !isFinite(num)) {
            await ctx.reply(t.expenseInvalidAmount, { parse_mode: undefined });
            return true;
        }
        conv.data.amount = isIncome ? Math.abs(num) : -Math.abs(num);
        conv.step = 'category';

        const categories = await fetchCategories(getDB);
        const kb = categoryKeyboard(categories, 'exp:cat:');
        await ctx.reply(t.expenseAskCategory, { parse_mode: undefined, reply_markup: kb });
        return true;
    }

    return false;
}
```

- [ ] **Step 3: Refactor triage.ts**

Replace full contents of `app/utils/telegram-bot/handlers/triage.ts`:

```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { bustCache, cached } from '../cache';
import { formatTransactionCard } from '../formatters';
import { categoryKeyboard } from '../keyboards';
import { t } from '../i18n';
import logger from '../../logger.js';

const CAT_CACHE_TTL = 5 * 60 * 1000;

interface UncategorizedTxn {
    id: number;
    name: string;
    price: number;
    date: string;
    vendor: string;
}

async function fetchUncategorized(getDB: () => Promise<any>): Promise<UncategorizedTxn[]> {
    const client = await getDB();
    try {
        const result = await client.query(
            `SELECT id, name, price, date, vendor
             FROM transactions
             WHERE (category IS NULL OR category = '' OR category = 'N/A')
               AND transaction_type = 'credit_card'
             ORDER BY date DESC
             LIMIT 50`
        );
        return result.rows;
    } finally {
        client.release();
    }
}

async function fetchCategories(getDB: () => Promise<any>): Promise<string[]> {
    return cached('categories:list', CAT_CACHE_TTL, async () => {
        const client = await getDB();
        try {
            const result = await client.query(
                `SELECT DISTINCT category FROM transactions
                 WHERE category IS NOT NULL AND category != '' AND category != 'N/A'
                 ORDER BY category`
            );
            return result.rows.map((r: any) => r.category);
        } finally {
            client.release();
        }
    });
}

async function showNextTriage(ctx: BotContext, getDB: () => Promise<any>, categorizedCount: number): Promise<void> {
    const items = await fetchUncategorized(getDB);

    if (items.length === 0) {
        const msg = categorizedCount > 0 ? t.triageDone(categorizedCount) : t.triageEmpty;
        await ctx.reply(msg, { parse_mode: undefined });
        return;
    }

    const txn = items[0];
    const card = formatTransactionCard({ name: txn.name, price: txn.price, date: txn.date, category: null });
    const text = [
        t.triageTitle,
        '',
        card,
        '',
        t.triageRemaining(items.length),
    ].join('\n');

    const categories = await fetchCategories(getDB);
    const kb = categoryKeyboard(categories, `tri:cat:${txn.id}:`);
    kb.row().text(t.triageSkip, `tri:skip:${txn.id}`);

    await ctx.reply(text, { parse_mode: undefined, reply_markup: kb });
}

export function registerTriageHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    bot.command('triage', async (ctx) => {
        if (ctx.session) {
            ctx.session.conversation = { type: 'triage', step: 'active', data: { categorized: 0 } };
        }
        await showNextTriage(ctx, getDB, 0);
    });

    bot.callbackQuery('menu:triage', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session) {
            ctx.session.conversation = { type: 'triage', step: 'active', data: { categorized: 0 } };
        }
        await showNextTriage(ctx, getDB, 0);
    });

    bot.callbackQuery(/^tri:cat:(\d+):(.+)$/, async (ctx) => {
        const txnId = ctx.match![1];
        const category = ctx.match![2];

        try {
            const client = await getDB();
            try {
                await client.query(
                    'UPDATE transactions SET category = $1, category_source = $2 WHERE id = $3',
                    [category, 'manual', txnId]
                );
            } finally {
                client.release();
            }
            bustCache('txn:');
            bustCache('budget:');
            bustCache('status:');

            await ctx.answerCallbackQuery({ text: `✅ ${category}` });

            const count = ((ctx.session?.conversation?.data?.categorized as number) || 0) + 1;
            if (ctx.session?.conversation) {
                ctx.session.conversation.data.categorized = count;
            }

            await showNextTriage(ctx, getDB, count);
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] triage categorize failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בעדכון קטגוריה', show_alert: true });
        }
    });

    bot.callbackQuery(/^tri:skip:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const count = (ctx.session?.conversation?.data?.categorized as number) || 0;
        await showNextTriage(ctx, getDB, count);
    });
}
```

- [ ] **Step 4: Refactor sync.ts — use hydrate**

Replace full contents of `app/utils/telegram-bot/handlers/sync.ts`:

```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { bustAllCache } from '../cache';
import { t } from '../i18n';
import logger from '../../logger.js';

export function registerSyncHandler(bot: Bot<BotContext>): void {
    const handle = async (ctx: BotContext) => {
        const loadingMsg = await ctx.reply(t.syncStarted, { parse_mode: undefined });

        try {
            const { runBackgroundSync } = await import('../../../scripts/background-sync.js');
            await runBackgroundSync();
            bustAllCache();

            await loadingMsg.editText(t.syncComplete, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /sync failed');
            const errDetail = err.message || '';
            await loadingMsg.editText(`${t.syncFailed}\n${errDetail}`, { parse_mode: undefined });
        }
    };

    bot.command('sync', handle);
    bot.callbackQuery('menu:sync', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handle(ctx);
    });
}
```

- [ ] **Step 5: Refactor summary.ts**

Replace full contents of `app/utils/telegram-bot/handlers/summary.ts`:

```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { t } from '../i18n';
import logger from '../../logger.js';

export function registerSummaryHandler(bot: Bot<BotContext>): void {
    const handle = async (ctx: BotContext) => {
        await ctx.reply(t.summaryLoading, { parse_mode: undefined });
        try {
            const { generateDailySummary } = await import('../../summary.js');
            const summary = await generateDailySummary();
            await ctx.reply(summary, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /summary failed');
            await ctx.reply(t.summaryError, { parse_mode: undefined });
        }
    };

    bot.command('summary', handle);
    bot.callbackQuery('menu:summary', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handle(ctx);
    });
}
```

- [ ] **Step 6: Refactor settings.ts**

Replace full contents of `app/utils/telegram-bot/handlers/settings.ts`:

```typescript
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { bustCache } from '../cache';
import { sectionSeparator } from '../formatters';
import { t } from '../i18n';
import logger from '../../logger.js';

export function registerSettingsHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    const handle = async (ctx: BotContext) => {
        try {
            const { getAIConfig } = await import('../../aiClient.js');
            const config = await getAIConfig();

            const client = await getDB();
            let summaryMode = 'calendar';
            try {
                const result = await client.query(
                    "SELECT value FROM app_settings WHERE key = 'whatsapp_summary_mode'"
                );
                if (result.rows.length > 0) {
                    const raw = result.rows[0].value;
                    summaryMode = (typeof raw === 'string' ? raw.replace(/"/g, '') : raw) || 'calendar';
                }
            } finally {
                client.release();
            }

            const modelDisplay = config.model || 'לא מוגדר';
            const baseUrlDisplay = config.baseURL || 'לא מוגדר';
            const modeDisplay = summaryMode === 'cycle' ? 'מחזור חיוב' : 'חודש קלנדרי';
            const sep = sectionSeparator();

            const text = [
                t.settingsTitle,
                '',
                sep,
                '',
                `🤖 מודל AI: ${modelDisplay}`,
                `🌐 כתובת API: ${baseUrlDisplay}`,
                `📅 מצב סיכום: ${modeDisplay}`,
            ].join('\n');

            const kb = new InlineKeyboard()
                .text('🔄 החלף מצב סיכום', 'set:toggle_summary_mode');

            await ctx.reply(text, { parse_mode: undefined, reply_markup: kb });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /settings failed');
            await ctx.reply(t.errorGeneric, { parse_mode: undefined });
        }
    };

    bot.command('settings', handle);
    bot.callbackQuery('menu:settings', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handle(ctx);
    });

    bot.callbackQuery('set:toggle_summary_mode', async (ctx) => {
        try {
            const client = await getDB();
            try {
                const result = await client.query(
                    "SELECT value FROM app_settings WHERE key = 'whatsapp_summary_mode'"
                );
                const current = result.rows[0]?.value?.replace?.(/"/g, '') || 'calendar';
                const newMode = current === 'cycle' ? 'calendar' : 'cycle';
                await client.query(
                    "UPDATE app_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'whatsapp_summary_mode'",
                    [JSON.stringify(newMode)]
                );
                bustCache('settings:');
                const modeLabel = newMode === 'cycle' ? 'מחזור חיוב' : 'חודש קלנדרי';
                await ctx.answerCallbackQuery({ text: `✅ מצב סיכום: ${modeLabel}` });
                await handle(ctx);
            } finally {
                client.release();
            }
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] toggle summary mode failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה', show_alert: true });
        }
    });
}
```

- [ ] **Step 7: Refactor ai.ts — add link preview control**

Replace full contents of `app/utils/telegram-bot/handlers/ai.ts`:

```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { cached } from '../cache';
import { t } from '../i18n';
import logger from '../../logger.js';

const AI_CONTEXT_TTL = 2 * 60 * 1000;

async function buildFinancialContext(getDB: () => Promise<any>): Promise<string> {
    return cached('ai:context', AI_CONTEXT_TTL, async () => {
        const client = await getDB();
        try {
            const now = new Date();
            const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

            const [budgetRes, spendingRes, categoriesRes, recentRes] = await Promise.all([
                client.query('SELECT budget_limit FROM total_budget LIMIT 1'),
                client.query(
                    `SELECT COALESCE(SUM(ABS(price)), 0) as total
                     FROM transactions WHERE date >= $1 AND date <= $2
                     AND price < 0 AND transaction_type = 'credit_card'`,
                    [startDate, endDate]
                ),
                client.query(
                    `SELECT DISTINCT category FROM transactions
                     WHERE category IS NOT NULL AND category != '' AND category != 'N/A'
                     ORDER BY category`
                ),
                client.query(
                    `SELECT date, name, price, category FROM transactions
                     ORDER BY date DESC LIMIT 5`
                ),
            ]);

            const totalBudget = budgetRes.rows[0]?.budget_limit || 0;
            const totalSpent = spendingRes.rows[0]?.total || 0;
            const categories = categoriesRes.rows.map((r: any) => r.category).join(', ');
            const recent = recentRes.rows.map((r: any) =>
                `${r.date}: ${r.name} ₪${Math.abs(r.price)} (${r.category || 'ללא'})`
            ).join('\n');

            return [
                `תקציב חודשי: ₪${totalBudget}`,
                `הוצאות עד כה: ₪${totalSpent}`,
                `קטגוריות: ${categories}`,
                `5 עסקאות אחרונות:`,
                recent,
            ].join('\n');
        } finally {
            client.release();
        }
    });
}

export async function handleAIFallback(ctx: BotContext, getDB: () => Promise<any>): Promise<void> {
    const userText = ctx.message?.text?.trim();
    if (!userText) return;

    await ctx.reply(t.aiThinking, { parse_mode: undefined });

    try {
        const context = await buildFinancialContext(getDB);
        const { generateText } = await import('../../aiClient.js');

        const system = `אתה עוזר פיננסי חכם. ענה בעברית בקצרה וממוקד.
הנה המצב הפיננסי הנוכחי של המשתמש:
${context}

ענה על שאלות פיננסיות. אם לא ברור, הצע פקודות ספציפיות כמו /status, /recent, /search.`;

        const { text } = await generateText({
            prompt: userText,
            system,
            temperature: 0.7,
            maxTokens: 2000,
        });

        await ctx.reply(text, {
            parse_mode: undefined,
            link_preview_options: { is_disabled: true },
        });
    } catch (err: any) {
        logger.error({ err: err.message }, '[telegram-bot] AI fallback failed');
        await ctx.reply(t.aiFallbackError, { parse_mode: undefined });
    }
}

export function registerAIHandler(_bot: Bot<BotContext>, _getDB: () => Promise<any>): void {
    // AI fallback is not a command — called from catch-all message:text handler
}
```

- [ ] **Step 8: Update existing tests to match new formatting**

Update `app/tests/telegram-bot/handlers/transactions.test.ts` — key changes:
- Remove checks for `parse_mode: 'MarkdownV2'` — now uses `parse_mode: undefined`
- Update text assertions to match card-style format
- Add test for `handleSearchQuery` export
- Update edit button test for new `tr:pick` flow

Update `app/tests/telegram-bot/handlers/expense.test.ts` — remove MarkdownV2 escape assertions.

Update `app/tests/telegram-bot/handlers/triage.test.ts` — update format assertions.

Update `app/tests/telegram-bot/handlers/summary.test.ts` — update parse_mode assertions.

Update `app/tests/telegram-bot/handlers/ai.test.ts` — add `link_preview_options` assertion.

For each test file: replace `parse_mode: 'MarkdownV2'` expectations with `parse_mode: undefined`, and update string content assertions to match new unescaped strings (e.g., `'עסקאות אחרונות'` instead of checking for escaped versions).

- [ ] **Step 9: Run all tests**

```bash
cd app && npm run test
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
cd app && git add utils/telegram-bot/handlers/ tests/telegram-bot/handlers/ && git commit -m "feat(telegram-bot): refactor all handlers with card-style formatting and hydrate"
```

---

### Task 6: Implement /budget Command

**Files:**
- Modify: `app/utils/telegram-bot/handlers/budget.ts` (replace placeholder from Task 3)
- Create: `app/tests/telegram-bot/handlers/budget.test.ts`

**Interfaces:**
- Consumes: `formatCurrency`, `progressBar`, `statusIndicator`, `sectionSeparator` from `formatters.ts`
- Consumes: `t` from `i18n.ts`
- Produces: `registerBudgetHandler(bot, getDB)` — registers `/budget` command and `menu:budget` callback

- [ ] **Step 1: Write tests for budget handler**

Create `app/tests/telegram-bot/handlers/budget.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBudgetHandler } from '../../../utils/telegram-bot/handlers/budget';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

describe('budget handler', () => {
    let bot: any;

    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
        bot = { command: vi.fn(), callbackQuery: vi.fn() };
        registerBudgetHandler(bot, mockGetDB);
    });

    it('registers /budget command and menu callback', () => {
        expect(bot.command).toHaveBeenCalledWith('budget', expect.any(Function));
        expect(bot.callbackQuery).toHaveBeenCalledWith('menu:budget', expect.any(Function));
    });

    it('replies with per-category budget breakdown', async () => {
        // total budget
        mockClient.query.mockResolvedValueOnce({
            rows: [{ budget_limit: '10000' }],
        });
        // budgets per category
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'אוכל', budget_limit: '3000' },
                { category: 'תחבורה', budget_limit: '2000' },
            ],
        });
        // actual spending
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'אוכל', actual_spent: '2800' },
                { category: 'תחבורה', actual_spent: '1200' },
            ],
        });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('תקציב חודשי');
        expect(message).toContain('אוכל');
        expect(message).toContain('תחבורה');
        expect(message).toContain('━━━');
        expect(message).toContain('▓');
    });

    it('handles empty budgets', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('תקציב חודשי');
    });

    it('replies with error on DB failure', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('db fail'));

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledWith(expect.stringContaining('השתבש'), expect.anything());
    });

    it('releases DB client', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(mockClient.release).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npm run test -- tests/telegram-bot/handlers/budget.test.ts
```

Expected: FAIL — placeholder handler doesn't register commands.

- [ ] **Step 3: Implement budget handler**

Replace full contents of `app/utils/telegram-bot/handlers/budget.ts`:

```typescript
import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { cached } from '../cache';
import { formatCurrency, progressBar, statusIndicator, sectionSeparator } from '../formatters';
import { t } from '../i18n';
import logger from '../../logger.js';

const BUDGET_CACHE_TTL = 2 * 60 * 1000;

interface BudgetCategory {
    category: string;
    actual: number;
    budget: number;
    remaining: number;
    percentUsed: number;
}

async function fetchBudgetData(getDB: () => Promise<any>): Promise<{ total: number; totalActual: number; categories: BudgetCategory[] }> {
    const client = await getDB();
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const startDate = new Date(year, month, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

        const [totalBudgetRes, budgetRes, actualRes] = await Promise.all([
            client.query('SELECT budget_limit FROM total_budget LIMIT 1'),
            client.query('SELECT category, budget_limit FROM budgets ORDER BY category'),
            client.query(
                `SELECT category, ABS(ROUND(SUM(price))) as actual_spent
                 FROM transactions
                 WHERE date >= $1 AND date <= $2
                   AND category IS NOT NULL AND category != '' AND category != 'Bank'
                   AND transaction_type = 'credit_card'
                 GROUP BY category`,
                [startDate, endDate]
            ),
        ]);

        const total = totalBudgetRes.rows.length > 0
            ? parseFloat(totalBudgetRes.rows[0].budget_limit) || 0
            : 0;

        const actualMap = new Map<string, number>();
        for (const row of actualRes.rows) {
            actualMap.set(row.category, parseFloat(row.actual_spent) || 0);
        }

        let totalActual = 0;
        const categories: BudgetCategory[] = [];
        for (const row of budgetRes.rows) {
            const budget = parseFloat(row.budget_limit) || 0;
            if (budget <= 0) continue;
            const actual = actualMap.get(row.category) || 0;
            totalActual += actual;
            categories.push({
                category: row.category,
                actual,
                budget,
                remaining: budget - actual,
                percentUsed: Math.round((actual / budget) * 100),
            });
        }

        categories.sort((a, b) => b.percentUsed - a.percentUsed);

        return { total, totalActual, categories };
    } finally {
        client.release();
    }
}

function buildBudgetMessage(data: { total: number; totalActual: number; categories: BudgetCategory[] }): string {
    const { total, totalActual, categories } = data;
    const now = new Date();
    const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const monthName = monthNames[now.getMonth()];
    const totalPercent = total > 0 ? Math.round((totalActual / total) * 100) : 0;
    const sep = sectionSeparator();

    const lines = [
        `${t.budgetTitle2} — ${monthName} ${now.getFullYear()}`,
        '',
        sep,
        '',
        `סה״כ: ${formatCurrency(totalActual)} / ${formatCurrency(total)} (${totalPercent}%)`,
        progressBar(totalPercent),
        '',
        sep,
    ];

    for (const cat of categories) {
        const indicator = statusIndicator(cat.percentUsed);
        const remainingText = cat.remaining >= 0
            ? `${indicator} ${t.budgetRemaining(formatCurrency(cat.remaining))}`
            : `⚠️ חריגה של ${formatCurrency(Math.abs(cat.remaining))}`;

        lines.push(
            '',
            `${cat.category}`,
            `   ${progressBar(cat.percentUsed)} ${cat.percentUsed}%  ·  ${formatCurrency(cat.actual)}/${formatCurrency(cat.budget)}`,
            `   ${remainingText}`,
        );
    }

    if (categories.length === 0) {
        lines.push('', 'לא הוגדרו תקציבים לקטגוריות.');
    }

    return lines.join('\n');
}

export function registerBudgetHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    const handle = async (ctx: BotContext) => {
        try {
            const data = await cached('budget:full', BUDGET_CACHE_TTL, () => fetchBudgetData(getDB));
            const message = buildBudgetMessage(data);
            await ctx.reply(message, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /budget failed');
            await ctx.reply(t.errorGeneric, { parse_mode: undefined });
        }
    };

    bot.command('budget', handle);
    bot.callbackQuery('menu:budget', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handle(ctx);
    });
}
```

- [ ] **Step 4: Run tests**

```bash
cd app && npm run test -- tests/telegram-bot/handlers/budget.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add utils/telegram-bot/handlers/budget.ts tests/telegram-bot/handlers/budget.test.ts && git commit -m "feat(telegram-bot): add /budget command with per-category breakdown"
```

---

### Task 7: Implement /report Command

**Files:**
- Modify: `app/utils/telegram-bot/handlers/report.ts` (replace placeholder from Task 3)
- Create: `app/tests/telegram-bot/handlers/report.test.ts`

**Interfaces:**
- Consumes: `formatCurrency`, `sectionSeparator` from `formatters.ts`
- Consumes: `t` from `i18n.ts`
- Produces: `registerReportHandler(bot, getDB)` — registers `/report` command, `menu:report` callback, and `rpt:weekly` / `rpt:monthly` period picker callbacks

- [ ] **Step 1: Write tests**

Create `app/tests/telegram-bot/handlers/report.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerReportHandler } from '../../../utils/telegram-bot/handlers/report';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

describe('report handler', () => {
    let bot: any;

    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
        bot = { command: vi.fn(), callbackQuery: vi.fn() };
        registerReportHandler(bot, mockGetDB);
    });

    it('registers /report command and callbacks', () => {
        expect(bot.command).toHaveBeenCalledWith('report', expect.any(Function));
        expect(bot.callbackQuery).toHaveBeenCalledWith('menu:report', expect.any(Function));
        const callbacks = bot.callbackQuery.mock.calls.map((c: any) => c[0]);
        expect(callbacks).toContain('rpt:weekly');
        expect(callbacks).toContain('rpt:monthly');
    });

    it('/report shows period picker', async () => {
        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'report')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [text, opts] = replyFn.mock.calls[0];
        expect(text).toContain('תקופה');
        expect(opts.reply_markup).toBeDefined();
    });

    it('weekly report shows spending breakdown', async () => {
        // Current period expenses
        mockClient.query.mockResolvedValueOnce({
            rows: [{ total: '2150' }],
        });
        // Category breakdown
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'אוכל', total: '850' },
                { category: 'תחבורה', total: '420' },
            ],
        });
        // Biggest expense
        mockClient.query.mockResolvedValueOnce({
            rows: [{ name: 'שופרסל', price: '-420' }],
        });
        // Previous period total
        mockClient.query.mockResolvedValueOnce({
            rows: [{ total: '1970' }],
        });

        const answerFn = vi.fn();
        const replyFn = vi.fn();
        const ctx = { answerCallbackQuery: answerFn, reply: replyFn } as any;
        const cbHandler = bot.callbackQuery.mock.calls.find((c: any) => c[0] === 'rpt:weekly')[1];
        await cbHandler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('דוח');
        expect(message).toContain('אוכל');
        expect(message).toContain('━━━');
    });

    it('handles DB error gracefully', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('db fail'));

        const answerFn = vi.fn();
        const replyFn = vi.fn();
        const ctx = { answerCallbackQuery: answerFn, reply: replyFn } as any;
        const cbHandler = bot.callbackQuery.mock.calls.find((c: any) => c[0] === 'rpt:weekly')[1];
        await cbHandler(ctx);

        expect(replyFn).toHaveBeenCalledWith(expect.stringContaining('השתבש'), expect.anything());
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npm run test -- tests/telegram-bot/handlers/report.test.ts
```

Expected: FAIL — placeholder handler doesn't register commands.

- [ ] **Step 3: Implement report handler**

Replace full contents of `app/utils/telegram-bot/handlers/report.ts`:

```typescript
import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { cached } from '../cache';
import { formatCurrency, sectionSeparator } from '../formatters';
import { t } from '../i18n';
import logger from '../../logger.js';

const REPORT_CACHE_TTL = 5 * 60 * 1000;

interface ReportData {
    periodLabel: string;
    totalExpenses: number;
    dailyAvg: number;
    categories: { category: string; total: number; percent: number }[];
    biggestExpense: { name: string; amount: number } | null;
    previousTotal: number;
}

function getDateRange(period: 'weekly' | 'monthly'): { start: string; end: string; prevStart: string; prevEnd: string; days: number; label: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (period === 'monthly') {
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0);
        const prevStart = new Date(year, month - 1, 1);
        const prevEnd = new Date(year, month, 0);
        const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
            prevStart: prevStart.toISOString().split('T')[0],
            prevEnd: prevEnd.toISOString().split('T')[0],
            days: now.getDate(),
            label: `${monthNames[month]} ${year}`,
        };
    }

    // Weekly: last 7 days
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 6);

    const formatShort = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
        prevStart: prevStart.toISOString().split('T')[0],
        prevEnd: prevEnd.toISOString().split('T')[0],
        days: 7,
        label: `${formatShort(start)}-${formatShort(end)}`,
    };
}

async function fetchReportData(getDB: () => Promise<any>, period: 'weekly' | 'monthly'): Promise<ReportData> {
    const range = getDateRange(period);
    const client = await getDB();
    try {
        const [totalRes, categoriesRes, biggestRes, prevRes] = await Promise.all([
            client.query(
                `SELECT COALESCE(SUM(ABS(price)), 0) as total
                 FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'`,
                [range.start, range.end]
            ),
            client.query(
                `SELECT category, ABS(ROUND(SUM(price))) as total
                 FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'
                   AND category IS NOT NULL AND category != '' AND category != 'N/A'
                 GROUP BY category ORDER BY total DESC`,
                [range.start, range.end]
            ),
            client.query(
                `SELECT name, price FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'
                 ORDER BY price ASC LIMIT 1`,
                [range.start, range.end]
            ),
            client.query(
                `SELECT COALESCE(SUM(ABS(price)), 0) as total
                 FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'`,
                [range.prevStart, range.prevEnd]
            ),
        ]);

        const totalExpenses = parseFloat(totalRes.rows[0]?.total) || 0;
        const categories = categoriesRes.rows.map((r: any) => {
            const catTotal = parseFloat(r.total) || 0;
            return {
                category: r.category,
                total: catTotal,
                percent: totalExpenses > 0 ? Math.round((catTotal / totalExpenses) * 100) : 0,
            };
        });

        const biggest = biggestRes.rows[0];
        const previousTotal = parseFloat(prevRes.rows[0]?.total) || 0;

        return {
            periodLabel: range.label,
            totalExpenses,
            dailyAvg: range.days > 0 ? Math.round(totalExpenses / range.days) : 0,
            categories,
            biggestExpense: biggest ? { name: biggest.name, amount: Math.abs(parseFloat(biggest.price)) } : null,
            previousTotal,
        };
    } finally {
        client.release();
    }
}

function buildReportMessage(data: ReportData, periodType: string): string {
    const { periodLabel, totalExpenses, dailyAvg, categories, biggestExpense, previousTotal } = data;
    const sep = sectionSeparator();
    const periodName = periodType === 'weekly' ? t.reportWeekly : t.reportMonthly;

    const lines = [
        `${t.reportTitle} ${periodName} — ${periodLabel}`,
        '',
        sep,
        '',
        `💰 ${t.reportTotalExpenses}`,
        `   ${t.reportTotalExpenses}: ${formatCurrency(totalExpenses)}`,
        `   ${t.reportDailyAvg}: ${formatCurrency(dailyAvg)}`,
        '',
        sep,
        '',
        `📊 ${t.reportByCategory}`,
    ];

    for (const cat of categories) {
        lines.push(`   ${cat.category}: ${formatCurrency(cat.total)} (${cat.percent}%)`);
    }

    if (categories.length === 0) {
        lines.push('   אין נתונים');
    }

    lines.push('', sep, '');

    // Trend
    if (previousTotal > 0) {
        const diff = totalExpenses - previousTotal;
        const pct = Math.round(Math.abs(diff / previousTotal) * 100);
        const direction = diff >= 0 ? '↑' : '↓';
        lines.push(`📈 ${t.reportTrend}`);
        lines.push(`   ${t.reportVsPrevious(String(pct), direction)}`);
    }

    if (biggestExpense) {
        lines.push(`   ${t.reportBiggest}: ${biggestExpense.name} ${formatCurrency(biggestExpense.amount)}`);
    }

    return lines.join('\n');
}

export function registerReportHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    const showPicker = async (ctx: BotContext) => {
        const kb = new InlineKeyboard()
            .text(`📅 ${t.reportWeekly}`, 'rpt:weekly')
            .text(`📅 ${t.reportMonthly}`, 'rpt:monthly');
        await ctx.reply(t.reportPickPeriod, { parse_mode: undefined, reply_markup: kb });
    };

    const handleReport = async (ctx: BotContext, period: 'weekly' | 'monthly') => {
        try {
            const cacheKey = `report:${period}`;
            const data = await cached(cacheKey, REPORT_CACHE_TTL, () => fetchReportData(getDB, period));
            const message = buildReportMessage(data, period);
            await ctx.reply(message, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /report failed');
            await ctx.reply(t.errorGeneric, { parse_mode: undefined });
        }
    };

    bot.command('report', (ctx) => showPicker(ctx));
    bot.callbackQuery('menu:report', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showPicker(ctx);
    });

    bot.callbackQuery('rpt:weekly', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleReport(ctx, 'weekly');
    });

    bot.callbackQuery('rpt:monthly', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleReport(ctx, 'monthly');
    });
}
```

- [ ] **Step 4: Run tests**

```bash
cd app && npm run test -- tests/telegram-bot/handlers/report.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd app && npm run test
```

Expected: all tests PASS across all files.

- [ ] **Step 6: Commit**

```bash
cd app && git add utils/telegram-bot/handlers/report.ts tests/telegram-bot/handlers/report.test.ts && git commit -m "feat(telegram-bot): add /report command with weekly/monthly period picker"
```

---

### Task 8: Update Keyboards & Final Integration Test

**Files:**
- Modify: `app/utils/telegram-bot/keyboards.ts`
- Modify: `app/tests/telegram-bot/bot.test.ts`

**Interfaces:**
- Consumes: `t` from `i18n.ts`
- Produces: `mainMenuKeyboard()` — updated with `/budget` and `/report` menu buttons

- [ ] **Step 1: Update keyboards.ts — add budget and report to main menu**

Replace full contents of `app/utils/telegram-bot/keyboards.ts`:

```typescript
import { InlineKeyboard } from 'grammy';
import { t } from './i18n';

export function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text(t.menuStatus, 'menu:status').text(t.menuRecent, 'menu:recent').row()
        .text(t.menuExpense, 'menu:expense').text(t.menuSearch, 'menu:search').row()
        .text('📊 תקציב', 'menu:budget').text('📋 דוח', 'menu:report').row()
        .text(t.menuSummary, 'menu:summary').text(t.menuSync, 'menu:sync').row()
        .text(t.menuTriage, 'menu:triage').text(t.menuSettings, 'menu:settings');
}

export function categoryKeyboard(categories: string[], callbackPrefix: string): InlineKeyboard {
    const kb = new InlineKeyboard();
    const perRow = 3;
    for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        const data = `${callbackPrefix}${cat}`;
        if (data.length <= 64) {
            kb.text(cat, data);
        }
        if ((i + 1) % perRow === 0 && i < categories.length - 1) {
            kb.row();
        }
    }
    return kb;
}

export function paginationKeyboard(prefix: string, offset: number, pageSize: number, hasMore: boolean): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (offset > 0) {
        kb.text(t.prevPage, `${prefix}${Math.max(0, offset - pageSize)}`);
    }
    if (hasMore) {
        kb.text(t.nextPage, `${prefix}${offset + pageSize}`);
    }
    return kb;
}

export function confirmCancelKeyboard(confirmCb: string, cancelCb: string): InlineKeyboard {
    return new InlineKeyboard()
        .text(t.expenseConfirm, confirmCb)
        .text(t.expenseCancel, cancelCb);
}
```

- [ ] **Step 2: Run full test suite**

```bash
cd app && npm run test
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
cd app && git add utils/telegram-bot/keyboards.ts && git commit -m "feat(telegram-bot): add budget and report to main menu keyboard"
```

- [ ] **Step 4: Final verification — run lint + tests**

```bash
cd app && npm run lint && npm run test
```

Expected: no lint errors, all tests PASS.

- [ ] **Step 5: Final commit if any fixes needed from lint**

```bash
cd app && git add -A && git commit -m "fix(telegram-bot): lint fixes for bot overhaul"
```

Only run if lint required changes. Otherwise skip.
