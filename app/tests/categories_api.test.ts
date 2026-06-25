import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

import { getDB } from '../pages/api/db';
import categoriesHandler from '../pages/api/categories/index';
import categoryByNameHandler from '../pages/api/categories/[name]';
import mergeHandler from '../pages/api/categories/merge';
import uncategorizedHandler from '../pages/api/categories/uncategorized';
import rulesHandler from '../pages/api/categories/rules/index';
import mappingsHandler from '../pages/api/categories/mappings/index';

describe('Categories List API (/api/categories)', () => {
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

    it('should return category names sorted by count', async () => {
        mockClient.query.mockResolvedValue({
            rows: [
                { name: 'Food', count: '50' },
                { name: 'Transport', count: '30' }
            ]
        });

        await categoriesHandler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(['Food', 'Transport']);
    });

    it('should return empty array when no categories exist', async () => {
        mockClient.query.mockResolvedValue({ rows: [] });

        await categoriesHandler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockRes.json).toHaveBeenCalledWith([]);
    });

    it('should return {name,count,type} objects when withCounts=true', async () => {
        mockClient.query.mockResolvedValue({
            rows: [
                { name: 'Food', count: '50', type: 'expense' },
                { name: 'Transport', count: '30', type: null }
            ]
        });

        await categoriesHandler({ method: 'GET', query: { withCounts: 'true' } } as any, mockRes as any);

        expect(mockRes.json).toHaveBeenCalledWith([
            { name: 'Food', count: 50, type: 'expense' },
            { name: 'Transport', count: 30, type: null }
        ]);
    });
});

