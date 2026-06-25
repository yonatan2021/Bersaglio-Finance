import { describe, it, expect } from 'vitest';
import {
    formatCurrency,
    formatDate,
    progressBar,
    statusIndicator,
    formatTransactionCard,
    sectionSeparator,
    thinSeparator,
} from '../../utils/telegram-bot/formatters';

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

describe('formatTransactionCard', () => {
    it('includes name, amount, date, and category', () => {
        const result = formatTransactionCard({
            name: 'Coffee Shop',
            price: -25,
            date: '2026-06-15',
            category: 'אוכל',
        });
        expect(result).toContain('Coffee Shop');
        expect(result).toContain('₪25');
        expect(result).toContain('15/06');
        expect(result).toContain('אוכל');
    });

    it('shows fallback for null category', () => {
        const result = formatTransactionCard({
            name: 'Unknown',
            price: -10,
            date: '2026-06-15',
            category: null,
        });
        expect(result).toContain('ללא קטגוריה');
    });
});

describe('separators', () => {
    it('sectionSeparator returns thick line', () => {
        expect(sectionSeparator()).toBe('━━━━━━━━━━━━━━━━');
    });

    it('thinSeparator returns dotted line', () => {
        expect(thinSeparator()).toBe('┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    });
});
