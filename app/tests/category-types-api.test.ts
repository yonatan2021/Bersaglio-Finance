import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

import { getDB } from '../pages/api/db';
import typesHandler from '../pages/api/categories/types';
import categoriesHandler from '../pages/api/categories/index';

describe('Category Types API (/api/categories/types)', () => {
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

    describe('GET', () => {
        it('should return categories with types and counts', async () => {
            mockClient.query.mockResolvedValue({
                rows: [
                    { category: 'Food', type: 'expense', count: '50' },
                    { category: 'Salary', type: 'income', count: '12' },
                    { category: 'Transfer Out', type: 'transfer', count: '0' }
                ]
            });

            await typesHandler({ method: 'GET' } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith([
                { category: 'Food', type: 'expense', count: 50 },
                { category: 'Salary', type: 'income', count: 12 },
                { category: 'Transfer Out', type: 'transfer', count: 0 }
            ]);
            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });

        it('should return empty array when no category types exist', async () => {
            mockClient.query.mockResolvedValue({ rows: [] });

            await typesHandler({ method: 'GET' } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith([]);
        });
    });

    describe('PATCH', () => {
        it('should update a single category type', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ category: 'Food', type: 'expense' }] }) // UPSERT
                .mockResolvedValueOnce(undefined); // COMMIT

            await typesHandler({
                method: 'PATCH',
                body: { categories: [{ category: 'Food', type: 'expense' }] }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const response = mockRes.json.mock.calls[0][0];
            expect(response.success).toBe(true);
            expect(response.updated).toEqual([{ category: 'Food', type: 'expense' }]);

            // Verify the SQL uses ON CONFLICT for upsert
            const upsertCall = mockClient.query.mock.calls[1];
            expect(upsertCall[0]).toContain('ON CONFLICT');
            expect(upsertCall[1]).toEqual(['Food', 'expense']);
        });

        it('should upsert a new category that does not yet exist', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ category: 'NewCat', type: 'income' }] }) // UPSERT
                .mockResolvedValueOnce(undefined); // COMMIT

            await typesHandler({
                method: 'PATCH',
                body: { categories: [{ category: 'NewCat', type: 'income' }] }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const response = mockRes.json.mock.calls[0][0];
            expect(response.success).toBe(true);
            expect(response.updated).toEqual([{ category: 'NewCat', type: 'income' }]);
        });

        it('should handle multiple categories in a single PATCH', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rows: [{ category: 'Food', type: 'expense' }] })
                .mockResolvedValueOnce({ rows: [{ category: 'Salary', type: 'income' }] })
                .mockResolvedValueOnce(undefined); // COMMIT

            await typesHandler({
                method: 'PATCH',
                body: {
                    categories: [
                        { category: 'Food', type: 'expense' },
                        { category: 'Salary', type: 'income' }
                    ]
                }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const response = mockRes.json.mock.calls[0][0];
            expect(response.updated).toHaveLength(2);
        });

        it('should reject invalid type value', async () => {
            await typesHandler({
                method: 'PATCH',
                body: { categories: [{ category: 'Food', type: 'invalid' }] }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            const response = mockRes.json.mock.calls[0][0];
            expect(response.error).toContain('Invalid type');
            expect(response.error).toContain('invalid');
        });

        it('should reject empty categories array', async () => {
            await typesHandler({
                method: 'PATCH',
                body: { categories: [] }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should reject missing categories field', async () => {
            await typesHandler({
                method: 'PATCH',
                body: {}
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should reject category with empty name', async () => {
            await typesHandler({
                method: 'PATCH',
                body: { categories: [{ category: '  ', type: 'expense' }] }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should rollback and return 500 on database error', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined) // BEGIN
                .mockRejectedValueOnce(new Error('DB error')) // UPSERT fails
                .mockResolvedValueOnce(undefined); // ROLLBACK

            await typesHandler({
                method: 'PATCH',
                body: { categories: [{ category: 'Food', type: 'expense' }] }
            } as any, mockRes as any);

            const rollbackCall = mockClient.query.mock.calls.find(
                (call: any[]) => call[0] === 'ROLLBACK'
            );
            expect(rollbackCall).toBeTruthy();
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });
    });

    describe('Method validation', () => {
        it('should return 405 for unsupported methods', async () => {
            await typesHandler({
                method: 'DELETE'
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(405);
        });
    });
});

describe('Categories index with type field (/api/categories)', () => {
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

    it('should return type field when withCounts=true', async () => {
        mockClient.query.mockResolvedValue({
            rows: [
                { name: 'Food', count: '50', type: 'expense' },
                { name: 'Salary', count: '12', type: 'income' },
                { name: 'Other', count: '5', type: null }
            ]
        });

        await categoriesHandler({ method: 'GET', query: { withCounts: 'true' } } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith([
            { name: 'Food', count: 50, type: 'expense' },
            { name: 'Salary', count: 12, type: 'income' },
            { name: 'Other', count: 5, type: null }
        ]);
    });

    it('should return just names without withCounts (backward compatible)', async () => {
        mockClient.query.mockResolvedValue({
            rows: [
                { name: 'Food', count: '50', type: 'expense' },
                { name: 'Transport', count: '30', type: null }
            ]
        });

        await categoriesHandler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(['Food', 'Transport']);
    });
});