describe('Category by Name API (/api/categories/[name])', () => {
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

    describe('PATCH (rename)', () => {
        it('should rename a category across transactions, rules, and budgets', async () => {
            mockClient.query.mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rowCount: 10 }) // UPDATE transactions
                .mockResolvedValueOnce({ rowCount: 2 })  // UPDATE rules
                .mockResolvedValueOnce({ rowCount: 1 })  // UPDATE budgets
                .mockResolvedValueOnce(undefined);        // COMMIT

            await categoryByNameHandler({
                method: 'PATCH',
                query: { name: 'Food' },
                body: { newName: 'Groceries' }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const response = mockRes.json.mock.calls[0][0];
            expect(response.success).toBe(true);
            expect(response.transactionsUpdated).toBe(10);
            expect(response.rulesUpdated).toBe(2);
            expect(response.budgetsUpdated).toBe(1);
        });

        it('should return 400 when newName is missing', async () => {
            await categoryByNameHandler({
                method: 'PATCH',
                query: { name: 'Food' },
                body: {}
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should return 400 when newName is empty string', async () => {
            await categoryByNameHandler({
                method: 'PATCH',
                query: { name: 'Food' },
                body: { newName: '   ' }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });
    });

    describe('DELETE', () => {
        it('should uncategorize transactions and delete rules and budget by default', async () => {
            mockClient.query.mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rowCount: 5 })  // UPDATE transactions
                .mockResolvedValueOnce({ rowCount: 1 })  // DELETE rules
                .mockResolvedValueOnce({ rowCount: 1 })  // DELETE budget
                .mockResolvedValueOnce(undefined);        // COMMIT

            await categoryByNameHandler({
                method: 'DELETE',
                query: { name: 'Food' },
                body: {}
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const response = mockRes.json.mock.calls[0][0];
            expect(response.success).toBe(true);
            expect(response.transactionsUncategorized).toBe(5);
            expect(response.rulesDeleted).toBe(1);
            expect(response.budgetDeleted).toBe(1);
        });

        it('should skip rule/budget deletion when flags are false', async () => {
            mockClient.query.mockResolvedValueOnce(undefined) // BEGIN
                .mockResolvedValueOnce({ rowCount: 3 })  // UPDATE transactions
                .mockResolvedValueOnce(undefined);        // COMMIT

            await categoryByNameHandler({
                method: 'DELETE',
                query: { name: 'Food' },
                body: { deleteRules: false, deleteBudget: false }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            // Only 3 query calls: BEGIN, UPDATE, COMMIT (no DELETE for rules or budget)
            expect(mockClient.query).toHaveBeenCalledTimes(3);
        });
    });

    describe('Validation', () => {
        it('should return 400 when category name is missing', async () => {
            await categoryByNameHandler({
                method: 'PATCH',
                query: {},
                body: { newName: 'Test' }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        it('should return 405 for unsupported methods', async () => {
            await categoryByNameHandler({
                method: 'GET',
                query: { name: 'Food' }
            } as any, mockRes as any);

            expect(mockRes.status).toHaveBeenCalledWith(405);
        });
    });

    describe('Error handling', () => {
        it('should rollback and return 500 on error', async () => {
            mockClient.query.mockResolvedValueOnce(undefined) // BEGIN
                .mockRejectedValueOnce(new Error('DB error')); // UPDATE fails

            await categoryByNameHandler({
                method: 'PATCH',
                query: { name: 'Food' },
                body: { newName: 'Groceries' }
            } as any, mockRes as any);

            // Should call ROLLBACK
            const rollbackCall = mockClient.query.mock.calls.find(
                (call: any[]) => call[0] === 'ROLLBACK'
            );
            expect(rollbackCall).toBeTruthy();
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockClient.release).toHaveBeenCalledTimes(1);
        });
    });
});

describe('Categories Merge API (/api/categories/merge)', () => {
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

    it('should merge source categories into a new name', async () => {
        mockClient.query.mockResolvedValueOnce(undefined) // BEGIN
            .mockResolvedValueOnce({ rowCount: 15 }) // UPDATE transactions
            .mockResolvedValueOnce({ rowCount: 2 })  // UPDATE rules
            .mockResolvedValueOnce({ rows: [] })      // INSERT mapping 1
            .mockResolvedValueOnce({ rows: [] })      // INSERT mapping 2
            .mockResolvedValueOnce(undefined);         // COMMIT

        await mergeHandler({
            method: 'POST',
            body: {
                sourceCategories: ['Food', 'Restaurants', 'Snacks'],
                newCategoryName: 'All Food'
            }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const response = mockRes.json.mock.calls[0][0];
        expect(response.success).toBe(true);
        expect(response.updatedRows).toBe(15);
    });

    it('should return 400 when fewer than 2 source categories', async () => {
        await mergeHandler({
            method: 'POST',
            body: { sourceCategories: ['Food'], newCategoryName: 'Test' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when newCategoryName is empty', async () => {
        await mergeHandler({
            method: 'POST',
            body: { sourceCategories: ['A', 'B'], newCategoryName: '' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 405 for non-POST methods', async () => {
        await mergeHandler({ method: 'GET' } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(405);
    });

    it('should rollback on error', async () => {
        mockClient.query.mockResolvedValueOnce(undefined) // BEGIN
            .mockRejectedValueOnce(new Error('fail'));     // UPDATE fails

        await mergeHandler({
            method: 'POST',
            body: { sourceCategories: ['A', 'B'], newCategoryName: 'C' }
        } as any, mockRes as any);

        const rollbackCall = mockClient.query.mock.calls.find(
            (call: any[]) => call[0] === 'ROLLBACK'
        );
        expect(rollbackCall).toBeTruthy();
        expect(mockRes.status).toHaveBeenCalledWith(500);
    });
});

describe('Uncategorized API (/api/categories/uncategorized)', () => {
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

    it('should return uncategorized transaction descriptions with count and amount', async () => {
        mockClient.query.mockResolvedValue({
            rows: [
                { description: 'Unknown Store', count: '5', total_amount: '250.50' },
                { description: 'ATM Withdrawal', count: '2', total_amount: '1000' }
            ]
        });

        await uncategorizedHandler({ method: 'GET', query: {} } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const data = mockRes.json.mock.calls[0][0];
        expect(data).toEqual([
            { description: 'Unknown Store', count: 5, totalAmount: 250.50 },
            { description: 'ATM Withdrawal', count: 2, totalAmount: 1000 }
        ]);
    });

    it('should handle null total_amount', async () => {
        mockClient.query.mockResolvedValue({
            rows: [{ description: 'Test', count: '1', total_amount: null }]
        });

        await uncategorizedHandler({ method: 'GET', query: {} } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data[0].totalAmount).toBe(0);
    });
});

describe('Categorization Rules API (/api/categories/rules)', () => {
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

    it('should list all rules on GET', async () => {
        const rules = [
            { id: 1, name_pattern: 'Super', target_category: 'Groceries', is_active: true }
        ];
        mockClient.query.mockResolvedValue({ rows: rules });

        await rulesHandler({ method: 'GET', query: {}, body: {} } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(rules);
    });

    it('should create a rule on POST', async () => {
        const newRule = { id: 1, name_pattern: 'Uber', target_category: 'Transport' };
        mockClient.query.mockResolvedValue({ rows: [newRule] });

        await rulesHandler({
            method: 'POST',
            query: {},
            body: { name_pattern: 'Uber', target_category: 'Transport' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(newRule);
    });

    it('should return 400 when POST is missing name_pattern', async () => {
        await rulesHandler({
            method: 'POST',
            query: {},
            body: { target_category: 'Food' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when POST is missing target_category', async () => {
        await rulesHandler({
            method: 'POST',
            query: {},
            body: { name_pattern: 'Test' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should delete a rule on DELETE', async () => {
        mockClient.query.mockResolvedValue({ rows: [] });

        await rulesHandler({
            method: 'DELETE',
            query: {},
            body: { id: 1 }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 400 when DELETE is missing id', async () => {
        await rulesHandler({
            method: 'DELETE',
            query: {},
            body: {}
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });
});

describe('Category Mappings API (/api/categories/mappings)', () => {
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

    it('should list all mappings on GET', async () => {
        const mappings = [
            { id: 1, source_category: 'Food', target_category: 'Groceries' }
        ];
        mockClient.query.mockResolvedValue({ rows: mappings });

        await mappingsHandler({ method: 'GET', query: {}, body: {} } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(mappings);
    });

    it('should create a mapping with upsert on POST', async () => {
        const mapping = { id: 1, source_category: 'Restaurants', target_category: 'Food' };
        mockClient.query.mockResolvedValue({ rows: [mapping] });

        await mappingsHandler({
            method: 'POST',
            query: {},
            body: { source_category: 'Restaurants', target_category: 'Food' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(mapping);
        const [sql] = mockClient.query.mock.calls[0];
        expect(sql).toContain('ON CONFLICT');
    });

    it('should return 400 when POST is missing source_category', async () => {
        await mappingsHandler({
            method: 'POST',
            query: {},
            body: { target_category: 'Food' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should delete a mapping on DELETE', async () => {
        mockClient.query.mockResolvedValue({ rows: [] });

        await mappingsHandler({
            method: 'DELETE',
            query: {},
            body: { id: 1 }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 400 when DELETE is missing id', async () => {
        await mappingsHandler({
            method: 'DELETE',
            query: {},
            body: {}
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });
});
