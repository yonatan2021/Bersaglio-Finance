import 'dotenv/config';
import { getDB } from '../pages/api/db.js';
import { findReconciliationCandidates } from '../utils/reconciliation.js';

async function main() {
  const client = await getDB();
  try {
    console.log("Triggering reconciliation matching engine scan...");
    const result = await findReconciliationCandidates(client);
    console.log("Result:", result);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
