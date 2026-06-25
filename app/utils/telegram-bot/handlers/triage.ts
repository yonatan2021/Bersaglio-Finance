import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { bustCache, cached } from '../cache';
import { escapeMarkdownV2, formatCurrency, formatDate } from '../formatters';
import { categoryKeyboard } from '../keyboards';
import { t } from '../i18n';
import logger from '../../logger.js';

const CAT_CACHE_TTL = 5 * 60 * 1000;

interface UncategorizedTxn {
    id: number;
    name: string;
    price: number;
    date: string;
    vendor: string;
}

async function fetchUncategorized(getDB: () => Promise<any>): Promise<UncategorizedTxn[]> {
    const client = await getDB();
    try {
        const result = await client.query(
            `SELECT id, name, price, date, vendor
             FROM transactions
             WHERE (category IS NULL OR category = '' OR category = 'N/A')
               AND transaction_type = 'credit_card'
             ORDER BY date DESC
             LIMIT 50`
        );
        return result.rows;
    } finally {
        client.release();
    }
}

async function fetchCategories(getDB: () => Promise<any>): Promise<string[]> {
    return cached('categories:list', CAT_CACHE_TTL, async () => {
        const client = await getDB();
        try {
            const result = await client.query(
                `SELECT DISTINCT category FROM transactions
                 WHERE category IS NOT NULL AND category != '' AND category != 'N/A'
                 ORDER BY category`
            );
            return result.rows.map((r: any) => r.category);
        } finally {
            client.release();
        }
    });
}

function formatTriageTxn(txn: UncategorizedTxn): string {
    const date = escapeMarkdownV2(formatDate(txn.date));
    const name = escapeMarkdownV2(txn.name);
    const amount = escapeMarkdownV2(formatCurrency(Math.abs(txn.price)));
    return `📝 *${name}*\n💰 ${amount} \\| 📅 ${date}`;
}

async function showNextTriage(ctx: BotContext, getDB: () => Promise<any>, categorizedCount: number): Promise<void> {
    const items = await fetchUncategorized(getDB);

    if (items.length === 0) {
        const msg = categorizedCount > 0 ? t.triageDone(categorizedCount) : t.triageEmpty;
        await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
        return;
    }

    const txn = items[0];
    const text = `${t.triageTitle}\n\n${formatTriageTxn(txn)}\n\n_${escapeMarkdownV2(`${items.length} עסקאות נותרו`)}_`;
    const categories = await fetchCategories(getDB);
    const kb = categoryKeyboard(categories, `tri:cat:${txn.id}:`);
    kb.row().text(t.triageSkip, `tri:skip:${txn.id}`);

    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: kb });
}

export function registerTriageHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    bot.command('triage', async (ctx) => {
        if (ctx.session) {
            ctx.session.conversation = { type: 'triage', step: 'active', data: { categorized: 0 } };
        }
        await showNextTriage(ctx, getDB, 0);
    });

    bot.callbackQuery('menu:triage', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session) {
            ctx.session.conversation = { type: 'triage', step: 'active', data: { categorized: 0 } };
        }
        await showNextTriage(ctx, getDB, 0);
    });

    // Categorize a transaction in triage
    bot.callbackQuery(/^tri:cat:(\d+):(.+)$/, async (ctx) => {
        const txnId = ctx.match![1];
        const category = ctx.match![2];

        try {
            const client = await getDB();
            try {
                await client.query(
                    'UPDATE transactions SET category = $1, category_source = $2 WHERE id = $3',
                    [category, 'manual', txnId]
                );
            } finally {
                client.release();
            }
            bustCache('txn:');
            bustCache('budget:');
            bustCache('status:');

            await ctx.answerCallbackQuery({ text: `✅ ${category}` });

            const count = ((ctx.session?.conversation?.data?.categorized as number) || 0) + 1;
            if (ctx.session?.conversation) {
                ctx.session.conversation.data.categorized = count;
            }

            await showNextTriage(ctx, getDB, count);
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] triage categorize failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בעדכון קטגוריה', show_alert: true });
        }
    });

    // Skip a transaction in triage — just show next
    bot.callbackQuery(/^tri:skip:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const count = (ctx.session?.conversation?.data?.categorized as number) || 0;
        await showNextTriage(ctx, getDB, count);
    });
}
