import 'dotenv/config';
import { runMigrations } from '../pages/api/migrate.js';

async function main() {
  console.log("Running migrations...");
  const result = await runMigrations();
  console.log("Migration result:", JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error("Migration execution failed:", err);
  process.exit(1);
});
