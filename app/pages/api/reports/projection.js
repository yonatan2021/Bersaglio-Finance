import { getDB } from "../db";
import { detectRecurringPayments } from "../../../utils/recurringDetection";
import logger from "../../../utils/logger";
import { normalizeTransactionDates, generateProjection } from "../../../utils/projectionUtils";
import { BANK_VENDORS } from "../../../utils/constants";

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const client = await getDB();
    try {
        // Run all independent queries in parallel for maximum efficiency
        const [accountsRes, manualRes, ccRes] = await Promise.all([
            // 1. Get Accounts (both banks and credit cards)
            client.query(`
                SELECT 
                    co.id,
                    co.account_number,
                    co.balance,
                    co.balance_updated_at,
                    co.custom_bank_account_nickname,
                    co.vendor,
                    vc.nickname as vendor_nickname,
                    vc.id as credential_id
                FROM card_ownership co
                JOIN vendor_credentials vc ON co.credential_id = vc.id
                WHERE co.is_hidden = false
            `),
            // 2. Get Manual Recurring
            client.query(`
                SELECT name, amount, category, account_number, day_of_month, frequency
                FROM manual_recurring_payments
                WHERE is_active = true
            `),
            // 3. Get Future CC Payments
            client.query(`
                SELECT 
                    t.name, t.price, t.date, t.processed_date, t.vendor, t.account_number, t.category,
                    co.linked_bank_account_id,
                    COALESCE(cv.card_nickname, vc_card.nickname, t.vendor) as card_name,
                    RIGHT(t.account_number, 4) as last4
                FROM transactions t
                LEFT JOIN card_ownership co ON t.vendor = co.vendor AND RIGHT(t.account_number, 4) = RIGHT(co.account_number, 4)
                LEFT JOIN vendor_credentials vc_card ON co.credential_id = vc_card.id
                LEFT JOIN vendor_credentials vc_bank ON co.linked_bank_account_id = vc_bank.id
                LEFT JOIN card_vendors cv ON RIGHT(t.account_number, 4) = cv.last4_digits AND t.vendor = cv.card_vendor
                WHERE t.transaction_type = 'credit_card'
                  AND (
                    (t.processed_date >= CURRENT_DATE) 
                    OR 
                    (t.processed_date IS NULL AND t.date >= CURRENT_DATE)
                  )
                AND COALESCE(t.processed_date, t.date) <= CURRENT_DATE + INTERVAL '35 days'
            `)
        ]);

        const futureCCPayments = ccRes.rows;
        const cardBalances = {};
        futureCCPayments.forEach(cc => {
            const key = `${cc.vendor}-${cc.last4}`;
            cardBalances[key] = (cardBalances[key] || 0) + Math.abs(parseFloat(cc.price || 0));
        });

        const accounts = accountsRes.rows.map(row => {
            const isBank = BANK_VENDORS.includes(row.vendor);
            const last4 = row.account_number.slice(-4);
            const key = `${row.vendor}-${last4}`;
            const startingBalance = isBank ? parseFloat(row.balance || 0) : (cardBalances[key] || 0);

            const displayName = row.custom_bank_account_nickname || (isBank ? row.vendor_nickname : `${row.vendor_nickname || row.vendor} ..${last4}`);

            return {
                id: row.id,
                account_number: row.account_number,
                balance: startingBalance,
                nickname: displayName,
                credential_id: row.credential_id,
                is_bank: isBank,
                vendor: row.vendor
            };
        });

        const accountMetadata = {};
        accounts.forEach(acc => {
            accountMetadata[acc.account_number] = {
                nickname: acc.nickname,
                account_number: acc.account_number,
                credential_id: acc.credential_id,
                is_bank: acc.is_bank,
                vendor: acc.vendor
            };
        });

        // Rely only on manual recurring payments
        const allRecurring = [];

        // Process CC Data
        normalizeTransactionDates(futureCCPayments);

        // Generate Projection
        const projection = generateProjection(
            accounts,
            allRecurring,
            manualRes.rows,
            futureCCPayments,
            30
        );

        const summary = {
            startingBalance: accounts.reduce((sum, acc) => sum + (acc.is_bank ? acc.balance : -acc.balance), 0),
            endingBalance: projection.length > 0 ? projection[projection.length - 1].totalBalance : 0,
            periodDays: 30
        };

        res.status(200).json({
            summary,
            projection,
            accounts,
            accountMetadata
        });
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack }, "Error generating projection");
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        client.release();
    }
}
