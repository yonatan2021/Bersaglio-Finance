import { loadMessagingSettings } from '../messaging/settings.js';
import { cached } from './cache';
import logger from '../logger.js';
import type { BotContext } from './types';

const AUTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getWhitelist(getDB: () => Promise<any>): Promise<Set<string>> {
    const list = await cached('auth:whitelist', AUTH_CACHE_TTL, async () => {
        const settings = await loadMessagingSettings({ getDB });
        const raw = settings.telegram_to || '';
        return raw.split(',').map((s: string) => s.trim()).filter(Boolean);
    });
    return new Set(list);
}

export function authMiddleware(getDB: () => Promise<any>) {
    return async (ctx: BotContext, next: () => Promise<void>) => {
        const chatId = String(ctx.chat?.id ?? '');
        if (!chatId) return;

        const whitelist = await getWhitelist(getDB);
        if (!whitelist.has(chatId)) {
            logger.warn(
                { chatId, whitelist: Array.from(whitelist), whitelistSize: whitelist.size },
                '[telegram-bot] Unauthorized access attempt — add chatId to telegram_to setting'
            );
            return;
        }
        await next();
    };
}
