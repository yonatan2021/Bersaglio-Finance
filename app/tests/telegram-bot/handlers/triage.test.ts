import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTriageHandler } from '../../../utils/telegram-bot/handlers/triage';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

describe('triage handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
    });

    it('registers /triage command and callbacks', () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerTriageHandler(bot, mockGetDB);
        const commands = bot.command.mock.calls.map((c: any) => c[0]);
        expect(commands).toContain('triage');
        // Should register menu callback, tri:cat regex, tri:skip regex
        expect(bot.callbackQuery.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('shows empty message when no uncategorized transactions', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // uncategorized
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerTriageHandler(bot, mockGetDB);

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'triage')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        expect(replyFn.mock.calls[0][0]).toContain('🎉');
    });

    it('shows first uncategorized transaction with category buttons', async () => {
        mockClient.query
            .mockResolvedValueOnce({
                rows: [{ id: 1, name: 'Coffee', price: -25, date: '2026-06-15', vendor: 'visaCal' }],
            })
            .mockResolvedValueOnce({
                rows: [{ category: 'אוכל' }, { category: 'תחבורה' }],
            });

        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerTriageHandler(bot, mockGetDB);

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'triage')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [text, opts] = replyFn.mock.calls[0];
        expect(text).toContain('Coffee');
        expect(opts.reply_markup).toBeDefined();
        expect(opts.parse_mode).toBe('MarkdownV2');
    });

    it('categorize callback updates DB and shows next', async () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerTriageHandler(bot, mockGetDB);

        // Find the tri:cat callback handler
        const catCallback = bot.callbackQuery.mock.calls.find(
            (c: any) => c[0] instanceof RegExp && c[0].source.includes('tri:cat')
        );
        expect(catCallback).toBeDefined();

        // Mock: UPDATE succeeds, then next fetch returns empty
        mockClient.query
            .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
            .mockResolvedValueOnce({ rows: [] }); // next fetch uncategorized

        const ctx = {
            match: ['tri:cat:42:אוכל', '42', 'אוכל'],
            answerCallbackQuery: vi.fn(),
            reply: vi.fn(),
            session: { conversation: { type: 'triage', step: 'active', data: { categorized: 2 } } },
        } as any;

        await catCallback[1](ctx);

        // Should have called UPDATE
        expect(mockClient.query).toHaveBeenCalledWith(
            'UPDATE transactions SET category = $1, category_source = $2 WHERE id = $3',
            ['אוכל', 'manual', '42']
        );
        expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: '✅ אוכל' });
        // Session count incremented
        expect(ctx.session.conversation.data.categorized).toBe(3);
    });

    it('skip callback shows next without updating DB', async () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerTriageHandler(bot, mockGetDB);

        const skipCallback = bot.callbackQuery.mock.calls.find(
            (c: any) => c[0] instanceof RegExp && c[0].source.includes('tri:skip')
        );
        expect(skipCallback).toBeDefined();

        mockClient.query.mockResolvedValueOnce({ rows: [] }); // fetch returns empty

        const ctx = {
            match: ['tri:skip:42', '42'],
            answerCallbackQuery: vi.fn(),
            reply: vi.fn(),
            session: { conversation: { type: 'triage', step: 'active', data: { categorized: 1 } } },
        } as any;

        await skipCallback[1](ctx);

        expect(ctx.answerCallbackQuery).toHaveBeenCalled();
        // Should NOT have called UPDATE — only the fetch query
        expect(mockClient.query).toHaveBeenCalledTimes(1);
        expect(ctx.reply).toHaveBeenCalled();
    });
});
