#!/usr/bin/env node

/**
 * budget-reporter.js
 * Formats budget vs actual data from Nudlers into the standard Hebrew layout.
 */

const fs = require('fs');

const PORT = process.env.PORT || '6969';
const API_BASE = process.env.NUDLERS_API_URL || `http://localhost:${PORT}/api`;

function printUsage() {
  console.log(`
Usage:
  node budget-reporter.js [billing_cycle_or_file]

Options:
  [billing_cycle_or_file]  Billing cycle (e.g. 2025-05) or path to budget-vs-actual JSON file
  --help                   Show this help message
`);
}

function formatCurrency(amount) {
  return `₪${Math.abs(amount).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function loadData(param) {
  if (!param) {
    const now = new Date();
    param = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Check if it's a file
  if (fs.existsSync(param)) {
    try {
      const content = fs.readFileSync(param, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      throw new Error(`Failed to parse file "${param}": ${e.message}`);
    }
  }

  // Check if it looks like a JSON string
  if (param.trim().startsWith('{')) {
    try {
      return JSON.parse(param);
    } catch (e) {}
  }

  // Fetch from API
  const url = `${API_BASE}/reports/budget-vs-actual?billingCycle=${param}`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  } catch (err) {
    throw new Error(`Failed to fetch from local API (${url}): ${err.message}. If Next.js isn't running, please pass a JSON file path.`);
  }
}

async function run() {
  const arg = process.argv[2];

  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  }

  try {
    const data = await loadData(arg);

    if (!data || !data.categories || data.categories.length === 0) {
      console.log('לא נמצאו נתוני תקציב עבור תקופה זו.');
      return;
    }

    const overBudget = [];
    const nearLimit = [];
    const onTrack = [];

    data.categories.forEach(cat => {
      const limit = Number(cat.budget) || 0;
      const actual = Number(cat.actual) || 0;
      const remaining = limit - actual;
      const percentage = limit > 0 ? Math.round((actual / limit) * 100) : 0;

      const item = {
        category: cat.category,
        limit,
        actual,
        remaining,
        percentage
      };

      if (percentage > 100) {
        overBudget.push(item);
      } else if (percentage >= 80) {
        nearLimit.push(item);
      } else {
        onTrack.push(item);
      }
    });

    const totalBudget = Number(data.totalBudget) || 0;
    const totalActual = Number(data.totalActual) || 0;
    const totalPercentage = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;

    let periodLabel = arg && !fs.existsSync(arg) ? arg : 'החודש הנוכחי';
    
    // Translate YYYY-MM to Hebrew Month Name if applicable
    const bcRegex = /^(\d{4})-(\d{2})$/;
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const match = periodLabel.match(bcRegex);
    if (match) {
      const year = match[1];
      const monthIdx = parseInt(match[2], 10) - 1;
      periodLabel = `${months[monthIdx]} ${year}`;
    }

    let markdown = `תקציב — ${periodLabel}\n\n`;

    if (overBudget.length > 0) {
      markdown += `🔴 חרגת:\n`;
      overBudget.forEach(item => {
        markdown += `• ${item.category}: ${formatCurrency(item.actual)} / ${formatCurrency(item.limit)} (${item.percentage}%) — חריגה של ${formatCurrency(Math.abs(item.remaining))}\n`;
      });
      markdown += `\n`;
    }

    if (nearLimit.length > 0) {
      markdown += `🟡 קרוב לגבול:\n`;
      nearLimit.forEach(item => {
        markdown += `• ${item.category}: ${formatCurrency(item.actual)} / ${formatCurrency(item.limit)} (${item.percentage}%) — נשאר ${formatCurrency(item.remaining)}\n`;
      });
      markdown += `\n`;
    }

    if (onTrack.length > 0) {
      markdown += `✅ בסדר:\n`;
      onTrack.forEach(item => {
        markdown += `• ${item.category}: ${formatCurrency(item.actual)} / ${formatCurrency(item.limit)} (${item.percentage}%)\n`;
      });
      markdown += `\n`;
    }

    markdown += `סה"כ: ${formatCurrency(totalActual)} / ${formatCurrency(totalBudget)} (${totalPercentage}%)`;

    console.log(markdown);
  } catch (error) {
    console.error('Error generating budget report:', error.message);
    process.exit(1);
  }
}

run();
