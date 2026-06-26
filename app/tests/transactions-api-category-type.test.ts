import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module
vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

// Mock encryption to avoid env var requirement
vi.mock('../pages/api/utils/encryption', () => ({
    decrypt: vi.fn(),
    encrypt: vi.fn(),
    safeDecrypt: vi.fn((val: string) => val),
    VaultLockedError: class VaultLockedError extends Error {
        constructor() {
            super('Vault is locked');
            this.name = 'VaultLockedError';
        }
    }
}));

import { getDB } from '../pages/api/db';
import handler from '../pages/api/transactions/index';

describe('Transactions API - category_type field', () => {
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

    it('should include category_type in the response', async () => {
        const mockReq = {
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        };

        mockClient.query.mockResolvedValue({
            rowCount: 1,
            rows: [{
                identifier: 'tx1',
                vendor: 'visaCal',
                date: '2024-01-15',
                name: 'Coffee Shop',
                original_name: 'Coffee Shop',
                display_name: 'Coffee Shop',
                price: -25,
                category: 'Food',
                type: 'normal',
                processed_date: '2024-01-15',
                account_number: '1234',
                transaction_type: 'credit_card',
                is_reconciled: false,
                is_debit: false,
                is_favorite: false,
                category_type: 'expense',
                card6_digits_encrypted: null
            }]
        });

        await handler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData.transactions[0]).toHaveProperty('category_type', 'expense');
    });

    it('should default category_type to expense when category has no type mapping', async () => {
        const mockReq = {
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        };

        mockClient.query.mockResolvedValue({
            rowCount: 1,
            rows: [{
                identifier: 'tx2',
                vendor: 'hapoalim',
                date: '2024-01-10',
                name: 'Unknown Charge',
                original_name: 'Unknown Charge',
                display_name: 'Unknown Charge',
                price: -100,
                category: null,
                type: 'normal',
                processed_date: '2024-01-10',
                account_number: '5678',
                transaction_type: 'bank',
                is_reconciled: false,
                is_debit: false,
                is_favorite: false,
                category_type: 'expense',  // COALESCE default
                card6_digits_encrypted: null
            }]
        });

        await handler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData.transactions[0].category_type).toBe('expense');
    });

    it('should return income category_type when mapped as income', async () => {
        const mockReq = {
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        };

        mockClient.query.mockResolvedValue({
            rowCount: 1,
            rows: [{
                identifier: 'tx3',
                vendor: 'hapoalim',
                date: '2024-01-05',
                name: 'Salary',
                original_name: 'Salary',
                display_name: 'Salary',
                price: 15000,
                category: 'Income',
                type: 'normal',
                processed_date: '2024-01-05',
                account_number: '5678',
                transaction_type: 'bank',
                is_reconciled: false,
                is_debit: false,
                is_favorite: false,
                category_type: 'income',
                card6_digits_encrypted: null
            }]
        });

        await handler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData.transactions[0].category_type).toBe('income');
    });

    it('should preserve is_credit for backward compatibility alongside category_type', async () => {
        const mockReq = {
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        };

        mockClient.query.mockResolvedValue({
            rowCount: 1,
            rows: [{
                identifier: 'tx4',
                vendor: 'hapoalim',
                date: '2024-01-05',
                name: 'Salary',
                original_name: 'Salary',
                display_name: 'Salary',
                price: 15000,
                category: 'Income',
                type: 'normal',
                processed_date: '2024-01-05',
                account_number: '5678',
                transaction_type: 'bank',
                is_reconciled: false,
                is_debit: false,
                is_favorite: false,
                category_type: 'income',
                card6_digits_encrypted: null
            }]
        });

        await handler(mockReq, mockRes);

        const responseData = mockRes.json.mock.calls[0][0];
        // is_credit based on price > 0 (backward compat)
        expect(responseData.transactions[0].is_credit).toBe(true);
        // category_type from the category_types table
        expect(responseData.transactions[0].category_type).toBe('income');
    });

    it('should include category_type JOIN in the SQL query', async () => {
        const mockReq = {
            method: 'GET',
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        };

        mockClient.query.mockResolvedValue({ rowCount: 0, rows: [] });

        await handler(mockReq, mockRes);

        const mainSql = mockClient.query.mock.calls[1][0];
        expect(mainSql).toContain('category_types ct');
        expect(mainSql).toContain("COALESCE(ct.type, 'expense') as category_type");
    });
});
