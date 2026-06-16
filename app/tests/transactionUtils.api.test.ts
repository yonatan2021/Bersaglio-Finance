import { describe, it, expect, vi } from 'vitest';

vi.mock('../../app/utils/dateUtils.js', async () => {
    const actual = await vi.importActual('../../app/utils/dateUtils.js') as any;
    return actual;
});

import { generateTransactionIdentifier, normalizeDescription } from '../pages/api/utils/transactionUtils';

describe('normalizeDescription', () => {
    it('should return empty string for null/undefined/empty input', () => {
        expect(normalizeDescription(null)).toBe('');
        expect(normalizeDescription(undefined)).toBe('');
        expect(normalizeDescription('')).toBe('');
    });

    it('should convert to lowercase and trim', () => {
        expect(normalizeDescription('  Hello World  ')).toBe('hello world');
    });

    it('should replace separators with spaces', () => {
        expect(normalizeDescription('foo/bar-baz_qux,quux.corge')).toBe('foo bar baz qux quux corge');
    });

    it('should remove special characters but keep Hebrew', () => {
        expect(normalizeDescription('סופר פארם #123')).toBe('סופר פארם 123');
    });

    it('should collapse multiple spaces into one', () => {
        expect(normalizeDescription('hello   world    foo')).toBe('hello world foo');
    });

    it('should remove leading zeros from numbers', () => {
        expect(normalizeDescription('order 007 item 042')).toBe('order 7 item 42');
    });

    it('should preserve Hebrew text correctly', () => {
        expect(normalizeDescription('רמי לוי שיווק השקמה')).toBe('רמי לוי שיווק השקמה');
    });

    it('should handle mixed Hebrew and English', () => {
        const result = normalizeDescription('Visa-Cal סופר');
        expect(result).toBe('visa cal סופר');
    });
});

describe('generateTransactionIdentifier', () => {
    it('should produce a deterministic hash for the same input', () => {
        const txn = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test Purchase',
            chargedAmount: 100.50
        };
        const id1 = generateTransactionIdentifier(txn, 'visaCal', '1234');
        const id2 = generateTransactionIdentifier(txn, 'visaCal', '1234');
        expect(id1).toBe(id2);
    });

    it('should return a 40-character hex string', () => {
        const txn = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test Purchase',
            chargedAmount: 50
        };
        const id = generateTransactionIdentifier(txn, 'visaCal', '1234');
        expect(id).toHaveLength(40);
        expect(id).toMatch(/^[0-9a-f]{40}$/);
    });

    it('should produce different identifiers for different amounts', () => {
        const baseTxn = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test Purchase',
        };
        const id1 = generateTransactionIdentifier({ ...baseTxn, chargedAmount: 100 }, 'visaCal', '1234');
        const id2 = generateTransactionIdentifier({ ...baseTxn, chargedAmount: 200 }, 'visaCal', '1234');
        expect(id1).not.toBe(id2);
    });

    it('should produce different identifiers for different dates', () => {
        const baseTxn = {
            identifier: 'txn-001',
            description: 'Test Purchase',
            chargedAmount: 100
        };
        const id1 = generateTransactionIdentifier({ ...baseTxn, date: '2024-01-15' }, 'visaCal', '1234');
        const id2 = generateTransactionIdentifier({ ...baseTxn, date: '2024-02-15' }, 'visaCal', '1234');
        expect(id1).not.toBe(id2);
    });

    it('should produce different identifiers for different vendors', () => {
        const txn = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test Purchase',
            chargedAmount: 100
        };
        const id1 = generateTransactionIdentifier(txn, 'visaCal', '1234');
        const id2 = generateTransactionIdentifier(txn, 'max', '1234');
        expect(id1).not.toBe(id2);
    });

    it('should produce different identifiers for different account numbers', () => {
        const txn = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test Purchase',
            chargedAmount: 100
        };
        const id1 = generateTransactionIdentifier(txn, 'visaCal', '1234');
        const id2 = generateTransactionIdentifier(txn, 'visaCal', '5678');
        expect(id1).not.toBe(id2);
    });

    it('should handle null/undefined fields gracefully', () => {
        const txn = {
            identifier: null,
            date: '2024-01-15',
            description: null,
            chargedAmount: undefined,
            originalAmount: undefined
        };
        // Should not throw
        const id = generateTransactionIdentifier(txn, null, null);
        expect(id).toHaveLength(40);
        expect(id).toMatch(/^[0-9a-f]{40}$/);
    });

    it('should fall back to originalAmount when chargedAmount is missing', () => {
        const txn1 = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test',
            chargedAmount: 100
        };
        const txn2 = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test',
            originalAmount: 100
        };
        const id1 = generateTransactionIdentifier(txn1, 'visaCal', '1234');
        const id2 = generateTransactionIdentifier(txn2, 'visaCal', '1234');
        expect(id1).toBe(id2);
    });

    it('should use 0 when both chargedAmount and originalAmount are missing', () => {
        const txn = {
            identifier: 'txn-001',
            date: '2024-01-15',
            description: 'Test'
        };
        const id = generateTransactionIdentifier(txn, 'visaCal', '1234');
        expect(id).toHaveLength(40);
    });

    it('should produce different identifiers for different descriptions', () => {
        const baseTxn = {
            identifier: 'txn-001',
            date: '2024-01-15',
            chargedAmount: 100
        };
        const id1 = generateTransactionIdentifier({ ...baseTxn, description: 'Store A' }, 'visaCal', '1234');
        const id2 = generateTransactionIdentifier({ ...baseTxn, description: 'Store B' }, 'visaCal', '1234');
        expect(id1).not.toBe(id2);
    });
});
