#!/usr/bin/env node

/**
 * run-scenario-tests.js
 * Test suite to verify Nudlers MCP skills helper tools function correctly.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(SKILLS_DIR, 'scratch');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  console.log(`Running: ${name}...`);
  try {
    fn();
    console.log(`✅ Passed\n`);
    testsPassed++;
  } catch (error) {
    console.error(`❌ Failed: ${error.message}\n`);
    testsFailed++;
  }
}

// -------------------------------------------------------------
// 1. Test query-validator.js
// -------------------------------------------------------------
runTest('query-validator.js: valid billing cycle format', () => {
  const scriptPath = path.join(SKILLS_DIR, 'nudlers-data-access', 'tools', 'query-validator.js');
  const output = execSync(`node "${scriptPath}" --billing-cycle "2025-05"`, { encoding: 'utf8' });
  const result = JSON.parse(output);
  if (!result.valid) throw new Error('Expected validation to succeed');
});

runTest('query-validator.js: invalid billing cycle format', () => {
  const scriptPath = path.join(SKILLS_DIR, 'nudlers-data-access', 'tools', 'query-validator.js');
  try {
    execSync(`node "${scriptPath}" --billing-cycle "2025/05"`, { encoding: 'utf8', stdio: 'pipe' });
    throw new Error('Expected validation to fail');
  } catch (err) {
    const result = JSON.parse(err.stdout);
    if (result.valid) throw new Error('Expected valid: false');
    if (!result.errors.some(e => e.includes('Invalid billing-cycle format'))) {
      throw new Error('Expected billing-cycle format error message');
    }
  }
});

runTest('query-validator.js: valid transaction ID format', () => {
  const scriptPath = path.join(SKILLS_DIR, 'nudlers-data-access', 'tools', 'query-validator.js');
  const output = execSync(`node "${scriptPath}" --transaction-id "abcdef123|visaCal"`, { encoding: 'utf8' });
  const result = JSON.parse(output);
  if (!result.valid) throw new Error('Expected validation to succeed');
});

runTest('query-validator.js: invalid transaction ID format', () => {
  const scriptPath = path.join(SKILLS_DIR, 'nudlers-data-access', 'tools', 'query-validator.js');
  try {
    execSync(`node "${scriptPath}" --transaction-id "invalid-id-no-vendor"`, { encoding: 'utf8', stdio: 'pipe' });
    throw new Error('Expected validation to fail');
  } catch (err) {
    const result = JSON.parse(err.stdout);
    if (result.valid) throw new Error('Expected valid: false');
    if (!result.errors.some(e => e.includes('Invalid transaction-id'))) {
      throw new Error('Expected transaction ID error message');
    }
  }
});

// -------------------------------------------------------------
// 2. Test monthly-comparer.js
// -------------------------------------------------------------
runTest('monthly-comparer.js: MoM trend calculations and Hebrew formatting', () => {
  const scriptPath = path.join(SKILLS_DIR, 'nudlers-analyst-queries', 'tools', 'monthly-comparer.js');
  
  const currentPath = path.join(TEMP_DIR, 'mom_current.json');
  const previousPath = path.join(TEMP_DIR, 'mom_previous.json');
  
  const currentData = [
    { category: 'Dining', total: -1400 },
    { category: 'Groceries', total: -2000 },
    { category: 'Transportation', total: -600 }
  ];
  const previousData = [
    { category: 'Dining', total: -1100 },
    { category: 'Groceries', total: -2000 },
    { category: 'Transportation', total: -890 }
  ];
  
  fs.writeFileSync(currentPath, JSON.stringify(currentData), 'utf8');
  fs.writeFileSync(previousPath, JSON.stringify(previousData), 'utf8');
  
  const output = execSync(`node "${scriptPath}" --current "${currentPath}" --previous "${previousPath}"`, { encoding: 'utf8' });
  
  if (!output.includes('השוואה:')) throw new Error('Missing title');
  if (!output.includes('עלייה משמעותית:')) throw new Error('Missing significant increase section');
  if (!output.includes('Dining') && !output.includes('מסעדות')) {
    // Should contain the categories
    if (!output.includes('Dining')) throw new Error('Missing Dining category in comparison');
  }
  if (!output.includes('ירידה:')) throw new Error('Missing decrease section');
  if (!output.includes('ללא שינוי משמעותי:')) throw new Error('Missing no change section');
  if (!output.includes('סה"כ הוצאות:')) throw new Error('Missing total expenses sum');
  
  // Verify correct absolute calculations: 1400 vs 1100 (+300, +27%)
  if (!output.includes('300') || !output.includes('27%')) throw new Error('Incorrect math/percentage for Dining increase');
});

// -------------------------------------------------------------
// 3. Test budget-reporter.js
// -------------------------------------------------------------
runTest('budget-reporter.js: budget status grouping and Hebrew formatting', () => {
  const scriptPath = path.join(SKILLS_DIR, 'nudlers-analyst-budgets', 'tools', 'budget-reporter.js');
  const tempPath = path.join(TEMP_DIR, 'budget_data.json');
  
  const budgetData = {
    totalBudget: 10000,
    totalActual: 8400,
    categories: [
      { category: 'Dining', budget: 800, actual: 1100 },
      { category: 'Groceries', budget: 1000, actual: 920 },
      { category: 'Transportation', budget: 600, actual: 350 }
    ]
  };
  
  fs.writeFileSync(tempPath, JSON.stringify(budgetData), 'utf8');
  
  const output = execSync(`node "${scriptPath}" "${tempPath}"`, { encoding: 'utf8' });
  
  if (!output.includes('תקציב —')) throw new Error('Missing Hebrew title');
  if (!output.includes('🔴 חרגת:')) throw new Error('Missing over budget section');
  if (!output.includes('🟡 קרוב לגבול:')) throw new Error('Missing near limit section');
  if (!output.includes('✅ בסדר:')) throw new Error('Missing on track section');
  
  // Verify correct calculations
  if (!output.includes('138%') && !output.includes('137%')) throw new Error('Incorrect percentage for Dining overage');
  if (!output.includes('300')) throw new Error('Incorrect remaining value for Dining overage');
});

// -------------------------------------------------------------
// 4. Test sync-reporter.js
// -------------------------------------------------------------
runTest('sync-reporter.js: formats sync status and partial failures', () => {
  const scriptPath = path.join(SKILLS_DIR, 'nudlers-analyst-sync-cards', 'tools', 'sync-reporter.js');
  const tempPath = path.join(TEMP_DIR, 'sync_data.json');
  
  // Partial failure scenario
  const syncData = {
    accounts: [
      { nickname: 'בנק הפועלים', success: true },
      { nickname: 'כרטיס Max אשראי', success: false, error: 'פג תוקף חיבור' }
    ],
    summary: {
      newTransactionsCount: 15,
      updatedTransactionsCount: 3,
      durationSeconds: 42
    }
  };
  
  fs.writeFileSync(tempPath, JSON.stringify(syncData), 'utf8');
  
  const output = execSync(`node "${scriptPath}" "${tempPath}"`, { encoding: 'utf8' });
  
  if (!output.includes('שגיאות חלקיות')) throw new Error('Should warn about partial failures');
  if (!output.includes('בנק הפועלים: ✅')) throw new Error('Should show successful bank sync');
  if (!output.includes('כרטיס Max אשראי: ❌')) throw new Error('Should show failed card sync');
  if (!output.includes('פג תוקף חיבור')) throw new Error('Should display the specific error message');
  if (!output.includes('15') || !output.includes('3') || !output.includes('42')) throw new Error('Should include summary count statistics');
});

// Cleanup temp files
try {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
} catch (e) {}

console.log('-------------------------------------------------');
console.log(`Test Execution Completed: ${testsPassed} passed, ${testsFailed} failed.`);
if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
