import 'dotenv/config';
import { getDB } from '../pages/api/db.js';

async function main() {
  const client = await getDB();
  try {
    const prices = [278.41, 18.17, 329, 14];
    console.log("=== Checking Credit Card Transactions for specific prices ===");
    for (const price of prices) {
      console.log(`\nSearching for price: ${price} (absolute)`);
      const res = await client.query(`
        SELECT identifier, vendor, date, name, price, transaction_type, account_number
        FROM transactions
        WHERE ABS(price) = $1
      `, [price]);
      
      console.log(`Found ${res.rows.length} total transactions:`);
      for (const row of res.rows) {
        console.log(`   Type: ${row.transaction_type}, Vendor: ${row.vendor}, Date: ${row.date.toISOString().split('T')[0]}, Name: "${row.name}", Price: ${row.price}, Account: "${row.account_number}"`);
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
