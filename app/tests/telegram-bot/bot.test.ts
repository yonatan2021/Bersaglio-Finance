import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBot } from '../../utils/telegram-bot/bot';
import { bustAllCache } from '../../utils/telegram-bot/cache';

vi.mock('../../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../utils/messaging/settings.js', () => ({
    loadMessagingSettings: vi.fn().mockResolvedValue({
        telegram_to: '12345',
        telegram_enabled: true,
        telegram_bot_token: 'TEST_TOKEN',
        telegram_notify_on_restart: false,
        whatsapp_enabled: false,
        whatsapp_to: '',
        whatsapp_notify_on_restart: false,
    }),
}));

describe('createBot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        bustAllCache();
    });

    it('creates a Bot instance without throwing', () => {
        const mockGetDB = vi.fn();
        const bot = createBot('TEST_TOKEN', mockGetDB);
        expect(bot).toBeDefined();
        expect(typeof bot.start).toBe('function');
        expect(typeof bot.stop).toBe('function');
    });
});
