import 'dotenv/config';
import { getDB } from '../pages/api/db.js';

async function main() {
  const client = await getDB();
  try {
    console.log("=== Checking Vendor Credentials ===");
    const creds = await client.query(`
      SELECT id, vendor, nickname, bank_account_number, is_active FROM vendor_credentials
    `);
    for (const row of creds.rows) {
      console.log(`Cred ID: ${row.id}, Vendor: ${row.vendor}, Nickname: "${row.nickname}", BankAccount: "${row.bank_account_number}", Active: ${row.is_active}`);
    }

    console.log("\n=== Checking Card Ownerships ===");
    const cards = await client.query(`
      SELECT id, vendor, account_number, credential_id, linked_bank_account_id, custom_bank_account_number, custom_bank_account_nickname
      FROM card_ownership
    `);
    for (const row of cards.rows) {
      console.log(`Card ID: ${row.id}, Vendor: ${row.vendor}, AccNum: "${row.account_number}", CredID: ${row.credential_id}, LinkedBankID: ${row.linked_bank_account_id}, CustomNum: "${row.custom_bank_account_number}"`);
    }

    console.log("\n=== Checking Sample Bank Transactions ===");
    const bankTx = await client.query(`
      SELECT DISTINCT account_number, vendor FROM transactions WHERE transaction_type = 'bank' LIMIT 5
    `);
    for (const row of bankTx.rows) {
      console.log(`Bank Tx Account: "${row.account_number}", Vendor: ${row.vendor}`);
    }

    console.log("\n=== Checking Sample Credit Card Transactions ===");
    const ccTx = await client.query(`
      SELECT DISTINCT account_number, vendor FROM transactions WHERE transaction_type = 'credit_card' LIMIT 5
    `);
    for (const row of ccTx.rows) {
      console.log(`CC Tx Account: "${row.account_number}", Vendor: ${row.vendor}`);
    }

    console.log("\n=== Checking Reconciliations Table ===");
    const recs = await client.query(`
      SELECT id, bank_identifier, bank_vendor, cc_identifier, cc_vendor, status, confidence FROM transaction_reconciliations
    `);
    console.log(`Found ${recs.rows.length} rows in transaction_reconciliations.`);
    for (const row of recs.rows) {
      console.log(`Match ID: ${row.id}, Bank: ${row.bank_identifier} (${row.bank_vendor}), CC: ${row.cc_identifier} (${row.cc_vendor}), Status: ${row.status}, Conf: ${row.confidence}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
