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
    mockClient.query.mockResolvedValueOnce({
        rows: [{ bank_income: '12500', bank_expenses: '3000', card_expenses: '5340' }],
    });
    mockClient.query.mockResolvedValueOnce({
        rows: [
            { category: 'אוכל', budget_limit: '2500' },
            { category: 'תחבורה', budget_limit: '1800' },
        ],
    });
    mockClient.query.mockResolvedValueOnce({
        rows: [
            { category: 'אוכל', actual_spent: '2100' },
            { category: 'תחבורה', actual_spent: '1200' },
        ],
    });
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

    it('replies with status message', async () => {
        setupDefaultQueryMocks();
        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);
        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];
        await commandHandler(ctx);
        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('סטטוס תקציב');
        expect(message).toContain('תזרים חודשי');
        expect(message).toContain('━━━');
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
        setupDefaultQueryMocks();
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
    });

    it('fetches correct data from queries', async () => {
        setupDefaultQueryMocks();
        const data = await fetchStatusData(mockGetDB);
        expect(data.bankIncome).toBe(12500);
        expect(data.bankExpenses).toBe(3000);
        expect(data.cardExpenses).toBe(5340);
        expect(data.totalBudget).toBe(13500);
        expect(data.totalActual).toBe(3300);
        expect(data.categories).toHaveLength(2);
    });

    it('buildStatusMessage includes all sections with separators', () => {
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
        expect(message).toContain('━━━');
        expect(message).toContain('אוכל');
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
    });

    it('uses cache on second call', async () => {
        setupDefaultQueryMocks();
        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as unknown as BotContext;
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerStatusHandler(bot, mockGetDB);
        const commandHandler = bot.command.mock.calls.find((c: any) => c[0] === 'status')?.[1];
        await commandHandler(ctx);
        expect(mockGetDB).toHaveBeenCalledTimes(1);
        await commandHandler(ctx);
        expect(mockGetDB).toHaveBeenCalledTimes(1);
        expect(replyFn).toHaveBeenCalledTimes(2);
    });
});
