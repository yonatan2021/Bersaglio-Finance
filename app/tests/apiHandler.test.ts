import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

import { getDB } from '../pages/api/db';
import { createApiHandler } from '../utils/apiHandler';

describe('createApiHandler', () => {
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

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return 200 with query results on success', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'SELECT * FROM test', params: [] }),
        });

        mockClient.query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });

        await handler({ method: 'POST', query: {} } as any, mockRes as any);

        expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM test', []);
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);
    });

    it('should apply transform function when provided', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'SELECT name FROM test' }),
            transform: (result) => result.rows.map((r: any) => r.name)
        });

        mockClient.query.mockResolvedValue({ rows: [{ name: 'a' }, { name: 'b' }] });

        await handler({ method: 'POST', query: {} } as any, mockRes as any);

        expect(mockRes.json).toHaveBeenCalledWith(['a', 'b']);
    });

    it('should return 400 when validation fails', async () => {
        const handler = createApiHandler({
            validate: (req) => {
                if (!req.query.id) return 'id is required';
            },
            query: async () => ({ sql: 'SELECT 1' }),
        });

        await handler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'id is required' });
        expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('should proceed when validation passes', async () => {
        const handler = createApiHandler({
            validate: (req) => {
                if (!req.query.id) return 'id is required';
            },
            query: async () => ({ sql: 'SELECT 1' }),
        });

        mockClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

        await handler({ method: 'GET', query: { id: '123' } } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 500 and log on database error', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'INVALID SQL' }),
        });

        mockClient.query.mockRejectedValue(new Error('syntax error'));

        await handler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });

    it('should always release the client, even on error', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'SELECT 1' }),
        });

        mockClient.query.mockRejectedValue(new Error('fail'));

        await handler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should release the client on success', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'SELECT 1' }),
        });

        mockClient.query.mockResolvedValue({ rows: [] });

        await handler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should set Cache-Control header for GET requests', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'SELECT 1' }),
        });

        mockClient.query.mockResolvedValue({ rows: [] });

        await handler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockRes.setHeader).toHaveBeenCalledWith(
            'Cache-Control',
            'private, max-age=30, stale-while-revalidate=60'
        );
    });

    it('should not set Cache-Control header for POST requests', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'INSERT INTO test VALUES (1)' }),
        });

        mockClient.query.mockResolvedValue({ rows: [] });

        await handler({ method: 'POST', query: {} } as any, mockRes as any);

        expect(mockRes.setHeader).not.toHaveBeenCalled();
    });

    it('should default params to empty array when not provided', async () => {
        const handler = createApiHandler({
            query: async () => ({ sql: 'SELECT 1' }),
        });

        mockClient.query.mockResolvedValue({ rows: [] });

        await handler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockClient.query).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('should pass req to transform function', async () => {
        const transformFn = vi.fn((result, req) => ({ method: req.method, count: result.rows.length }));
        const handler = createApiHandler({
            query: async () => ({ sql: 'SELECT 1' }),
            transform: transformFn
        });

        mockClient.query.mockResolvedValue({ rows: [{ id: 1 }] });

        await handler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(transformFn).toHaveBeenCalledWith(
            { rows: [{ id: 1 }] },
            expect.objectContaining({ method: 'GET' })
        );
        expect(mockRes.json).toHaveBeenCalledWith({ method: 'GET', count: 1 });
    });
});
