import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  user: process.env.NUDLERS_DB_USER,
  host: process.env.NUDLERS_DB_HOST,
  database: process.env.NUDLERS_DB_NAME,
  password: process.env.NUDLERS_DB_PASSWORD,
  port: process.env.NUDLERS_DB_PORT ? parseInt(process.env.NUDLERS_DB_PORT, 10) : 5432,
  ssl: false,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("=== Finding duplicates ===");
    // Find all duplicate pairs where:
    // - t1 has a real ID (length != 40)
    // - t2 has a hashed ID (length = 40)
    // - same vendor, same account number, same price, same name, date diff <= 2 days
    const findQuery = `
      SELECT 
        t1.identifier as real_id, t1.date as real_date, t1.name as real_name, t1.price as real_price, t1.account_number as real_acc,
        t2.identifier as hashed_id, t2.date as hashed_date, t2.name as hashed_name, t2.price as hashed_price, t2.account_number as hashed_acc
      FROM transactions t1
      JOIN transactions t2 ON t1.price = t2.price 
        AND LOWER(TRIM(t1.name)) = LOWER(TRIM(t2.name))
        AND t1.vendor = t2.vendor
        AND RIGHT(t1.account_number, 4) = RIGHT(t2.account_number, 4)
        AND LENGTH(t2.identifier) = 40
        AND LENGTH(t1.identifier) != 40
        AND ABS(t1.date - t2.date) <= 2
    `;

    const duplicates = await client.query(findQuery);
    console.log(`Found ${duplicates.rows.length} duplicate pairs to clean up.`);

    if (duplicates.rows.length > 0) {
      const idsToDelete = duplicates.rows.map(d => d.hashed_id);
      
      console.log("Deleting duplicate hashed transactions...");
      const deleteResult = await client.query(
        `DELETE FROM transactions WHERE identifier = ANY($1)`,
        [idsToDelete]
      );
      console.log(`Successfully deleted ${deleteResult.rowCount} duplicate transactions.`);
    } else {
      console.log("No duplicate transactions found to clean up.");
    }
  } catch (err) {
    console.error("Error during cleanup:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
