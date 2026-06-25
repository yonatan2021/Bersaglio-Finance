import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { t } from '../i18n';
import logger from '../../logger.js';

export function registerSummaryHandler(bot: Bot<BotContext>): void {
    const handle = async (ctx: BotContext) => {
        await ctx.reply(t.summaryLoading, { parse_mode: 'MarkdownV2' });
        try {
            const { generateDailySummary } = await import('../../summary.js');
            const summary = await generateDailySummary();
            await ctx.reply(summary);
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /summary failed');
            await ctx.reply(t.summaryError, { parse_mode: 'MarkdownV2' });
        }
    };

    bot.command('summary', handle);
    bot.callbackQuery('menu:summary', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handle(ctx);
    });
}
