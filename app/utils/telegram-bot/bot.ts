import { Bot, session } from 'grammy';
import { loadMessagingSettings } from '../messaging/settings.js';
import { authMiddleware } from './auth';
import { registerStatusHandler } from './handlers/status';
import { registerTransactionsHandler } from './handlers/transactions';
import { registerExpenseHandler, handleExpenseFlowMessage } from './handlers/expense';
import { registerSummaryHandler } from './handlers/summary';
import { registerTriageHandler } from './handlers/triage';
import { registerSyncHandler } from './handlers/sync';
import { registerSettingsHandler } from './handlers/settings';
import { handleAIFallback } from './handlers/ai';
import { mainMenuKeyboard } from './keyboards';
import { t } from './i18n';
import logger from '../logger.js';
import type { BotContext, BotSession } from './types';

let botInstance: Bot<BotContext> | null = null;

export function createBot(token: string, getDB: () => Promise<any>): Bot<BotContext> {
    const bot = new Bot<BotContext>(token);

    bot.use(session<BotSession, BotContext>({
        initial: (): BotSession => ({}),
    }));

    bot.use(authMiddleware(getDB));

    bot.command('start', async (ctx) => {
        await ctx.reply(t.welcome, {
            reply_markup: mainMenuKeyboard(),
        });
    });

    // Register handlers
    registerStatusHandler(bot, getDB);
    registerTransactionsHandler(bot, getDB);
    registerExpenseHandler(bot, getDB);
    registerSummaryHandler(bot);
    registerTriageHandler(bot, getDB);
    registerSyncHandler(bot);
    registerSettingsHandler(bot, getDB);

    // Message handler: guided flows first, then AI fallback
    bot.on('message:text', async (ctx) => {
        // Check guided expense flow
        const handled = await handleExpenseFlowMessage(ctx, getDB);
        if (handled) return;

        // Check search query flow
        if (ctx.session?.conversation?.type === 'search_filter' && ctx.session.conversation.step === 'awaiting_query') {
            const query = ctx.message.text.trim();
            ctx.session.conversation = undefined;
        }

        // AI fallback for unrecognized text
        await handleAIFallback(ctx, getDB);
    });

    bot.catch((err) => {
        logger.error({ err: err.message, stack: err.stack }, '[telegram-bot] Unhandled error');
        try {
            err.ctx?.reply(t.errorGeneric).catch(() => {});
        } catch {
            // ignore — best effort
        }
    });

    return bot;
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
