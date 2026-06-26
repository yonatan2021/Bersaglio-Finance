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
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

// Mock the israeli-bank-scrapers module
vi.mock('israeli-bank-scrapers', () => ({
    createScraper: vi.fn()
}));

// Mock the core scrapers module
vi.mock('../scrapers/core.js', () => ({
    RATE_LIMITED_VENDORS: ['isracard', 'amex', 'max', 'visaCal'],
    getChromePath: vi.fn().mockReturnValue('/usr/bin/chromium'),
    getScraperOptions: vi.fn(),
    getPreparePage: vi.fn(),
    sleep: vi.fn().mockImplementation((ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(ms, 10))))
}));

// Mock constants
vi.mock('../utils/constants.js', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        BANK_VENDORS: ['hapoalim', 'leumi', 'discount', 'mizrahi', 'yahav', 'beinleumi'],
        BEINLEUMI_GROUP_VENDORS: ['beinleumi', 'massad', 'igud', 'mercantile', 'otsarHahayal']
    };
});

// Mock transactionUtils
vi.mock('../pages/api/utils/transactionUtils.js', () => ({
    generateTransactionIdentifier: vi.fn().mockReturnValue('mock-tx-id')
}));

import { getDB } from '../pages/api/db';
import { insertTransaction } from '../pages/api/utils/scraperUtils';

describe('insertTransaction payment_method', () => {
    let mockClient: {
        query: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
    };

    const mockDate = new Date('2023-01-01');
    const mockTransaction = {
        date: mockDate.toISOString(),
        processedDate: mockDate.toISOString(),
        originalAmount: 100,
        originalCurrency: 'ILS',
        chargedAmount: 100,
        description: 'Test Transaction',
        memo: 'Memo',
        status: 'completed',
        identifier: 'tx123',
        type: 'debit',
        installmentsNumber: 1,
        installmentsTotal: 1,
        category: null
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };

        (getDB as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should set payment_method to bank_direct for bank transactions', async () => {
        // identifier check, businessKey check, INSERT
        mockClient.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        await insertTransaction(
            mockClient,
            mockTransaction,
            'hapoalim',
            '1234',
            'ILS',
            [],
            false,
            {},
            true // isBank = true
        );

        const insertCall = mockClient.query.mock.calls.find((call: any[]) =>
            call[0].includes('INSERT INTO transactions')
        );

        expect(insertCall).toBeDefined();
        if (insertCall) {
            const params = insertCall[1];
            // payment_method is $20, index 19
            expect(params[19]).toBe('bank_direct');
        }
    });

    it('should set payment_method to credit for non-debit credit card transactions', async () => {
        // identifier check, businessKey check, card_vendors query, INSERT
        mockClient.query
            .mockResolvedValueOnce({ rows: [] })  // identifier check
            .mockResolvedValueOnce({ rows: [] })  // businessKey check
            .mockResolvedValueOnce({ rows: [{ billing_cycle_start_day: 10, is_debit: false }] })  // card_vendors
            .mockResolvedValueOnce({ rows: [] }); // INSERT

        await insertTransaction(
            mockClient,
            mockTransaction,
            'max',
            '1234',
            'ILS',
            [],
            false,
            {},
            false // isBank = false
        );

        const insertCall = mockClient.query.mock.calls.find((call: any[]) =>
            call[0].includes('INSERT INTO transactions')
        );

        expect(insertCall).toBeDefined();
        if (insertCall) {
            const params = insertCall[1];
            expect(params[19]).toBe('credit');
        }
    });

    it('should set payment_method to debit for debit card transactions', async () => {
        // identifier check, businessKey check, card_vendors query (is_debit=true), INSERT
        mockClient.query
            .mockResolvedValueOnce({ rows: [] })  // identifier check
            .mockResolvedValueOnce({ rows: [] })  // businessKey check
            .mockResolvedValueOnce({ rows: [{ billing_cycle_start_day: 10, is_debit: true }] })  // card_vendors
            .mockResolvedValueOnce({ rows: [] }); // INSERT

        await insertTransaction(
            mockClient,
            mockTransaction,
            'max',
            '1234',
            'ILS',
            [],
            false,
            {},
            false // isBank = false
        );

        const insertCall = mockClient.query.mock.calls.find((call: any[]) =>
            call[0].includes('INSERT INTO transactions')
        );

        expect(insertCall).toBeDefined();
        if (insertCall) {
            const params = insertCall[1];
            expect(params[19]).toBe('debit');
        }
    });

    it('should include payment_method in historyCache', async () => {
        const historyCache = {
            idMap: new Map(),
            businessKeys: new Map()
        };

        // Default to empty rows for all queries
        mockClient.query.mockResolvedValue({ rows: [] });

        await insertTransaction(
            mockClient,
            mockTransaction,
            'hapoalim',
            '1234',
            'ILS',
            [],
            false,
            {},
            true, // isBank = true
            10,
            historyCache
        );

        const cached = historyCache.idMap.get('tx123');
        expect(cached).toBeDefined();
        expect(cached.payment_method).toBe('bank_direct');
    });

    it('should default to credit when no card_vendors row found for credit card', async () => {
        // identifier check, businessKey check, card_vendors query (no rows), INSERT
        mockClient.query
            .mockResolvedValueOnce({ rows: [] })  // identifier check
            .mockResolvedValueOnce({ rows: [] })  // businessKey check
            .mockResolvedValueOnce({ rows: [] })  // card_vendors - no match
            .mockResolvedValueOnce({ rows: [] }); // INSERT

        await insertTransaction(
            mockClient,
            mockTransaction,
            'visaCal',
            '5678',
            'ILS',
            [],
            false,
            {},
            false // isBank = false
        );

        const insertCall = mockClient.query.mock.calls.find((call: any[]) =>
            call[0].includes('INSERT INTO transactions')
        );

        expect(insertCall).toBeDefined();
        if (insertCall) {
            const params = insertCall[1];
            expect(params[19]).toBe('credit');
        }
    });
});
