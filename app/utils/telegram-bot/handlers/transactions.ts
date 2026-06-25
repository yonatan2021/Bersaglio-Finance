import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext, TransactionRow } from '../types';
import { cached, bustCache } from '../cache';
import { formatTransactionCard, thinSeparator } from '../formatters';
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

    const sep = thinSeparator();
    const cards = rows.map((txn) => formatTransactionCard(txn));
    const text = [title, '', sep, '', cards.join(`\n\n${sep}\n\n`), '', sep].join('\n');
    const kb = paginationKeyboard(pagePrefix, offset, PAGE_SIZE, hasMore);

    return { text, keyboard: kb };
}

export async function handleSearchQuery(ctx: BotContext, getDB: () => Promise<any>, query: string, offset = 0): Promise<void> {
    try {
        const { rows, hasMore } = await searchTransactions(getDB, query, offset);
        const title = `${t.searchTitle} — "${query}"`;
        const { text, keyboard } = buildTransactionList(rows, title, offset, hasMore, `pg:search:${encodeURIComponent(query)}:`);
        await ctx.reply(text, { parse_mode: undefined, reply_markup: keyboard });
    } catch (err: any) {
        logger.error({ err: err.message }, '[telegram-bot] /search failed');
        await ctx.reply(t.errorGeneric, { parse_mode: undefined });
    }
}

export function registerTransactionsHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    const handleRecent = async (ctx: BotContext, offset = 0) => {
        try {
            const { rows, hasMore } = await fetchRecentTransactions(getDB, offset);
            const { text, keyboard } = buildTransactionList(
                rows, t.recentTitle, offset, hasMore, 'pg:recent:'
            );

            if (rows.length > 0) {
                keyboard.row().text(t.editCategory, 'tr:pick');
            }

            await ctx.reply(text, { parse_mode: undefined, reply_markup: keyboard });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] /recent failed');
            await ctx.reply(t.errorGeneric, { parse_mode: undefined });
        }
    };

    bot.command('recent', (ctx) => handleRecent(ctx));
    bot.callbackQuery('menu:recent', async (ctx) => {
        await ctx.answerCallbackQuery();
        await handleRecent(ctx);
    });

    bot.callbackQuery(/^pg:recent:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const offset = parseInt(ctx.match![1], 10);
        await handleRecent(ctx, offset);
    });

    // Edit category pick — show recent transactions with numbered buttons
    bot.callbackQuery('tr:pick', async (ctx) => {
        await ctx.answerCallbackQuery();
        try {
            const { rows } = await fetchRecentTransactions(getDB, 0);
            if (rows.length === 0) return;
            const kb = new InlineKeyboard();
            rows.forEach((txn, i) => {
                const label = `${i + 1}. ${txn.name.slice(0, 25)}`;
                kb.text(label, `tr:edit:${txn.id}`).row();
            });
            await ctx.reply('בחר עסקה לעריכת קטגוריה:', { parse_mode: undefined, reply_markup: kb });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] tr:pick failed');
        }
    });

    bot.command('search', async (ctx) => {
        const query = ctx.match?.trim();
        if (!query) {
            await ctx.reply(t.searchPrompt, { parse_mode: undefined });
            if (ctx.session) {
                ctx.session.conversation = { type: 'search_filter', step: 'awaiting_query', data: {} };
            }
            return;
        }
        await handleSearchQuery(ctx, getDB, query);
    });

    bot.callbackQuery('menu:search', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply(t.searchPrompt, { parse_mode: undefined });
        if (ctx.session) {
            ctx.session.conversation = { type: 'search_filter', step: 'awaiting_query', data: {} };
        }
    });

    bot.callbackQuery(/^pg:search:(.+):(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const query = decodeURIComponent(ctx.match![1]);
        const offset = parseInt(ctx.match![2], 10);
        await handleSearchQuery(ctx, getDB, query, offset);
    });

    bot.callbackQuery(/^tr:edit:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const txnId = ctx.match![1];
        try {
            const categories = await fetchCategories(getDB);
            const kb = categoryKeyboard(categories, `cat:${txnId}:`);
            await ctx.reply(`בחר קטגוריה לעסקה #${txnId}:`, { parse_mode: undefined, reply_markup: kb });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] category picker failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בטעינת קטגוריות', show_alert: true });
        }
    });

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
            await ctx.editMessageText(`✅ עסקה #${txnId} סווגה כ: ${category}`, { parse_mode: undefined });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] category update failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בעדכון קטגוריה', show_alert: true });
        }
    });
}
