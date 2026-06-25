import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerReportHandler } from '../../../utils/telegram-bot/handlers/report';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

describe('report handler', () => {
    let bot: any;

    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
        bot = { command: vi.fn(), callbackQuery: vi.fn() };
        registerReportHandler(bot, mockGetDB);
    });

    it('registers /report command and callbacks', () => {
        expect(bot.command).toHaveBeenCalledWith('report', expect.any(Function));
        expect(bot.callbackQuery).toHaveBeenCalledWith('menu:report', expect.any(Function));
        const callbacks = bot.callbackQuery.mock.calls.map((c: any) => c[0]);
        expect(callbacks).toContain('rpt:weekly');
        expect(callbacks).toContain('rpt:monthly');
    });

    it('/report shows period picker', async () => {
        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'report')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [text, opts] = replyFn.mock.calls[0];
        expect(text).toContain('תקופה');
        expect(opts.reply_markup).toBeDefined();
    });

    it('weekly report shows spending breakdown', async () => {
        // Current period expenses
        mockClient.query.mockResolvedValueOnce({
            rows: [{ total: '2150' }],
        });
        // Category breakdown
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'אוכל', total: '850' },
                { category: 'תחבורה', total: '420' },
            ],
        });
        // Biggest expense
        mockClient.query.mockResolvedValueOnce({
            rows: [{ name: 'שופרסל', price: '-420' }],
        });
        // Previous period total
        mockClient.query.mockResolvedValueOnce({
            rows: [{ total: '1970' }],
        });

        const answerFn = vi.fn();
        const replyFn = vi.fn();
        const ctx = { answerCallbackQuery: answerFn, reply: replyFn } as any;
        const cbHandler = bot.callbackQuery.mock.calls.find((c: any) => c[0] === 'rpt:weekly')[1];
        await cbHandler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [message] = replyFn.mock.calls[0];
        expect(message).toContain('דוח');
        expect(message).toContain('אוכל');
        expect(message).toContain('━━━');
    });

    it('handles DB error gracefully', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('db fail'));

        const answerFn = vi.fn();
        const replyFn = vi.fn();
        const ctx = { answerCallbackQuery: answerFn, reply: replyFn } as any;
        const cbHandler = bot.callbackQuery.mock.calls.find((c: any) => c[0] === 'rpt:weekly')[1];
        await cbHandler(ctx);

        expect(replyFn).toHaveBeenCalledWith(expect.stringContaining('השתבש'), expect.anything());
    });
});
