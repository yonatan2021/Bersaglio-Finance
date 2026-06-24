import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cached, bustCache, bustAllCache, cacheSize } from '../../utils/telegram-bot/cache';

describe('telegram-bot cache', () => {
    beforeEach(() => {
        bustAllCache();
    });

    it('caches the result of fn for the TTL duration', async () => {
        const fn = vi.fn().mockResolvedValue(42);
        const a = await cached('k', 60_000, fn);
        const b = await cached('k', 60_000, fn);
        expect(a).toBe(42);
        expect(b).toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after TTL expires', async () => {
        const fn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
        vi.useFakeTimers();
        await cached('k', 100, fn);
        vi.advanceTimersByTime(200);
        const val = await cached('k', 100, fn);
        expect(val).toBe(2);
        expect(fn).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('bustCache removes matching keys', async () => {
        await cached('budget:total', 60_000, async () => 1);
        await cached('budget:cats', 60_000, async () => 2);
        await cached('txn:recent', 60_000, async () => 3);
        expect(cacheSize()).toBe(3);
        bustCache('budget:');
        expect(cacheSize()).toBe(1);
    });

    it('bustAllCache clears everything', async () => {
        await cached('a', 60_000, async () => 1);
        await cached('b', 60_000, async () => 2);
        bustAllCache();
        expect(cacheSize()).toBe(0);
    });
});
