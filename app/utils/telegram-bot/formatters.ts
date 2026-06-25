export function formatCurrency(amount: number): string {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return `₪${formatted}`;
}

export function formatDate(date: string | Date): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
}

export function progressBar(percent: number, width = 10): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

export function statusIndicator(percentUsed: number): string {
    if (percentUsed > 100) return '⚠️';
    if (percentUsed > 80) return '🟡';
    return '✅';
}

export function sectionSeparator(): string {
    return '━━━━━━━━━━━━━━━━';
}

export function thinSeparator(): string {
    return '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄';
}

export function formatTransactionCard(txn: { name: string; price: number; date: string; category: string | null }): string {
    const amount = formatCurrency(Math.abs(txn.price));
    const date = formatDate(txn.date);
    const cat = txn.category || 'ללא קטגוריה';
    return `📝 ${txn.name}\n💰 ${amount}  ·  📅 ${date}\n🏷 ${cat}`;
}
