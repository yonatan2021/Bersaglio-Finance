import { InlineKeyboard } from 'grammy';
import { t } from './i18n';

export function mainMenuKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
        .text(t.menuStatus, 'menu:status').text(t.menuRecent, 'menu:recent').row()
        .text(t.menuExpense, 'menu:expense').text(t.menuSearch, 'menu:search').row()
        .text('📊 תקציב', 'menu:budget').text('📋 דוח', 'menu:report').row()
        .text(t.menuSummary, 'menu:summary').text(t.menuSync, 'menu:sync').row()
        .text(t.menuTriage, 'menu:triage').text(t.menuSettings, 'menu:settings');
}

export function categoryKeyboard(categories: string[], callbackPrefix: string): InlineKeyboard {
    const kb = new InlineKeyboard();
    const perRow = 3;
    for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        const data = `${callbackPrefix}${cat}`;
        if (data.length <= 64) {
            kb.text(cat, data);
        }
        if ((i + 1) % perRow === 0 && i < categories.length - 1) {
            kb.row();
        }
    }
    return kb;
}

export function paginationKeyboard(prefix: string, offset: number, pageSize: number, hasMore: boolean): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (offset > 0) {
        kb.text(t.prevPage, `${prefix}${Math.max(0, offset - pageSize)}`);
    }
    if (hasMore) {
        kb.text(t.nextPage, `${prefix}${offset + pageSize}`);
    }
    return kb;
}

export function confirmCancelKeyboard(confirmCb: string, cancelCb: string): InlineKeyboard {
    return new InlineKeyboard()
        .text(t.expenseConfirm, confirmCb)
        .text(t.expenseCancel, cancelCb);
}
