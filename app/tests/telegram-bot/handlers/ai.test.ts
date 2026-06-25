import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAIFallback } from '../../../utils/telegram-bot/handlers/ai';
import { bustAllCache } from '../../../utils/telegram-bot/cache';

vi.mock('../../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../utils/aiClient.js', () => ({
    generateText: vi.fn().mockResolvedValue({ text: 'AI response here', finishReason: 'stop', model: 'test' }),
    mapAIError: vi.fn().mockReturnValue('AI error message'),
    getAIConfig: vi.fn().mockResolvedValue({ baseURL: 'test', apiKey: 'test', model: 'test', extraHeaders: {} }),
}));

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

const mockGetDB = vi.fn().mockResolvedValue(mockClient);

describe('AI fallback handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();

        mockClient.query.mockResolvedValue({ rows: [{ budget_limit: 10000, total: 5000, category: 'אוכל' }] });
    });

    it('sends thinking indicator then AI response', async () => {
        const replyFn = vi.fn();
        const ctx = {
            message: { text: 'כמה הוצאתי על אוכל?' },
            reply: replyFn,
        } as any;

        await handleAIFallback(ctx, mockGetDB);

        expect(replyFn).toHaveBeenCalledTimes(2);
        expect(replyFn.mock.calls[0][0]).toContain('חושב');
        expect(replyFn.mock.calls[1][0]).toBe('AI response here');
    });

    it('sends fallback error on AI failure', async () => {
        const { generateText } = await import('../../../utils/aiClient.js');
        (generateText as any).mockRejectedValueOnce(new Error('API error'));

        const replyFn = vi.fn();
        const ctx = {
            message: { text: 'test' },
            reply: replyFn,
        } as any;

        await handleAIFallback(ctx, mockGetDB);

        expect(replyFn).toHaveBeenCalledTimes(2);
        // First call is thinking, second is error
        expect(replyFn.mock.calls[1][0]).toContain('לא הצלחתי');
    });

    it('does nothing for empty text', async () => {
        const replyFn = vi.fn();
        const ctx = {
            message: { text: '   ' },
            reply: replyFn,
        } as any;

        await handleAIFallback(ctx, mockGetDB);

        expect(replyFn).not.toHaveBeenCalled();
    });

    it('does nothing when message is undefined', async () => {
        const replyFn = vi.fn();
        const ctx = {
            message: undefined,
            reply: replyFn,
        } as any;

        await handleAIFallback(ctx, mockGetDB);

        expect(replyFn).not.toHaveBeenCalled();
    });

    it('builds financial context from DB and passes to AI', async () => {
        const { generateText } = await import('../../../utils/aiClient.js');
        const replyFn = vi.fn();
        const ctx = {
            message: { text: 'מה המצב שלי?' },
            reply: replyFn,
        } as any;

        await handleAIFallback(ctx, mockGetDB);

        expect(mockGetDB).toHaveBeenCalled();
        expect(mockClient.query).toHaveBeenCalled();
        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'מה המצב שלי?',
                temperature: 0.7,
                maxTokens: 2000,
            })
        );
    });

    it('releases DB client even on query failure', async () => {
        // Bust cache so buildFinancialContext actually queries
        bustAllCache();
        mockClient.query.mockRejectedValueOnce(new Error('DB error'));

        const replyFn = vi.fn();
        const ctx = {
            message: { text: 'test' },
            reply: replyFn,
        } as any;

        await handleAIFallback(ctx, mockGetDB);

        expect(mockClient.release).toHaveBeenCalled();
        // Should still send error message
        expect(replyFn).toHaveBeenCalledTimes(2);
        expect(replyFn.mock.calls[1][0]).toContain('לא הצלחתי');
    });
});
