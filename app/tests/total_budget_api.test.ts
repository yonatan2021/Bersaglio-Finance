import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDB } from '../pages/api/db';
import handler from '../pages/api/reports/total-budget';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

describe('Total Budget API', () => {
    let mockClient: any;
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };

        (getDB as any).mockResolvedValue(mockClient);

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };

        mockReq = {
            method: 'GET',
            query: {},
            body: {}
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('GET', () => {
        it('should return is_set=false when no budget exists', async () => {
            mockClient.query
                .mockResolvedValueOnce({}) // ensure table
                .mockResolvedValueOnce({ rows: [] }); // no budget

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                budget_limit: null,
                is_set: false
            });
        });

        it('should return budget when set', async () => {
            const budgetRow = { id: 1, budget_limit: 5000, created_at: '2023-01-01', updated_at: '2023-01-01' };
            mockClient.query
                .mockResolvedValueOnce({}) // ensure table
                .mockResolvedValueOnce({ rows: [budgetRow] });

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                ...budgetRow,
                is_set: true
            });
        });
    });

    describe('POST', () => {
        it('should create budget with valid limit', async () => {
            mockReq.method = 'POST';
            mockReq.body = { budget_limit: 5000 };

            const resultRow = { id: 1, budget_limit: 5000, created_at: '2023-01-01', updated_at: '2023-01-01' };
            mockClient.query
                .mockResolvedValueOnce({}) // ensure table
                .mockResolvedValueOnce({ rows: [resultRow] }); // upsert

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                ...resultRow,
                is_set: true
            });
        });

        it('should return 400 when budget_limit missing', async () => {
            mockReq.method = 'POST';
            mockReq.body = {};

            mockClient.query.mockResolvedValueOnce({}); // ensure table

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining("budget_limit")
            }));
        });

        it('should return 400 when budget_limit is zero or negative', async () => {
            mockReq.method = 'POST';
            mockReq.body = { budget_limit: 0 };

            mockClient.query.mockResolvedValueOnce({}); // ensure table

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining("greater than 0")
            }));
        });
    });

    describe('DELETE', () => {
        it('should delete existing budget', async () => {
            mockReq.method = 'DELETE';

            mockClient.query
                .mockResolvedValueOnce({}) // ensure table
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // delete returning

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                is_set: false
            }));
        });

        it('should return 404 when no budget to delete', async () => {
            mockReq.method = 'DELETE';

            mockClient.query
                .mockResolvedValueOnce({}) // ensure table
                .mockResolvedValueOnce({ rows: [] }); // nothing to delete

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
        });
    });

    describe('error handling', () => {
        it('should return 405 for unsupported methods', async () => {
            mockReq.method = 'PATCH';

            mockClient.query.mockResolvedValueOnce({}); // ensure table

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(405);
        });

        it('should return 500 on database error', async () => {
            mockClient.query.mockRejectedValue(new Error('DB Error'));

            await handler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
        });

        it('should always release client', async () => {
            mockClient.query.mockRejectedValue(new Error('DB Error'));

            await handler(mockReq, mockRes);

            expect(mockClient.release).toHaveBeenCalled();
        });
    });
});
