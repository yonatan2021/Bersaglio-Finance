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
