import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseExpenseInput, registerExpenseHandler } from '../../../utils/telegram-bot/handlers/expense';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe('parseExpenseInput', () => {
    it('parses simple "name amount"', () => {
        const result = parseExpenseInput('קפה 15');
        expect(result).toEqual({ name: 'קפה', amount: -15, currency: 'ILS', category: undefined });
    });

    it('parses "amount name"', () => {
        const result = parseExpenseInput('15 קפה');
        expect(result).toEqual({ name: 'קפה', amount: -15, currency: 'ILS', category: undefined });
    });

    it('parses income with + prefix', () => {
        const result = parseExpenseInput('+500 החזר');
        expect(result).toEqual({ name: 'החזר', amount: 500, currency: 'ILS', category: undefined });
    });

    it('parses with currency', () => {
        const result = parseExpenseInput('15 EUR coffee');
        expect(result).toEqual({ name: 'coffee', amount: -15, currency: 'EUR', category: undefined });
    });

    it('parses with category as last token', () => {
        const result = parseExpenseInput('קפה 15 אוכל');
        expect(result).toEqual({ name: 'קפה', amount: -15, currency: 'ILS', category: 'אוכל' });
    });

    it('parses multi-word name with category', () => {
        const result = parseExpenseInput('coffee shop 25 אוכל');
        expect(result).toEqual({ name: 'coffee shop', amount: -25, currency: 'ILS', category: 'אוכל' });
    });

    it('returns null for no amount', () => {
        expect(parseExpenseInput('just text')).toBeNull();
    });

    it('returns null for empty input', () => {
        expect(parseExpenseInput('')).toBeNull();
    });

    it('returns null for amount only', () => {
        expect(parseExpenseInput('15')).toBeNull();
    });
});

describe('registerExpenseHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
    });

    it('registers /expense command', () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn(), on: vi.fn() } as any;
        const mockGetDB = vi.fn();
        registerExpenseHandler(bot, mockGetDB);
        const commands = bot.command.mock.calls.map((c: any) => c[0]);
        expect(commands).toContain('expense');
    });
});
