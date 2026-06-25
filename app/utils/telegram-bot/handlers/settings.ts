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
