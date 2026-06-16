import 'dotenv/config';
import { getDB } from '../pages/api/db.js';

async function main() {
  const client = await getDB();
  try {
    console.log("=== Debugging Unmatched Bank Debit Transactions ===");
    const bankRes = await client.query(`
      SELECT identifier, vendor, date, name, price, account_number, transaction_type
      FROM transactions
      WHERE transaction_type = 'bank'
        AND price < 0
        AND date >= CURRENT_DATE - INTERVAL '120 days'
        AND (
          name ILIKE '%דביט%' 
          OR name ILIKE '%חיוב מידי%' 
          OR name ILIKE '%ויזה-דביט%'
          OR name ILIKE '%דירקט%'
          OR name ILIKE '%כרטיסי אשראי%'
        )
      ORDER BY date DESC
      LIMIT 15
    `);

    console.log(`Found ${bankRes.rows.length} bank transactions matching keywords.`);
    for (const bank of bankRes.rows) {
      console.log(`\nBank Tx: Date=${bank.date.toISOString().split('T')[0]}, Name="${bank.name}", Price=${bank.price}, Vendor=${bank.vendor}`);
      
      // Look for credit card transactions with a close price
      const ccRes = await client.query(`
        SELECT identifier, vendor, date, name, price, account_number
        FROM transactions
        WHERE transaction_type = 'credit_card'
          AND price < 0
          AND ABS(ABS(price) - ABS($1)) < 0.05
          AND date >= $2::date - INTERVAL '7 days'
          AND date <= $2::date + INTERVAL '7 days'
        ORDER BY date DESC
      `, [bank.price, bank.date]);

      if (ccRes.rows.length === 0) {
        console.log("  -> No matching Credit Card transactions found within 7 days and close price.");
      } else {
        console.log(`  -> Found ${ccRes.rows.length} candidate CC transactions:`);
        for (const cc of ccRes.rows) {
          const dateDiff = Math.abs(new Date(cc.date).getTime() - new Date(bank.date).getTime()) / (1000 * 60 * 60 * 24);
          console.log(`     CC: Date=${cc.date.toISOString().split('T')[0]} (Diff: ${dateDiff.toFixed(1)} days), Name="${cc.name}", Price=${cc.price}, Vendor=${cc.vendor}`);
        }
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
