import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDB } from '../pages/api/db';

// Mock the database module
vi.mock('../pages/api/db', () => ({
    getDB: vi.fn(),
    pool: {
        connect: vi.fn(),
        query: vi.fn(),
        on: vi.fn(),
    }
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

// Mock transaction_logic for monthly-summary (uses relative import path via createApiHandler)
vi.mock('../utils/transaction_logic', () => ({
    getBillingCycleSql: vi.fn(() => 'mock_billing_sql')
}));

// Mock transaction_logic for budget-vs-actual (uses ../../../utils/transaction_logic)
vi.mock('../../../utils/transaction_logic', () => ({
    getBillingCycleSql: vi.fn(() => 'mock_billing_sql')
}));

describe('Report Queries — Double-Count Fix + category_type', () => {
    let mockClient: {
        query: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
    };
    let mockRes: {
        status: ReturnType<typeof vi.fn>;
        json: ReturnType<typeof vi.fn>;
        setHeader: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };

        (getDB as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('monthly-summary', () => {
        let monthlySummaryHandler: any;

        beforeEach(async () => {
            const mod = await import('../pages/api/reports/monthly-summary');
            monthlySummaryHandler = mod.default;
        });

        it('should exclude reconciled bank transactions in category groupBy', async () => {
            const mockReq = {
                method: 'GET',
                query: {
                    startDate: '2024-01-01',
                    endDate: '2024-01-31',
                    groupBy: 'category'
                }
            };

            mockClient.query.mockResolvedValue({
                rowCount: 0,
                rows: []
            });

            await monthlySummaryHandler(mockReq, mockRes);

            expect(mockClient.query).toHaveBeenCalledTimes(1);
            const [sql] = mockClient.query.mock.calls[0];
            expect(sql).toContain('transaction_reconciliations');
            expect(sql).toContain("tr.status = 'approved'");
            expect(sql).toContain('tr.bank_identifier = t.identifier');
            expect(sql).toContain('tr.bank_vendor = t.vendor');
        });

        it('should exclude reconciled bank transactions in description groupBy', async () => {
            const mockReq = {
                method: 'GET',
                query: {
                    startDate: '2024-01-01',
                    endDate: '2024-01-31',
                    groupBy: 'description'
                }
            };

            mockClient.query.mockResolvedValue({
                rowCount: 0,
                rows: []
            });

            await monthlySummaryHandler(mockReq, mockRes);

            expect(mockClient.query).toHaveBeenCalledTimes(1);
            const [sql] = mockClient.query.mock.calls[0];
            expect(sql).toContain('transaction_reconciliations');
        });

        it('should return category_type field in category groupBy', async () => {
            const mockReq = {
                method: 'GET',
                query: {
                    startDate: '2024-01-01',
                    endDate: '2024-01-31',
                    groupBy: 'category'
                }
            };

            mockClient.query.mockResolvedValue({
                rowCount: 1,
                rows: [{
                    category: 'Food',
                    category_type: 'expense',
                    total: -500,
                    amount: -500,
                    bank_income: 0,
                    bank_expenses: 0,
                    card_expenses: 500,
                    count: 5,
                    total_count: 1
                }]
            });

            await monthlySummaryHandler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const responseData = mockRes.json.mock.calls[0][0];
            expect(responseData.items[0]).toHaveProperty('category_type', 'expense');
        });

        it('should join category_types table in category groupBy SQL', async () => {
            const mockReq = {
                method: 'GET',
                query: {
                    startDate: '2024-01-01',
                    endDate: '2024-01-31',
                    groupBy: 'category'
                }
            };

            mockClient.query.mockResolvedValue({
                rowCount: 0,
                rows: []
            });

            await monthlySummaryHandler(mockReq, mockRes);

            const [sql] = mockClient.query.mock.calls[0];
            expect(sql).toContain('LEFT JOIN category_types ct ON t.category = ct.category');
            expect(sql).toContain("COALESCE(ct.type, 'expense') as category_type");
        });
    });

    describe('budget-vs-actual', () => {
        let budgetHandler: any;

        beforeEach(async () => {
            const mod = await import('../pages/api/reports/budget-vs-actual');
            budgetHandler = mod.default;
        });

        it('should exclude reconciled bank transactions', async () => {
            const mockReq = {
                method: 'GET',
                query: { startDate: '2024-01-01', endDate: '2024-01-31' }
            };

            // ensureTotalBudgetTable + getBillingCycleStartDay + actualSpending + budgets + totalBudget
            mockClient.query
                .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
                .mockResolvedValueOnce({ rows: [{ value: '10' }] }) // billing start day
                .mockResolvedValueOnce({ rows: [] }) // actual spending
                .mockResolvedValueOnce({ rows: [] }) // budgets
                .mockResolvedValueOnce({ rows: [] }); // total_budget

            await budgetHandler(mockReq, mockRes);

            // The actual spending query is the first one in Promise.all (3rd overall call)
            // But Promise.all calls are concurrent; let's check the SQL of the actual spending query
            const allCalls = mockClient.query.mock.calls;
            const spendingCall = allCalls.find(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('actual_spent')
            );
            expect(spendingCall).toBeDefined();
            const sql = spendingCall![0];
            expect(sql).toContain('transaction_reconciliations');
            expect(sql).toContain("tr.status = 'approved'");
        });

        it('should filter by expense category_type instead of hardcoded Bank exclusion', async () => {
            const mockReq = {
                method: 'GET',
                query: { startDate: '2024-01-01', endDate: '2024-01-31' }
            };

            mockClient.query
                .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
                .mockResolvedValueOnce({ rows: [{ value: '10' }] }) // billing start day
                .mockResolvedValueOnce({ rows: [] }) // actual spending
                .mockResolvedValueOnce({ rows: [] }) // budgets
                .mockResolvedValueOnce({ rows: [] }); // total_budget

            await budgetHandler(mockReq, mockRes);

            const allCalls = mockClient.query.mock.calls;
            const spendingCall = allCalls.find(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('actual_spent')
            );
            expect(spendingCall).toBeDefined();
            const sql = spendingCall![0];

            // Should use category_types join, not hardcoded Bank exclusion
            expect(sql).toContain('LEFT JOIN category_types ct ON transactions.category = ct.category');
            expect(sql).toContain("COALESCE(ct.type, 'expense') = 'expense'");
            // Should NOT have the old hardcoded Bank exclusion
            expect(sql).not.toContain("COALESCE(category, '') != 'Bank'");
        });

        it('should exclude income categories from budget tracking', async () => {
            const mockReq = {
                method: 'GET',
                query: { billingCycle: '2024-01' }
            };

            mockClient.query
                .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
                .mockResolvedValueOnce({ rows: [{ value: '10' }] }) // billing start day
                .mockResolvedValueOnce({ rows: [] }) // actual spending
                .mockResolvedValueOnce({ rows: [] }) // budgets
                .mockResolvedValueOnce({ rows: [] }); // total_budget

            await budgetHandler(mockReq, mockRes);

            const allCalls = mockClient.query.mock.calls;
            const spendingCall = allCalls.find(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('actual_spent')
            );
            const sql = spendingCall![0];

            // Only expense category types should be included
            expect(sql).toContain("COALESCE(ct.type, 'expense') = 'expense'");
        });

        it('should exclude transfer categories from budget tracking', async () => {
            const mockReq = {
                method: 'GET',
                query: { billingCycle: '2024-01' }
            };

            mockClient.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ value: '10' }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });

            await budgetHandler(mockReq, mockRes);

            const allCalls = mockClient.query.mock.calls;
            const spendingCall = allCalls.find(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('actual_spent')
            );
            const sql = spendingCall![0];

            // The filter = 'expense' implicitly excludes 'transfer' type categories
            expect(sql).toContain("COALESCE(ct.type, 'expense') = 'expense'");
            // Income and transfer categories are excluded by the = 'expense' filter
            expect(sql).not.toContain("!= 'Bank'");
        });

        it('should still exclude credit card payment names from bank transactions', async () => {
            const mockReq = {
                method: 'GET',
                query: { startDate: '2024-01-01', endDate: '2024-01-31' }
            };

            mockClient.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ value: '10' }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });

            await budgetHandler(mockReq, mockRes);

            const allCalls = mockClient.query.mock.calls;
            const spendingCall = allCalls.find(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('actual_spent')
            );
            const sql = spendingCall![0];

            // Credit card payment name exclusions should still be present
            expect(sql).toContain('%מסטרקרד%');
            expect(sql).toContain('%ישראכרט%');
            expect(sql).toContain('%ויזה%');
        });
    });
});
