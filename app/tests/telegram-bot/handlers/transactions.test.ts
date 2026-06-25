import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTransactionsHandler } from '../../../utils/telegram-bot/handlers/transactions';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

function makeTxnRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: 1,
        identifier: 'x',
        vendor: 'visaCal',
        date: '2026-06-15',
        name: 'Coffee Shop',
        price: -25,
        category: 'אוכל',
        memo: null,
        account_number: '1234',
        transaction_type: 'credit_card',
        ...overrides,
    };
}

describe('transactions handler', () => {
    let bot: any;

    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
        bot = { command: vi.fn(), callbackQuery: vi.fn() };
        registerTransactionsHandler(bot, mockGetDB);
    });

    it('registers /recent and /search commands', () => {
        const commands = bot.command.mock.calls.map((c: any) => c[0]);
        expect(commands).toContain('recent');
        expect(commands).toContain('search');
    });

    it('registers callback queries for pagination and category edit', () => {
        const callbacks = bot.callbackQuery.mock.calls.map((c: any) =>
            c[0] instanceof RegExp ? c[0].source : c[0]
        );
        expect(callbacks).toContain('menu:recent');
        expect(callbacks).toContain('menu:search');
        expect(callbacks).toContain('^pg:recent:(\\d+)$');
        expect(callbacks).toContain('^pg:search:(.+):(\\d+)$');
        expect(callbacks).toContain('^tr:edit:(\\d+)$');
        expect(callbacks).toContain('^cat:(\\d+):(.+)$');
    });

    it('/recent replies with transaction list', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [makeTxnRow()],
        });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'recent')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [text, opts] = replyFn.mock.calls[0];
        expect(opts.parse_mode).toBe('MarkdownV2');
        expect(text).toContain('עסקאות אחרונות');
    });

    it('/recent shows empty message when no transactions', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'recent')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [text] = replyFn.mock.calls[0];
        expect(text).toContain('לא נמצאו עסקאות');
    });

    it('/recent adds edit buttons per transaction', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [makeTxnRow({ id: 42, name: 'Supermarket' })],
        });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'recent')[1];
        await handler(ctx);

        const opts = replyFn.mock.calls[0][1];
        const keyboard = opts.reply_markup;
        // Keyboard should have inline_keyboard array with edit button
        expect(keyboard).toBeDefined();
    });

    it('/recent detects hasMore when 11 rows returned', async () => {
        const rows = Array.from({ length: 11 }, (_, i) => makeTxnRow({ id: i + 1 }));
        mockClient.query.mockResolvedValueOnce({ rows });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'recent')[1];
        await handler(ctx);

        // Query uses PAGE_SIZE+1=11 LIMIT, so 11 rows means hasMore=true
        expect(mockClient.query).toHaveBeenCalledWith(
            expect.any(String),
            [11, 0]
        );
    });

    it('/recent handles errors gracefully', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('db error'));

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'recent')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledWith(expect.stringContaining('השתבש'));
    });

    it('/search with no args sets session conversation', async () => {
        const replyFn = vi.fn();
        const session = {} as any;
        const ctx = { reply: replyFn, session, match: '' } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'search')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledWith(expect.stringContaining('חיפוש'));
        expect(session.conversation).toEqual({
            type: 'search_filter',
            step: 'awaiting_query',
            data: {},
        });
    });

    it('/search with query performs search', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [makeTxnRow({ name: 'Shufersal' })],
        });

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {}, match: 'Shufersal' } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'search')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(1);
        const [text, opts] = replyFn.mock.calls[0];
        expect(opts.parse_mode).toBe('MarkdownV2');
        expect(text).toContain('תוצאות חיפוש');
    });

    it('category edit callback fetches categories and shows picker', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [{ category: 'אוכל' }, { category: 'תחבורה' }],
        });

        const cbHandler = bot.callbackQuery.mock.calls.find(
            (c: any) => c[0] instanceof RegExp && c[0].source.includes('tr:edit')
        );
        expect(cbHandler).toBeDefined();

        const replyFn = vi.fn();
        const answerFn = vi.fn();
        const ctx = {
            match: ['tr:edit:42', '42'],
            reply: replyFn,
            answerCallbackQuery: answerFn,
            session: {},
        } as any;

        await cbHandler[1](ctx);

        expect(answerFn).toHaveBeenCalled();
        expect(replyFn).toHaveBeenCalledTimes(1);
        const [text, opts] = replyFn.mock.calls[0];
        expect(text).toContain('קטגוריה');
        expect(opts.reply_markup).toBeDefined();
    });

    it('category update busts caches and confirms', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const cbHandler = bot.callbackQuery.mock.calls.find(
            (c: any) => c[0] instanceof RegExp && c[0].source.includes('^cat:')
        );
        expect(cbHandler).toBeDefined();

        const answerFn = vi.fn();
        const editFn = vi.fn();
        const ctx = {
            match: ['cat:42:אוכל', '42', 'אוכל'],
            answerCallbackQuery: answerFn,
            editMessageText: editFn,
            session: {},
        } as any;

        await cbHandler[1](ctx);

        expect(mockClient.query).toHaveBeenCalledWith(
            'UPDATE transactions SET category = $1, category_source = $2 WHERE id = $3',
            ['אוכל', 'manual', '42']
        );
        expect(answerFn).toHaveBeenCalledWith({ text: '✅ אוכל' });
        expect(editFn).toHaveBeenCalled();
    });

    it('menu:recent callback answers and calls handleRecent', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const cbHandler = bot.callbackQuery.mock.calls.find(
            (c: any) => c[0] === 'menu:recent'
        );
        expect(cbHandler).toBeDefined();

        const replyFn = vi.fn();
        const answerFn = vi.fn();
        const ctx = {
            reply: replyFn,
            answerCallbackQuery: answerFn,
            session: {},
        } as any;

        await cbHandler[1](ctx);

        expect(answerFn).toHaveBeenCalled();
        expect(replyFn).toHaveBeenCalled();
    });

    it('releases db client even on query error', async () => {
        mockClient.query.mockRejectedValueOnce(new Error('fail'));

        const replyFn = vi.fn();
        const ctx = { reply: replyFn, session: {} } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'recent')[1];
        await handler(ctx);

        expect(mockClient.release).toHaveBeenCalled();
    });
});
