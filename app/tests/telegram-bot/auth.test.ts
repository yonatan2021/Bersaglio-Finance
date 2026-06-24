import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authMiddleware } from '../../utils/telegram-bot/auth';
import { bustAllCache } from '../../utils/telegram-bot/cache';

vi.mock('../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../utils/messaging/settings.js', () => ({
    loadMessagingSettings: vi.fn(),
}));

import { loadMessagingSettings } from '../../utils/messaging/settings.js';

describe('authMiddleware', () => {
    const mockGetDB = vi.fn();
    let middleware: ReturnType<typeof authMiddleware>;

    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
        (loadMessagingSettings as any).mockResolvedValue({
            telegram_to: '12345, 67890',
            telegram_enabled: true,
            telegram_bot_token: 'tok',
            telegram_notify_on_restart: false,
            whatsapp_enabled: false,
            whatsapp_to: '',
            whatsapp_notify_on_restart: false,
        });
        middleware = authMiddleware(mockGetDB);
    });

    it('calls next() for whitelisted chat IDs', async () => {
        const next = vi.fn();
        const ctx = { chat: { id: 12345 } } as any;
        await middleware(ctx, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('silently drops non-whitelisted chat IDs', async () => {
        const next = vi.fn();
        const ctx = { chat: { id: 99999 } } as any;
        await middleware(ctx, next);
        expect(next).not.toHaveBeenCalled();
    });

    it('handles missing chat gracefully', async () => {
        const next = vi.fn();
        const ctx = { chat: undefined } as any;
        await middleware(ctx, next);
        expect(next).not.toHaveBeenCalled();
    });
});
