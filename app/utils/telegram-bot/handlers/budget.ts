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
