/**
 * Generates a SQL fragment to determine the "Effective Billing Month" (YYYY-MM) for a transaction.
 * 
 * Logic:
 * 1. If processed_date exists, use it.
 * 2. If processed_date is NULL:
 *    - If transaction day >= startDay: It belongs to next month's bill.
 *    - If transaction day < startDay: It belongs to this month's bill.
 * 
 * @param {number} startDay - The billing cycle start day (default 10)
 * @param {string} dateCol - The name of the date column (default 'date')
 * @param {string} processedDateCol - The name of the processed_date column (default 'processed_date')
 * @returns {string} The SQL fragment returning a 'YYYY-MM' string
 */
export function getBillingCycleSql(startDay = 10, dateCol = 'date', processedDateCol = 'processed_date') {
    const parts = dateCol.split('.');
    const alias = parts.length > 1 ? parts[0] + '.' : '';
    const accountNumberCol = `${alias}account_number`;
    const transactionTypeCol = `${alias}transaction_type`;

    const resolvedStartDay = `(CASE 
        WHEN ${transactionTypeCol} = 'bank' THEN 1
        ELSE COALESCE(
            (
                SELECT 
                    CASE 
                        WHEN cv.is_debit = true THEN 1
                        ELSE COALESCE(cv.billing_cycle_start_day, ${startDay})
                    END
                FROM card_vendors cv
                WHERE cv.last4_digits = RIGHT(${accountNumberCol}, 4)
            ),
            ${startDay}
        )
    END)`;

    return `
        TO_CHAR(
            CASE 
                /* 1. If we have a specific billing date (processed_date) that differs from the transaction date,
                   it already represents a determined billing moment.
                   If it's on or after the startDay, it belongs to this month's cycle.
                   If it's before the startDay, it belongs to the previous month's cycle. */
                WHEN ${processedDateCol} IS NOT NULL AND ${processedDateCol} != ${dateCol}
                THEN (
                    CASE 
                        WHEN EXTRACT(DAY FROM ${processedDateCol}) > ${resolvedStartDay} 
                        THEN ${processedDateCol}
                        ELSE (${processedDateCol} - INTERVAL '1 month')
                    END
                )
                /* 2. Standard logic for new transactions or bank transactions (where date == processed_date):
                   Anything on or after the startDay belongs to the current month's cycle.
                   Anything before the startDay belongs to the previous month's cycle. */
                WHEN EXTRACT(DAY FROM COALESCE(${processedDateCol}, ${dateCol})) >= ${resolvedStartDay} 
                THEN COALESCE(${processedDateCol}, ${dateCol})
                ELSE (COALESCE(${processedDateCol}, ${dateCol}) - INTERVAL '1 month')
            END, 
            'YYYY-MM'
        )
    `;
}
