import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { bustAllCache } from '../cache';
import { escapeMarkdownV2 } from '../formatters';
import { t } from '../i18n';
import logger from '../../logger.js';

export function registerSyncHandler(bot: Bot<BotContext>): void {
    const handle = async (ctx: BotContext) => {
        const loadingMsg = await ctx.reply(t.syncStarted, { parse_mode: 'MarkdownV2' });

        try {
            const { runBackgroundSync } = await import('../../../scripts/background-sync.js');
            await runBackgroundSync();
            bustAllCache();

            await ctx.api.editMessageText(
                ctx.chat!.id,
                loadingMsg.message_id,
                t.syncComplete,
                { parse_mode: 'MarkdownV2' }
            );
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /sync failed');
            await ctx.api.editMessageText(
                ctx.chat!.id,
                loadingMsg.message_id,
                `${t.syncFailed}\n${escapeMarkdownV2(err.message || '')}`,
                { parse_mode: 'MarkdownV2' }
            );
        }
    };

    bot.command('sync', handle);
    bot.callbackQuery('menu:sync', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handle(ctx);
    });
}
