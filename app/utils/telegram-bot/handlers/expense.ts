import type { Bot } from 'grammy';
import type { BotContext } from '../types';
import { bustCache } from '../cache';
import { cached } from '../cache';
import { escapeMarkdownV2, formatCurrency } from '../formatters';
import { categoryKeyboard, confirmCancelKeyboard } from '../keyboards';
import { t } from '../i18n';
import logger from '../../logger.js';

const CURRENCIES = ['ILS', 'EUR', 'USD', 'GBP'];
const CURRENCY_RE = new RegExp(`\\b(${CURRENCIES.join('|')})\\b`, 'i');
const CAT_CACHE_TTL = 5 * 60 * 1000;

export interface ParsedExpense {
    name: string;
    amount: number;
    currency: string;
    category?: string;
}

export function parseExpenseInput(text: string): ParsedExpense | null {
    const parts = text.trim().split(/\s+/);
    if (parts.length === 0) return null;

    let amount: number | null = null;
    let currency = 'ILS';
    let amountIdx = -1;
    const isIncome = parts.some(p => p.startsWith('+'));

    // Find amount (first token that looks like a number)
    for (let i = 0; i < parts.length; i++) {
        const cleaned = parts[i].replace(/^\+/, '');
        const num = parseFloat(cleaned);
        if (!isNaN(num) && isFinite(num)) {
            amount = isIncome ? Math.abs(num) : -Math.abs(num);
            amountIdx = i;
            break;
        }
    }

    if (amount === null || amountIdx === -1) return null;

    // Find currency
    const remaining = parts.filter((_, i) => i !== amountIdx);
    const currIdx = remaining.findIndex(p => CURRENCY_RE.test(p));
    if (currIdx !== -1) {
        currency = remaining[currIdx].toUpperCase();
        remaining.splice(currIdx, 1);
    }

    if (remaining.length === 0) return null;

    // Last remaining token might be category if we have >1 remaining tokens
    // Heuristic: if there are 2+ remaining parts, last one is category
    let category: string | undefined;
    let name: string;
    if (remaining.length >= 2) {
        // Check if the last part could be a category (not a number)
        const lastPart = remaining[remaining.length - 1];
        if (isNaN(parseFloat(lastPart))) {
            category = lastPart;
            name = remaining.slice(0, -1).join(' ');
        } else {
            name = remaining.join(' ');
        }
    } else {
        name = remaining.join(' ');
    }

    return { name, amount, currency, category };
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

async function insertExpense(getDB: () => Promise<any>, name: string, amount: number, category?: string): Promise<any> {
    const client = await getDB();
    try {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const identifier = `manual_${timestamp}_${randomSuffix}`;

        const result = await client.query(
            `INSERT INTO transactions
             (identifier, vendor, date, name, price, category, type, processed_date, status, account_number, category_source, transaction_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id, name, price, date, category`,
            [identifier, 'manual', dateStr, name.trim(), amount, category || null, 'normal', dateStr, 'completed', 'manual', category ? 'manual' : null, 'credit_card']
        );
        bustCache('txn:');
        bustCache('budget:');
        bustCache('status:');
        return result.rows[0];
    } finally {
        client.release();
    }
}

export function registerExpenseHandler(bot: Bot<BotContext>, getDB: () => Promise<any>): void {
    bot.command('expense', async (ctx) => {
        const input = ctx.match?.trim();

        // Quick parse mode
        if (input) {
            const parsed = parseExpenseInput(input);
            if (!parsed) {
                await ctx.reply(t.expenseInvalidAmount);
                return;
            }

            try {
                const txn = await insertExpense(getDB, parsed.name, parsed.amount, parsed.category);
                const sign = txn.price >= 0 ? '\\+' : '';
                await ctx.reply(
                    `${t.expenseAdded}\n${escapeMarkdownV2('📝')} ${escapeMarkdownV2(txn.name)}\n${escapeMarkdownV2('💰')} ${sign}${escapeMarkdownV2(formatCurrency(Math.abs(txn.price)))}`,
                    { parse_mode: 'MarkdownV2' }
                );
            } catch (err: any) {
                logger.error({ err: err.message }, '[telegram-bot] /expense quick-add failed');
                await ctx.reply(t.errorGeneric);
            }
            return;
        }

        // Guided flow
        if (ctx.session) {
            ctx.session.conversation = {
                type: 'expense',
                step: 'name',
                data: {},
            };
        }
        await ctx.reply(t.expenseAskName);
    });

    bot.callbackQuery('menu:expense', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session) {
            ctx.session.conversation = {
                type: 'expense',
                step: 'name',
                data: {},
            };
        }
        await ctx.reply(t.expenseAskName);
    });

    // Expense category selection in guided flow
    bot.callbackQuery(/^exp:cat:(.+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.session?.conversation || ctx.session.conversation.type !== 'expense') return;

        const category = ctx.match![1];
        ctx.session.conversation.data.category = category;
        ctx.session.conversation.step = 'confirm';

        const { name, amount } = ctx.session.conversation.data as { name: string; amount: number };
        const sign = amount >= 0 ? '\\+' : '';
        await ctx.editMessageText(
            `*${escapeMarkdownV2('אישור הוצאה:')}*\n${escapeMarkdownV2('📝')} ${escapeMarkdownV2(String(name))}\n${escapeMarkdownV2('💰')} ${sign}${escapeMarkdownV2(formatCurrency(Math.abs(amount)))}\n${escapeMarkdownV2('📁')} ${escapeMarkdownV2(category)}`,
            { parse_mode: 'MarkdownV2', reply_markup: confirmCancelKeyboard('exp:confirm', 'exp:cancel') }
        );
    });

    bot.callbackQuery('exp:confirm', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.session?.conversation || ctx.session.conversation.type !== 'expense') return;

        const { name, amount, category } = ctx.session.conversation.data as { name: string; amount: number; category?: string };
        try {
            await insertExpense(getDB, name, amount, category);
            ctx.session.conversation = undefined;
            await ctx.editMessageText(t.expenseAdded, { parse_mode: 'MarkdownV2' });
        } catch (err: any) {
            logger.error({ err: err.message }, '[telegram-bot] expense confirm failed');
            await ctx.answerCallbackQuery({ text: 'שגיאה בשמירת ההוצאה', show_alert: true });
        }
    });

    bot.callbackQuery('exp:cancel', async (ctx) => {
        await ctx.answerCallbackQuery();
        if (ctx.session) {
            ctx.session.conversation = undefined;
        }
        await ctx.editMessageText(t.expenseCancelled, { parse_mode: 'MarkdownV2' });
    });
}

export async function handleExpenseFlowMessage(ctx: BotContext, getDB: () => Promise<any>): Promise<boolean> {
    if (!ctx.session?.conversation || ctx.session.conversation.type !== 'expense') return false;
    const conv = ctx.session.conversation;
    const text = ctx.message?.text?.trim();
    if (!text) return false;

    if (conv.step === 'name') {
        conv.data.name = text;
        conv.step = 'amount';
        await ctx.reply(t.expenseAskAmount);
        return true;
    }

    if (conv.step === 'amount') {
        const isIncome = text.startsWith('+');
        const num = parseFloat(text.replace(/^\+/, ''));
        if (isNaN(num) || !isFinite(num)) {
            await ctx.reply(t.expenseInvalidAmount);
            return true;
        }
        conv.data.amount = isIncome ? Math.abs(num) : -Math.abs(num);
        conv.step = 'category';

        const categories = await fetchCategories(getDB);
        const kb = categoryKeyboard(categories, 'exp:cat:');
        await ctx.reply(t.expenseAskCategory, { reply_markup: kb });
        return true;
    }

    return false;
}
