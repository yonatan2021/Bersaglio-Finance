import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext, TransactionRow } from '../types';
import { cached, bustCache } from '../cache';
import { escapeMarkdownV2, formatTransaction, formatCurrency } from '../formatters';
import { paginationKeyboard, categoryKeyboard } from '../keyboards';
import { t } from '../i18n';
import logger from '../../logger.js';

const PAGE_SIZE = 10;
const TXN_CACHE_TTL = 30 * 1000;
const CAT_CACHE_TTL = 5 * 60 * 1000;

async function fetchRecentTransactions(getDB: () => Promise<any>, offset: number): Promise<{ rows: TransactionRow[]; hasMore: boolean }> {
    const client = await getDB();
    try {
        const result = await client.query(
            `SELECT id, identifier, vendor, date, name, price, category, memo, account_number, transaction_type
             FROM transactions
             WHERE transaction_type = 'credit_card'
             ORDER BY date DESC, id DESC
             LIMIT $1 OFFSET $2`,
            [PAGE_SIZE + 1, offset]
        );
        const hasMore = result.rows.length > PAGE_SIZE;
        return { rows: result.rows.slice(0, PAGE_SIZE), hasMore };
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

async function searchTransactions(getDB: () => Promise<any>, query: string, offset: number): Promise<{ rows: TransactionRow[]; hasMore: boolean }> {
    const client = await getDB();
    try {
        const result = await client.query(
            `SELECT id, identifier, vendor, date, name, price, category, memo, account_number, transaction_type
             FROM transactions
             WHERE name ILIKE $1
             ORDER BY date DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [`%${query}%`, PAGE_SIZE + 1, offset]
        );
        const hasMore = result.rows.length > PAGE_SIZE;
        return { rows: result.rows.slice(0, PAGE_SIZE), hasMore };
    } finally {
        client.release();
    }
}

function buildTransactionList(rows: TransactionRow[], title: string, offset: number, hasMore: boolean, pagePrefix: string): { text: string; keyboard: InlineKeyboard } {
    if (rows.length === 0) {
        return { text: t.recentEmpty, keyboard: new InlineKeyboard() };
    }

    const lines = rows.map((txn, i) => {
        const idx = escapeMarkdownV2(String(offset + i + 1));
        return `${idx}\\. ${formatTransaction(txn)}`;
    });

    const text = [title, '', ...lines].join('\n');
    const kb = paginationKeyboard(pagePrefix, offset, PAGE_SIZE, hasMore);

    return { text, keyboard: kb };
}

export function registerTransactionsHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    // /recent command
    const handleRecent = async (ctx: BotContext, offset = 0) => {
        try {
            const { rows, hasMore } = await fetchRecentTransactions(getDB, offset);
            const { text, keyboard } = buildTransactionList(
                rows, t.recentTitle, offset, hasMore, 'pg:recent:'
            );

            // Add edit category button per row
            if (rows.length > 0) {
                rows.forEach((txn) => {
                    keyboard.row().text(
                        `${t.editCategory} ${txn.name.slice(0, 20)}`,
                        `tr:edit:${txn.id}`
                    );
                });
            }

            await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /recent failed');
            await ctx.reply(t.errorGeneric);
        }
    };

    bot.command('recent', (ctx) => handleRecent(ctx));
    bot.callbackQuery('menu:recent', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleRecent(ctx);
    });

    // Pagination for recent
    bot.callbackQuery(/^pg:recent:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const offset = parseInt(ctx.match![1], 10);
        await handleRecent(ctx, offset);
    });

    // /search command
    bot.command('search', async (ctx) => {
        const query = ctx.match?.trim();
        if (!query) {
            await ctx.reply(t.searchPrompt);
            if (ctx.session) {
                ctx.session.conversation = { type: 'search_filter', step: 'awaiting_query', data: {} };
            }
            return;
        }
        await handleSearch(ctx, query, 0);
    });

    bot.callbackQuery('menu:search', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply(t.searchPrompt);
        if (ctx.session) {
            ctx.session.conversation = { type: 'search_filter', step: 'awaiting_query', data: {} };
        }
    });

    const handleSearch = async (ctx: BotContext, query: string, offset: number) => {
        try {
            const { rows, hasMore } = await searchTransactions(getDB, query, offset);
            const title = `${t.searchTitle} — "${escapeMarkdownV2(query)}"`;
            const { text, keyboard } = buildTransactionList(rows, title, offset, hasMore, `pg:search:${encodeURIComponent(query)}:`);
            await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /search failed');
            await ctx.reply(t.errorGeneric);
        }
    };

    // Pagination for search
    bot.callbackQuery(/^pg:search:(.+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const query = decodeURIComponent(ctx.match![1]);
        const offset = parseInt(ctx.match![2], 10);
        await handleSearch(ctx, query, offset);
    });

    // Edit category flow: show category picker
    bot.callbackQuery(/^tr:edit:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const txnId = ctx.match![1];
        try {
            const categories = await fetchCategories(getDB);
            const kb = categoryKeyboard(categories, `cat:${txnId}:`);
            await ctx.reply(
                escapeMarkdownV2(`בחר קטגוריה לעסקה #${txnId}:`),
                { parse_mode: 'MarkdownV2', reply_markup: kb }
            );
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] category picker failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בטעינת קטגוריות', show_alert: true });
        }
    });

    // Apply category to transaction
    bot.callbackQuery(/^cat:(\d+):(.+)$/, async (ctx) => {
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
            await ctx.editMessageText(
                escapeMarkdownV2(`✅ עסקה #${txnId} סווגה כ: ${category}`),
                { parse_mode: 'MarkdownV2' }
            );
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] category update failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בעדכון קטגוריה', show_alert: true });
        }
    });
}
