import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

vi.mock('../pages/api/utils/scraperUtils', () => ({
    stopAllScrapers: vi.fn()
}));

vi.mock('../pages/api/utils/encryption', () => ({
    decrypt: vi.fn(),
    encrypt: vi.fn(),
    VaultLockedError: class VaultLockedError extends Error {
        constructor(message?: string) {
            super(message);
            this.name = 'VaultLockedError';
        }
    }
}));

import { getDB } from '../pages/api/db';
import { stopAllScrapers } from '../pages/api/utils/scraperUtils';
import stopHandler from '../pages/api/scrapers/stop';
import lastTransactionDateHandler from '../pages/api/scrapers/last-transaction-date';
import statusHandler from '../pages/api/scrapers/status';

describe('Scraper Stop API (/api/scrapers/stop)', () => {
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockRes: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = { query: vi.fn(), release: vi.fn() };
        (getDB as any).mockResolvedValue(mockClient);
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should call stopAllScrapers and return success', async () => {
        (stopAllScrapers as any).mockResolvedValue(undefined);

        await stopHandler({ method: 'POST' } as any, mockRes as any);

        expect(stopAllScrapers).toHaveBeenCalledWith(mockClient);
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({
            success: true,
            message: 'All scrapers have been stopped and browser processes killed.'
        });
    });

    it('should return 405 for non-POST methods', async () => {
        await stopHandler({ method: 'GET' } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(405);
        expect(stopAllScrapers).not.toHaveBeenCalled();
    });

    it('should return 500 when stopAllScrapers fails', async () => {
        (stopAllScrapers as any).mockRejectedValue(new Error('Kill failed'));

        await stopHandler({ method: 'POST' } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
            success: false,
            message: 'Failed to stop scrapers.'
        });
    });

    it('should always release the client', async () => {
        (stopAllScrapers as any).mockRejectedValue(new Error('fail'));

        await stopHandler({ method: 'POST' } as any, mockRes as any);

        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
});

describe('Last Transaction Date API (/api/scrapers/last-transaction-date)', () => {
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockRes: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = { query: vi.fn(), release: vi.fn() };
        (getDB as any).mockResolvedValue(mockClient);
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };
    });

    it('should return the last transaction date for a vendor', async () => {
        mockClient.query.mockResolvedValue({
            rows: [{ lastDate: '2024-06-15' }]
        });

        await lastTransactionDateHandler({
            method: 'GET', query: { vendor: 'visaCal' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({ lastDate: '2024-06-15' });

        const [sql, params] = mockClient.query.mock.calls[0];
        expect(sql).toContain('MAX(date)');
        expect(params).toEqual(['visaCal']);
    });

    it('should return null when no transactions exist for vendor', async () => {
        mockClient.query.mockResolvedValue({
            rows: [{ lastDate: null }]
        });

        await lastTransactionDateHandler({
            method: 'GET', query: { vendor: 'max' }
        } as any, mockRes as any);

        expect(mockRes.json).toHaveBeenCalledWith({ lastDate: null });
    });

    it('should return 400 when vendor is missing', async () => {
        await lastTransactionDateHandler({
            method: 'GET', query: {}
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });
});

describe('Scraper Status API (/api/scrapers/status)', () => {
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockRes: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = { query: vi.fn(), release: vi.fn() };
        (getDB as any).mockResolvedValue(mockClient);
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return 405 for non-GET methods', async () => {
        await statusHandler({ method: 'POST' } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(405);
    });

    it('should return sync health as no_accounts when no active accounts', async () => {
        // Settings query
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        // Active accounts count
        mockClient.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
        // Latest scrape event
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        // Last synced per account
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        await statusHandler({
            method: 'GET', query: { minimal: 'true' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const data = mockRes.json.mock.calls[0][0];
        expect(data.syncHealth).toBe('no_accounts');
        expect(data.activeAccounts).toBe(0);
    });

    it('should return never_synced when accounts exist but no scrape history', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ id: 1, nickname: 'Card', vendor: 'visaCal', last_synced_at: null }] });

        await statusHandler({
            method: 'GET', query: { minimal: 'true' }
        } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data.syncHealth).toBe('never_synced');
        expect(data.activeAccounts).toBe(2);
    });

    it('should return healthy when last scrape was recent and successful', async () => {
        const now = new Date();
        const recentDate = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
        const recentDateStr = recentDate.toISOString();

        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
        mockClient.query.mockResolvedValueOnce({
            rows: [{
                id: 1, triggered_by: 'auto', vendor: 'visaCal',
                start_date: '2024-01-01', status: 'completed',
                message: 'OK', created_at: recentDateStr, duration_seconds: 30
            }]
        });
        mockClient.query.mockResolvedValueOnce({ rows: [{ id: 1, nickname: 'Card', vendor: 'visaCal', last_synced_at: recentDateStr }] });

        await statusHandler({
            method: 'GET', query: { minimal: 'true' }
        } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data.syncHealth).toBe('healthy');
    });

    it('should return error when last scrape failed', async () => {
        const now = new Date();
        const recentDate = new Date(now.getTime() - 60 * 60 * 1000);

        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
        mockClient.query.mockResolvedValueOnce({
            rows: [{
                id: 1, triggered_by: 'manual', vendor: 'max',
                start_date: '2024-01-01', status: 'failed',
                message: 'Login failed', created_at: recentDate.toISOString(), duration_seconds: 10
            }]
        });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        await statusHandler({
            method: 'GET', query: { minimal: 'true' }
        } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data.syncHealth).toBe('error');
    });

    it('should include history and accountSyncStatus in non-minimal response', async () => {
        const now = new Date();
        const recentDate = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
        mockClient.query.mockResolvedValueOnce({
            rows: [{ id: 1, status: 'completed', created_at: recentDate.toISOString() }]
        });
        mockClient.query.mockResolvedValueOnce({ rows: [{ id: 1, nickname: 'Card', vendor: 'visaCal', last_synced_at: recentDate.toISOString() }] });
        // History query (non-minimal)
        mockClient.query.mockResolvedValueOnce({
            rows: [{ id: 1, status: 'completed' }, { id: 2, status: 'failed' }]
        });

        await statusHandler({
            method: 'GET', query: {}
        } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data.history).toHaveLength(2);
        expect(data.accountSyncStatus).toHaveLength(1);
    });

    it('should return 500 on database error', async () => {
        mockClient.query.mockRejectedValue(new Error('DB error'));

        await statusHandler({
            method: 'GET', query: { minimal: 'true' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
});
