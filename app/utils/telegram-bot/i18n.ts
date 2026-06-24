export const t = {
    welcome: '👋 שלום! אני הבוט הפיננסי של Nudlers.\nבחר פעולה מהתפריט:',
    menuStatus: '📊 סטטוס תקציב',
    menuRecent: '💳 עסקאות אחרונות',
    menuExpense: '➕ הוצאה חדשה',
    menuSearch: '🔍 חיפוש עסקאות',
    menuSummary: '📋 סיכום יומי',
    menuSync: '🔄 סנכרון',
    menuTriage: '🏷️ סיווג עסקאות',
    menuSettings: '⚙️ הגדרות',

    statusTitle: '📊 *סטטוס תקציב*',
    cashflowTitle: '💰 *תזרים חודשי:*',
    budgetTitle: '📉 *ניצול תקציב:*',
    topCategoriesTitle: '🏆 *טופ 3 קטגוריות:*',
    burndownTitle: '🔥 *בורנדאון:*',

    recentTitle: '💳 *עסקאות אחרונות*',
    recentEmpty: 'לא נמצאו עסקאות לתקופה זו\\.',
    prevPage: '◀️ הקודם',
    nextPage: '▶️ הבא',
    editCategory: '✏️',

    searchPrompt: 'שלח את מילת החיפוש:',
    searchEmpty: 'לא נמצאו תוצאות\\.',
    searchTitle: '🔍 *תוצאות חיפוש*',

    expenseAskName: 'מה שם ההוצאה?',
    expenseAskAmount: 'כמה זה עלה? \\(מספר בלבד\\)',
    expenseAskCategory: 'בחר קטגוריה:',
    expenseConfirm: 'אישור ✅',
    expenseCancel: 'ביטול ❌',
    expenseAdded: '✅ ההוצאה נוספה בהצלחה\\!',
    expenseCancelled: '❌ ההוצאה בוטלה\\.',
    expenseInvalidAmount: 'סכום לא תקין\\. נסה שוב:',

    summaryLoading: '⏳ מייצר סיכום יומי\\.\\.\\.',
    summaryError: 'לא הצלחתי לייצר סיכום\\. נסה שוב מאוחר יותר\\.',

    triageTitle: '🏷️ *סיווג עסקאות*',
    triageEmpty: 'אין עסקאות ללא קטגוריה\\! 🎉',
    triageDone: (count: number) => `סיום\\! סיווגת ${count} עסקאות ✅`,
    triageSkip: 'דלג ⏭️',

    syncStarted: '🔄 מסנכרן\\.\\.\\. ⏳',
    syncComplete: '✅ סנכרון הושלם\\!',
    syncFailed: '❌ הסנכרון נכשל\\.',

    settingsTitle: '⚙️ *הגדרות*',
    settingsAiModel: 'מודל AI',
    settingsSummaryMode: 'מצב סיכום',

    errorGeneric: 'משהו השתבש 😅 נסה שוב\\.',
    errorVaultLocked: 'הכספת נעולה 🔒 יש לפתוח דרך הממשק\\.',
    errorDbConnection: 'בעיית חיבור למסד נתונים\\.',
    errorNoData: 'לא נמצאו נתונים לתקופה זו\\.',
    errorSyncTimeout: 'הסנכרון לוקח זמן, ננסה שוב מאוחר יותר\\.',

    aiFallbackError: 'לא הצלחתי לעבד את הבקשה\\. נסה פקודה ספציפית כמו /status או /recent\\.',
    aiThinking: '🤔 חושב\\.\\.\\.',

    unauthorized: '', // silent drop — no message to unauthorized users
} as const;
