import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSummaryHandler } from '../../../utils/telegram-bot/handlers/summary';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../utils/summary.js', () => ({
    generateDailySummary: vi.fn().mockResolvedValue('Test summary content'),
}));

describe('summary handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('registers /summary command and menu callback', () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerSummaryHandler(bot);
        const commands = bot.command.mock.calls.map((c: any) => c[0]);
        expect(commands).toContain('summary');
        const callbacks = bot.callbackQuery.mock.calls.map((c: any) => c[0]);
        expect(callbacks).toContain('menu:summary');
    });

    it('sends loading then summary', async () => {
        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerSummaryHandler(bot);

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'summary')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(2);
        // First call: loading message with MarkdownV2
        expect(replyFn.mock.calls[0][1]).toEqual({ parse_mode: 'MarkdownV2' });
        // Second call: summary content (plain text, no parse_mode)
        expect(replyFn.mock.calls[1][0]).toBe('Test summary content');
    });

    it('sends error message on failure', async () => {
        const { generateDailySummary } = await import('../../../utils/summary.js');
        (generateDailySummary as any).mockRejectedValueOnce(new Error('API down'));

        const bot = { command: vi.fn(), callbackQuery: vi.fn() } as any;
        registerSummaryHandler(bot);

        const replyFn = vi.fn();
        const ctx = { reply: replyFn } as any;
        const handler = bot.command.mock.calls.find((c: any) => c[0] === 'summary')[1];
        await handler(ctx);

        expect(replyFn).toHaveBeenCalledTimes(2);
        // Second call should be the error message
        expect(replyFn.mock.calls[1][1]).toEqual({ parse_mode: 'MarkdownV2' });
    });
});
