import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBudgetHandler } from '../../../utils/telegram-bot/handlers/budget';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

describe('budget handler', () => {
    let bot: any;

    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
        bot = { command: vi.fn(), callbackQuery: vi.fn() };
        registerBudgetHandler(bot, mockGetDB);
    });

    it('registers /budget command and menu callback', () => {
        expect(bot.command).toHaveBeenCalledWith('budget', expect.any(Function));
        expect(bot.callbackQuery).toHaveBeenCalledWith('menu:budget', expect.any(Function));
    });

    it('replies with per-category budget breakdown', async () => {
        // total budget
        mockClient.query.mockResolvedValueOnce({
            rows: [{ budget_limit: '10000' }],
        });
        // budgets per category
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'אוכל', budget_limit: '3000' },
                { category: 'תחבורה', budget_limit: '2000' },
            ],
        });
        // actual spending
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'אוכל', actual_spent: '2800' },
                { category: 'תחבורה', actual_spent: '1200' },
            ],
        });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('תקציב חודשי');
        expect(message).toContain('אוכל');
        expect(message).toContain('תחבורה');
        expect(message).toContain('━━━');
        expect(message).toContain('▓');
    });

    it('handles empty budgets', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('תקציב חודשי');
    });

    it('replies with error on DB failure', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('db fail'));

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledWith(expect.stringContaining('השתבש'), expect.anything());
    });

    it('releases DB client', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'budget')[1];
        await handler(ctx);

        expect(mockClient.release).toHaveBeenCalled();
    });
});
