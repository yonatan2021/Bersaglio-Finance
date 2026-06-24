import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerStatusHandler, fetchStatusData, buildStatusMessage } from '../../../utils/telegram-bot/handlers/status';
import { bustAllCache } from '../../../utils/telegram-bot/cache';
import type { BotContext } from '../../../utils/telegram-bot/types';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

function setupDefaultQueryMocks() {
    // summary query
    mockClient.query.mockResolvedValueOnce({
        rows: [{ bank_income: '12500', bank_expenses: '3000', card_expenses: '5340' }],
    });
    // budgets query
    mockClient.query.mockResolvedValueOnce({
        rows: [
            { category: 'אוכל', budget_limit: '2500' },
            { category: 'תחבורה', budget_limit: '1800' },
        ],
    });
    // actual spending query
    mockClient.query.mockResolvedValueOnce({
        rows: [
            { category: 'אוכל', actual_spent: '2100' },
            { category: 'תחבורה', actual_spent: '1200' },
        ],
    });
    // total budget query
    mockClient.query.mockResolvedValueOnce({
        rows: [{ budget_limit: '13500' }],
    });
}

describe('status handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
    });

    it('registers command and callback query handlers', () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);

        expect(bot.command).toHaveBeenCalledWith('status', expect.any(Function));
        expect(bot.callbackQuery).toHaveBeenCalledWith('menu:status', expect.any(Function));
    });

    it('replies with MarkdownV2 status message', async () => {
        setupDefaultQueryMocks();

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;

        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);

        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];
        expect(commandHandler).toBeDefined();

        await commandHandler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message, opts] = replyFn.mock.calls[0];
        expect(opts.parse_mode).toBe('MarkdownV2');
        expect(message).toContain('סטטוס תקציב');
        expect(message).toContain('תזרים חודשי');
    });

    it('callback query handler answers callback and replies', async () => {
        setupDefaultQueryMocks();

        const replyFn = vi.fn();
        const answerCallbackQuery = vi.fn();
        const ctx = { reply: replyFn, answerCallbackQuery } as unknown as BotContext;

        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);

        const cbHandler = bot.callbackQuery.mock.calls.find((c: any) => c[0] === 'menu:status')?.[1];
        expect(cbHandler).toBeDefined();

        await cbHandler(ctx);

        expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
        expect(replyFn).toHaveBeenCalledTimes(1);
    });

    it('releases the DB client even on success', async () => {
        setupDefaultQueryMocks();

        await fetchStatusData(mockGetDB);

        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('releases the DB client on query failure', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('DB error'));

        await expect(fetchStatusData(mockGetDB)).rejects.toThrow('DB error');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('replies with error message on DB failure', async () => {
        // Mock the first query to fail (after getDB succeeds)
        // This avoids unhandled rejection in the cache layer
        setupDefaultQueryMocks();
        // Override: make first query fail
        mockClient.query.mockReset();
        mockClient.query.mockRejectedValueOnce(new Error('query failed'));

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;

        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);

        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];
        await commandHandler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('משהו השתבש');
        expect(mockClient.release).toHaveBeenCalled();
    });

    it('fetches correct data from queries', async () => {
        setupDefaultQueryMocks();

        const data = await fetchStatusData(mockGetDB);

        expect(data.bankIncome).toBe(12500);
        expect(data.bankExpenses).toBe(3000);
        expect(data.cardExpenses).toBe(5340);
        expect(data.totalBudget).toBe(13500);
        expect(data.totalActual).toBe(3300); // 2100 + 1200
        expect(data.categories).toHaveLength(2);
        expect(data.categories[0].category).toBe('אוכל');
        expect(data.categories[0].actual).toBe(2100);
        expect(data.categories[0].budget).toBe(2500);
        expect(data.categories[0].percentUsed).toBe(84);
        expect(data.categories[0].isOverBudget).toBe(false);
    });

    it('handles empty total_budget table', async () => {
        // summary
        mockClient.query.mockResolvedValueOnce({
            rows: [{ bank_income: '0', bank_expenses: '0', card_expenses: '0' }],
        });
        // budgets
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        // actuals
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        // total budget - empty
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const data = await fetchStatusData(mockGetDB);
        expect(data.totalBudget).toBe(0);
        expect(data.categories).toHaveLength(0);
    });

    it('buildStatusMessage includes all sections', () => {
        const data = {
            bankIncome: 12500,
            bankExpenses: 3000,
            cardExpenses: 5340,
            totalBudget: 13500,
            totalActual: 3300,
            categories: [
                { category: 'אוכל', actual: 2100, budget: 2500, remaining: 400, percentUsed: 84, isOverBudget: false },
                { category: 'תחבורה', actual: 1200, budget: 1800, remaining: 600, percentUsed: 67, isOverBudget: false },
            ],
            daysPassed: 15,
            totalDays: 30,
        };

        const message = buildStatusMessage(data);

        expect(message).toContain('סטטוס תקציב');
        expect(message).toContain('תזרים חודשי');
        expect(message).toContain('ניצול תקציב');
        expect(message).toContain('טופ 3 קטגוריות');
        expect(message).toContain('בורנדאון');
        expect(message).toContain('אוכל');
        expect(message).toContain('תחבורה');
    });

    it('buildStatusMessage shows negative net with warning', () => {
        const data = {
            bankIncome: 5000,
            bankExpenses: 3000,
            cardExpenses: 5000,
            totalBudget: 10000,
            totalActual: 5000,
            categories: [],
            daysPassed: 15,
            totalDays: 30,
        };

        const message = buildStatusMessage(data);
        expect(message).toContain('⚠️');
        expect(message).toContain('\\-');
    });

    it('uses cache on second call', async () => {
        setupDefaultQueryMocks();

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;

        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);

        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];

        // First call - hits DB
        await commandHandler(ctx);
        expect(mockGetDB).toHaveBeenCalledTimes(1);

        // Second call - should use cache
        await commandHandler(ctx);
        expect(mockGetDB).toHaveBeenCalledTimes(1); // still 1, not 2
        expect(replyFn).toHaveBeenCalledTimes(2);
    });
});
