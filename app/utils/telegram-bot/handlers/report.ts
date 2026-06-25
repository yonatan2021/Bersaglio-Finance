import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../types';
import { cached } from '../cache';
import { formatCurrency, sectionSeparator } from '../formatters';
import { t } from '../i18n';
import logger from '../../logger.js';

const REPORT_CACHE_TTL = 5 * 60 * 1000;

interface ReportData {
    periodLabel: string;
    totalExpenses: number;
    dailyAvg: number;
    categories: { category: string; total: number; percent: number }[];
    biggestExpense: { name: string; amount: number } | null;
    previousTotal: number;
}

function getDateRange(period: 'weekly' | 'monthly'): { start: string; end: string; prevStart: string; prevEnd: string; days: number; label: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (period === 'monthly') {
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0);
        const prevStart = new Date(year, month - 1, 1);
        const prevEnd = new Date(year, month, 0);
        const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
            prevStart: prevStart.toISOString().split('T')[0],
            prevEnd: prevEnd.toISOString().split('T')[0],
            days: now.getDate(),
            label: `${monthNames[month]} ${year}`,
        };
    }

    // Weekly: last 7 days
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 6);

    const formatShort = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
        prevStart: prevStart.toISOString().split('T')[0],
        prevEnd: prevEnd.toISOString().split('T')[0],
        days: 7,
        label: `${formatShort(start)}-${formatShort(end)}`,
    };
}

async function fetchReportData(getDB: () => Promise<any>, period: 'weekly' | 'monthly'): Promise<ReportData> {
    const range = getDateRange(period);
    const client = await getDB();
    try {
        const [totalRes, categoriesRes, biggestRes, prevRes] = await Promise.all([
            client.query(
                `SELECT COALESCE(SUM(ABS(price)), 0) as total
                 FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'`,
                [range.start, range.end]
            ),
            client.query(
                `SELECT category, ABS(ROUND(SUM(price))) as total
                 FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'
                   AND category IS NOT NULL AND category != '' AND category != 'N/A'
                 GROUP BY category ORDER BY total DESC`,
                [range.start, range.end]
            ),
            client.query(
                `SELECT name, price FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'
                 ORDER BY price ASC LIMIT 1`,
                [range.start, range.end]
            ),
            client.query(
                `SELECT COALESCE(SUM(ABS(price)), 0) as total
                 FROM transactions
                 WHERE date >= $1 AND date <= $2 AND price < 0 AND transaction_type = 'credit_card'`,
                [range.prevStart, range.prevEnd]
            ),
        ]);

        const totalExpenses = parseFloat(totalRes.rows[0]?.total) || 0;
        const categories = categoriesRes.rows.map((r: any) => {
            const catTotal = parseFloat(r.total) || 0;
            return {
                category: r.category,
                total: catTotal,
                percent: totalExpenses > 0 ? Math.round((catTotal / totalExpenses) * 100) : 0,
            };
        });

        const biggest = biggestRes.rows[0];
        const previousTotal = parseFloat(prevRes.rows[0]?.total) || 0;

        return {
            periodLabel: range.label,
            totalExpenses,
            dailyAvg: range.days > 0 ? Math.round(totalExpenses / range.days) : 0,
            categories,
            biggestExpense: biggest ? { name: biggest.name, amount: Math.abs(parseFloat(biggest.price)) } : null,
            previousTotal,
        };
    } finally {
        client.release();
    }
}

function buildReportMessage(data: ReportData, periodType: string): string {
    const { periodLabel, totalExpenses, dailyAvg, categories, biggestExpense, previousTotal } = data;
    const sep = sectionSeparator();
    const periodName = periodType === 'weekly' ? t.reportWeekly : t.reportMonthly;

    const lines = [
        `${t.reportTitle} ${periodName} — ${periodLabel}`,
        '',
        sep,
        '',
        `💰 ${t.reportTotalExpenses}`,
        `   ${t.reportTotalExpenses}: ${formatCurrency(totalExpenses)}`,
        `   ${t.reportDailyAvg}: ${formatCurrency(dailyAvg)}`,
        '',
        sep,
        '',
        `📊 ${t.reportByCategory}`,
    ];

    for (const cat of categories) {
        lines.push(`   ${cat.category}: ${formatCurrency(cat.total)} (${cat.percent}%)`);
    }

    if (categories.length === 0) {
        lines.push('   אין נתונים');
    }

    lines.push('', sep, '');

    // Trend
    if (previousTotal > 0) {
        const diff = totalExpenses - previousTotal;
        const pct = Math.round(Math.abs(diff / previousTotal) * 100);
        const direction = diff >= 0 ? '↑' : '↓';
        lines.push(`📈 ${t.reportTrend}`);
        lines.push(`   ${t.reportVsPrevious(String(pct), direction)}`);
    }

    if (biggestExpense) {
        lines.push(`   ${t.reportBiggest}: ${biggestExpense.name} ${formatCurrency(biggestExpense.amount)}`);
    }

    return lines.join('\n');
}

export function registerReportHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    const showPicker = async (ctx: BotContext) => {
        const kb = new InlineKeyboard()
            .text(`📅 ${t.reportWeekly}`, 'rpt:weekly')
            .text(`📅 ${t.reportMonthly}`, 'rpt:monthly');
        await ctx.reply(t.reportPickPeriod, { parse_mode: undefined, reply_markup: kb });
    };

    const handleReport = async (ctx: BotContext, period: 'weekly' | 'monthly') => {
        try {
            const cacheKey = `report:${period}`;
            const data = await cached(cacheKey, REPORT_CACHE_TTL, () => fetchReportData(getDB, period));
            const message = buildReportMessage(data, period);
            await ctx.reply(message, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /report failed');
            await ctx.reply(t.errorGeneric, { parse_mode: undefined });
        }
    };

    bot.command('report', (ctx) => showPicker(ctx));
    bot.callbackQuery('menu:report', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showPicker(ctx);
    });

    bot.callbackQuery('rpt:weekly', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleReport(ctx, 'weekly');
    });

    bot.callbackQuery('rpt:monthly', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleReport(ctx, 'monthly');
    });
}
