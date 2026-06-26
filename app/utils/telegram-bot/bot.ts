import { Bot, session } from 'grammy';
import { hydrate } from '@grammyjs/hydrate';
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
    { command: 'whoami', description: 'Debug: הצג Chat ID וסטטוס גישה' },
];

export function createBot(token: string, getDB: () => Promise<any>): Bot<BotContext> {
    const bot = new Bot<BotContext>(token);

    // Plugin middleware stack (order matters)
    bot.use(session<BotSession, BotContext>({
        initial: (): BotSession => ({}),
    }));
    bot.use(hydrate());
    bot.use(autoChatAction(bot.api) as any);

    // DEBUG: /whoami responds BEFORE auth so users can see their chat ID.
    // Remove this command once the whitelist is confirmed working.
    bot.command('whoami', async (ctx) => {
        const chatId = String(ctx.chat?.id ?? 'unknown');
        const { loadMessagingSettings } = await import('../messaging/settings.js');
        let whitelistStatus = 'לא ניתן לבדוק (שגיאה)';
        try {
            const settings = await loadMessagingSettings({ getDB });
            const allowed = (settings.telegram_to || '')
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);
            whitelistStatus = allowed.includes(chatId)
                ? '✅ ב-whitelist'
                : `❌ לא ב-whitelist (telegram_to = "${settings.telegram_to || 'ריק'}")` ;
        } catch (e: any) {
            whitelistStatus = `שגיאה: ${e.message}`;
        }
        await ctx.reply(
            `🔍 Debug Info\n\nChat ID: ${chatId}\nסטטוס: ${whitelistStatus}\n\nהעתק את ה-Chat ID והגדר אותו ב-telegram_to בהגדרות.`,
            { parse_mode: undefined }
        );
    });

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

        // Search query flow — session guard prevents crash on undefined session
        if (ctx.session?.conversation?.type === 'search_filter' && ctx.session.conversation.step === 'awaiting_query') {
            const query = ctx.message?.text?.trim() ?? '';
            if (query) {
                ctx.session.conversation = undefined;
                const { handleSearchQuery } = await import('./handlers/transactions');
                await handleSearchQuery(ctx, getDB, query);
                return;
            }
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
