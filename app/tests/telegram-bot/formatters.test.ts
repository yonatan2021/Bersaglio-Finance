import { describe, it, expect } from 'vitest';
import { escapeMarkdownV2, formatCurrency, formatDate, progressBar, formatTransaction, statusIndicator } from '../../utils/telegram-bot/formatters';

describe('escapeMarkdownV2', () => {
    it('escapes all MarkdownV2 special characters', () => {
        expect(escapeMarkdownV2('hello_world')).toBe('hello\\_world');
        expect(escapeMarkdownV2('price: 100.5')).toBe('price: 100\\.5');
        expect(escapeMarkdownV2('(test)')).toBe('\\(test\\)');
        expect(escapeMarkdownV2('a+b=c')).toBe('a\\+b\\=c');
    });

    it('returns plain text unchanged', () => {
        expect(escapeMarkdownV2('hello')).toBe('hello');
        expect(escapeMarkdownV2('שלום')).toBe('שלום');
    });
});

describe('formatCurrency', () => {
    it('formats positive numbers with ₪ prefix', () => {
        expect(formatCurrency(1500)).toBe('₪1,500');
    });

    it('formats negative amounts using absolute value', () => {
        expect(formatCurrency(-250)).toBe('₪250');
    });

    it('handles zero', () => {
        expect(formatCurrency(0)).toBe('₪0');
    });
});

describe('formatDate', () => {
    it('formats Date object as DD/MM', () => {
        expect(formatDate(new Date('2026-06-05'))).toBe('05/06');
    });

    it('formats date string', () => {
        expect(formatDate('2026-01-15')).toBe('15/01');
    });
});

describe('progressBar', () => {
    it('shows empty bar at 0%', () => {
        expect(progressBar(0)).toBe('░░░░░░░░░░');
    });

    it('shows full bar at 100%', () => {
        expect(progressBar(100)).toBe('▓▓▓▓▓▓▓▓▓▓');
    });

    it('clamps above 100%', () => {
        expect(progressBar(150)).toBe('▓▓▓▓▓▓▓▓▓▓');
    });

    it('shows proportional fill', () => {
        expect(progressBar(50)).toBe('▓▓▓▓▓░░░░░');
    });
});

describe('statusIndicator', () => {
    it('returns ✅ for under 80%', () => {
        expect(statusIndicator(60)).toBe('✅');
    });

    it('returns 🟡 for 80-100%', () => {
        expect(statusIndicator(85)).toBe('🟡');
    });

    it('returns ⚠️ for over 100%', () => {
        expect(statusIndicator(110)).toBe('⚠️');
    });
});

describe('formatTransaction', () => {
    it('formats a full transaction row', () => {
        const result = formatTransaction({
            date: '2026-06-15',
            name: 'Coffee Shop',
            price: -25,
            category: 'אוכל',
        });
        expect(result).toContain('15/06');
        expect(result).toContain('Coffee Shop');
        expect(result).toContain('₪25');
        expect(result).toContain('אוכל');
    });

    it('shows fallback for null category', () => {
        const result = formatTransaction({
            date: '2026-06-15',
            name: 'Unknown',
            price: -10,
            category: null,
        });
        expect(result).toContain('ללא קטגוריה');
    });
});
