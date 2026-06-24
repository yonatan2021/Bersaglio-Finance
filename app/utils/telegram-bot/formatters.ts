const MD2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(text: string): string {
    return String(text).replace(MD2_SPECIAL, '\\$&');
}

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

export function formatTransaction(txn: { date: string; name: string; price: number; category: string | null }): string {
    const date = escapeMarkdownV2(formatDate(txn.date));
    const name = escapeMarkdownV2(txn.name);
    const amount = escapeMarkdownV2(formatCurrency(Math.abs(txn.price)));
    const cat = escapeMarkdownV2(txn.category || 'ללא קטגוריה');
    return `${date} \\| ${name} \\| ${amount} \\| ${cat}`;
}

export function statusIndicator(percentUsed: number): string {
    if (percentUsed > 100) return '⚠️';
    if (percentUsed > 80) return '🟡';
    return '✅';
}
