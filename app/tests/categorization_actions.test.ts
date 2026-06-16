import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

import { getDB } from '../pages/api/db';
import applyRulesHandler from '../pages/api/categories/apply-rules';
import updateByDescriptionHandler from '../pages/api/categories/update-by-description';

describe('Apply Rules API (/api/categories/apply-rules)', () => {
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockOuterClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockRes: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        (getDB as any).mockReset();
        // apply-rules uses getDB twice: once in createApiHandler, once in transform
        mockOuterClient = { query: vi.fn(), release: vi.fn() };
        mockClient = { query: vi.fn(), release: vi.fn() };
        (getDB as any)
            .mockResolvedValueOnce(mockOuterClient)  // createApiHandler's getDB
            .mockResolvedValueOnce(mockClient);       // transform's getDB
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should apply all active rules and return counts', async () => {
        // Outer client: initial SELECT 1
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

        // Inner client: fetch rules
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { id: 1, name_pattern: 'סופר', target_category: 'Groceries' },
                { id: 2, name_pattern: 'Uber', target_category: 'Transport' }
            ]
        });
        // Apply rule 1: updated 5 transactions
        mockClient.query.mockResolvedValueOnce({ rowCount: 5 });
        // Apply rule 2: updated 3 transactions
        mockClient.query.mockResolvedValueOnce({ rowCount: 3 });

        await applyRulesHandler({
            method: 'POST', query: {}, body: {}
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const data = mockRes.json.mock.calls[0][0];
        expect(data.success).toBe(true);
        expect(data.rulesApplied).toBe(2);
        expect(data.transactionsUpdated).toBe(8);
    });

    it('should handle zero active rules', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        await applyRulesHandler({
            method: 'POST', query: {}, body: {}
        } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data.rulesApplied).toBe(0);
        expect(data.transactionsUpdated).toBe(0);
    });

    it('should return 400 for non-POST methods', async () => {
        await applyRulesHandler({
            method: 'GET', query: {}, body: {}
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should use LIKE pattern with wildcards', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });
        mockClient.query.mockResolvedValueOnce({
            rows: [{ id: 1, name_pattern: 'שופרסל', target_category: 'Groceries' }]
        });
        mockClient.query.mockResolvedValueOnce({ rowCount: 2 });

        await applyRulesHandler({
            method: 'POST', query: {}, body: {}
        } as any, mockRes as any);

        const updateCall = mockClient.query.mock.calls[1];
        const [sql, params] = updateCall;
        expect(params[0]).toBe('%שופרסל%');
        expect(sql).toContain('LOWER(name) LIKE LOWER($1)');
    });

    it('should not override Bank or Income categories', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });
        mockClient.query.mockResolvedValueOnce({
            rows: [{ id: 1, name_pattern: 'Test', target_category: 'Food' }]
        });
        mockClient.query.mockResolvedValueOnce({ rowCount: 0 });

        await applyRulesHandler({
            method: 'POST', query: {}, body: {}
        } as any, mockRes as any);

        const updateCall = mockClient.query.mock.calls[1];
        const [sql] = updateCall;
        expect(sql).toContain("category != 'Bank'");
        expect(sql).toContain("category != 'Income'");
    });

    it('should release the inner client even on error', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });
        mockClient.query.mockRejectedValue(new Error('DB error'));

        await applyRulesHandler({
            method: 'POST', query: {}, body: {}
        } as any, mockRes as any);

        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
});

describe('Update by Description API (/api/categories/update-by-description)', () => {
    let mockOuterClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockRes: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        (getDB as any).mockReset();
        mockOuterClient = { query: vi.fn(), release: vi.fn() };
        mockClient = { query: vi.fn(), release: vi.fn() };
        (getDB as any)
            .mockResolvedValueOnce(mockOuterClient)
            .mockResolvedValueOnce(mockClient);
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should update transactions and create a new rule', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

        // BEGIN
        mockClient.query.mockResolvedValueOnce(undefined);
        // UPDATE transactions
        mockClient.query.mockResolvedValueOnce({ rowCount: 7 });
        // Check existing rule - none found
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        // INSERT rule
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        // COMMIT
        mockClient.query.mockResolvedValueOnce(undefined);

        await updateByDescriptionHandler({
            method: 'POST', query: {},
            body: { description: 'Rami Levy', newCategory: 'Groceries' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const data = mockRes.json.mock.calls[0][0];
        expect(data.success).toBe(true);
        expect(data.transactionsUpdated).toBe(7);
        expect(data.ruleCreated).toBe(true);
        expect(data.ruleUpdated).toBe(false);
    });

    it('should update an existing rule instead of creating new one', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({ rowCount: 3 }); // UPDATE transactions
        mockClient.query.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // Existing rule found
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // UPDATE rule
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        await updateByDescriptionHandler({
            method: 'POST', query: {},
            body: { description: 'Uber', newCategory: 'Transport' }
        } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data.ruleCreated).toBe(false);
        expect(data.ruleUpdated).toBe(true);
    });

    it('should skip rule creation when createRule is false', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({ rowCount: 2 }); // UPDATE transactions
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        await updateByDescriptionHandler({
            method: 'POST', query: {},
            body: { description: 'ATM', newCategory: 'Cash', createRule: false }
        } as any, mockRes as any);

        const data = mockRes.json.mock.calls[0][0];
        expect(data.ruleCreated).toBe(false);
        expect(data.ruleUpdated).toBe(false);
        // Only 3 queries: BEGIN, UPDATE, COMMIT (no rule queries)
        expect(mockClient.query).toHaveBeenCalledTimes(3);
    });

    it('should return 400 when description is missing', async () => {
        await updateByDescriptionHandler({
            method: 'POST', query: {},
            body: { newCategory: 'Food' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when newCategory is missing', async () => {
        await updateByDescriptionHandler({
            method: 'POST', query: {},
            body: { description: 'Store' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for non-POST methods', async () => {
        await updateByDescriptionHandler({
            method: 'GET', query: {},
            body: { description: 'Store', newCategory: 'Food' }
        } as any, mockRes as any);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should rollback on error and release client', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockRejectedValueOnce(new Error('DB error')); // UPDATE fails

        await updateByDescriptionHandler({
            method: 'POST', query: {},
            body: { description: 'Store', newCategory: 'Food' }
        } as any, mockRes as any);

        // Should rollback
        const rollbackCall = mockClient.query.mock.calls.find(
            (call: any[]) => call[0] === 'ROLLBACK'
        );
        expect(rollbackCall).toBeTruthy();
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should use case-insensitive matching for descriptions', async () => {
        mockOuterClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // No existing rule
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // INSERT rule
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        await updateByDescriptionHandler({
            method: 'POST', query: {},
            body: { description: 'Test Store', newCategory: 'Shopping' }
        } as any, mockRes as any);

        const updateCall = mockClient.query.mock.calls[1];
        const [sql] = updateCall;
        expect(sql).toContain('LOWER(TRIM(name))');
    });
});
