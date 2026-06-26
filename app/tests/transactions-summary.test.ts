import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

vi.mock('../pages/api/utils/encryption', () => ({
    decrypt: vi.fn(),
    encrypt: vi.fn(),
    safeDecrypt: vi.fn((val: string) => val),
    VaultLockedError: class VaultLockedError extends Error {
        constructor() { super('Vault is locked'); this.name = 'VaultLockedError'; }
    }
}));

import { getDB } from '../pages/api/db';
import handler from '../pages/api/transactions/index';

describe('Transactions API - Server-side Summary', () => {
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockRes: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = { query: vi.fn(), release: vi.fn() };
        (getDB as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('should return summary alongside transactions', async () => {
        const summaryRow = {
            total_count: '5', total_expenses: '1500.50', total_income: '3000.00',
            credit_total: '800.00', debit_total: '200.50', direct_total: '500.00'
        };
        const txRows = [
            { identifier: 'tx1', vendor: 'visaCal', price: -100, category_type: 'expense', card6_digits_encrypted: null }
        ];

        mockClient.query
            .mockResolvedValueOnce({ rows: [summaryRow] })
            .mockResolvedValueOnce({ rows: txRows });

        await handler({ method: 'GET', query: { startDate: '2024-01-01', endDate: '2024-01-31' } }, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const response = mockRes.json.mock.calls[0][0];

        expect(response).toHaveProperty('transactions');
        expect(response).toHaveProperty('summary');
        expect(response.transactions).toHaveLength(1);

        expect(response.summary).toEqual({
            totalCount: 5,
            totalExpenses: 1500.50,
            totalIncome: 3000.00,
            creditCardTotal: 800.00,
            debitTotal: 200.50,
            directTotal: 500.00,
        });
    });

    it('should compute summary independent of pagination (LIMIT/OFFSET)', async () => {
        const summaryRow = {
            total_count: '100', total_expenses: '50000.00', total_income: '0',
            credit_total: '30000.00', debit_total: '5000.00', direct_total: '15000.00'
        };

        mockClient.query
            .mockResolvedValueOnce({ rows: [summaryRow] })
            .mockResolvedValueOnce({ rows: [{ identifier: 'tx1', vendor: 'v', price: -50, card6_digits_encrypted: null }] });

        await handler({
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31', limit: '10', offset: '0' }
        }, mockRes);

        const response = mockRes.json.mock.calls[0][0];

        // Summary reflects all 100 transactions, not just the 1 returned in current page
        expect(response.summary.totalCount).toBe(100);
        expect(response.summary.totalExpenses).toBe(50000);
        expect(response.transactions).toHaveLength(1);

        // Verify summary query does NOT have LIMIT/OFFSET
        const summarySql = mockClient.query.mock.calls[0][0];
        expect(summarySql).not.toContain('LIMIT');
        expect(summarySql).not.toContain('OFFSET');

        // Main query DOES have LIMIT/OFFSET
        const mainSql = mockClient.query.mock.calls[1][0];
        expect(mainSql).toContain('LIMIT');
        expect(mainSql).toContain('OFFSET');
    });

    it('should use price sign for income/expense classification in summary', async () => {
        const summaryRow = {
            total_count: '3', total_expenses: '500.00', total_income: '10000.00',
            credit_total: '500.00', debit_total: '0', direct_total: '0'
        };

        mockClient.query
            .mockResolvedValueOnce({ rows: [summaryRow] })
            .mockResolvedValueOnce({ rows: [] });

        await handler({
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        }, mockRes);

        const response = mockRes.json.mock.calls[0][0];

        // Summary uses price sign: negative = expense, positive = income
        expect(response.summary.totalExpenses).toBe(500);
        expect(response.summary.totalIncome).toBe(10000);
    });

    it('summary query should use same WHERE conditions as main query', async () => {
        mockClient.query.mockResolvedValue({ rows: [] });

        await handler({
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31', sourceType: 'credit' }
        }, mockRes);

        const summarySql = mockClient.query.mock.calls[0][0];
        const mainSql = mockClient.query.mock.calls[1][0];

        // Both queries should have the same date filter
        expect(summarySql).toContain('date >= $1::date');
        expect(summarySql).toContain('date <= $2::date');
        expect(mainSql).toContain('date >= $1::date');
        expect(mainSql).toContain('date <= $2::date');

        // Both should have the sourceType filter
        expect(summarySql).toContain('credit_card');
        expect(mainSql).toContain('credit_card');
    });

    it('summary query should use same params as main query (minus LIMIT/OFFSET)', async () => {
        mockClient.query.mockResolvedValue({ rows: [] });

        await handler({
            method: 'GET',
            query: { startDate: '2024-03-01', endDate: '2024-03-31', vendor: 'visaCal' }
        }, mockRes);

        const summaryParams = mockClient.query.mock.calls[0][1];
        const mainParams = mockClient.query.mock.calls[1][1];

        // Summary params: just the WHERE params
        expect(summaryParams).toEqual(['2024-03-01', '2024-03-31', 'visaCal']);

        // Main params: WHERE params + LIMIT + OFFSET
        expect(mainParams).toEqual(['2024-03-01', '2024-03-31', 'visaCal', 100, 0]);
    });

    it('should exclude transfers from summary totals', async () => {
        const summarySql = await getSummarySql({ startDate: '2024-01-01', endDate: '2024-01-31' });

        // Summary SQL should filter out transfers
        expect(summarySql).toContain("!= 'transfer'");
    });

    it('summary breakdown should partition correctly (credit + debit + direct)', async () => {
        const summaryRow = {
            total_count: '10', total_expenses: '1000.00', total_income: '0',
            credit_total: '600.00', debit_total: '150.00', direct_total: '250.00'
        };

        mockClient.query
            .mockResolvedValueOnce({ rows: [summaryRow] })
            .mockResolvedValueOnce({ rows: [] });

        await handler({
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        }, mockRes);

        const { summary } = mockRes.json.mock.calls[0][0];

        // credit + debit + direct should equal total expenses
        expect(summary.creditCardTotal + summary.debitTotal + summary.directTotal).toBe(summary.totalExpenses);
    });

    it('should handle empty result set gracefully', async () => {
        mockClient.query.mockResolvedValue({ rows: [] });

        await handler({
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        }, mockRes);

        const response = mockRes.json.mock.calls[0][0];
        expect(response.summary).toEqual({
            totalCount: 0,
            totalExpenses: 0,
            totalIncome: 0,
            creditCardTotal: 0,
            debitTotal: 0,
            directTotal: 0,
        });
        expect(response.transactions).toEqual([]);
    });

    it('should not include summary for special query modes (summary=true, availableMonths=true)', async () => {
        // summary=true mode
        mockClient.query.mockResolvedValue({
            rows: [{ categories_count: '5', non_mapped_count: '2', all_transactions_count: '100', last_month_data: '01-01-2024' }]
        });

        await handler({
            method: 'GET',
            query: { summary: 'true' }
        }, mockRes);

        const response = mockRes.json.mock.calls[0][0];
        // Should NOT have transactions/summary wrapper
        expect(response).toHaveProperty('categories');
        expect(response).not.toHaveProperty('transactions');
    });

    // Helper to extract summary SQL
    async function getSummarySql(query: Record<string, string>) {
        mockClient.query.mockResolvedValue({ rows: [] });
        await handler({ method: 'GET', query }, mockRes);
        return mockClient.query.mock.calls[0][0];
    }
});
