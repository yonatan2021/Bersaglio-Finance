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
