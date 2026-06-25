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

    await ctx.reply(t.aiThinking, { parse_mode: 'MarkdownV2' });

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

        await ctx.reply(text);
    } catch (err: any) {
        logger.error({ err: err.message }, '[telegram-bot] AI fallback failed');
        await ctx.reply(t.aiFallbackError, { parse_mode: 'MarkdownV2' });
    }
}

export function registerAIHandler(_bot: Bot<BotContext>, _getDB: () => Promise<any>): void {
    // AI fallback is not a command — it's called from the catch-all
    // message:text handler in bot.ts via handleAIFallback()
}
