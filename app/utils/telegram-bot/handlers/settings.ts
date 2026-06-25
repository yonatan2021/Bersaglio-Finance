import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { bustCache } from '../cache';
import { escapeMarkdownV2 } from '../formatters';
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

            const modelDisplay = escapeMarkdownV2(config.model || 'לא מוגדר');
            const baseUrlDisplay = escapeMarkdownV2(config.baseURL || 'לא מוגדר');
            const modeDisplay = escapeMarkdownV2(summaryMode === 'cycle' ? 'מחזור חיוב' : 'חודש קלנדרי');

            const text = [
                t.settingsTitle,
                '',
                `🤖 *${escapeMarkdownV2('מודל AI')}:* ${modelDisplay}`,
                `🌐 *${escapeMarkdownV2('כתובת API')}:* ${baseUrlDisplay}`,
                `📅 *${escapeMarkdownV2('מצב סיכום')}:* ${modeDisplay}`,
            ].join('\n');

            const kb = new InlineKeyboard()
                .text('🔄 החלף מצב סיכום', 'set:toggle_summary_mode');

            await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /settings failed');
            await ctx.reply(t.errorGeneric);
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
