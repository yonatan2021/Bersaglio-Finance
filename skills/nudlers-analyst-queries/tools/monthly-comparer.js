#!/usr/bin/env node

/**
 * monthly-comparer.js
 * Compares spending breakdowns between two periods and formats a Hebrew report.
 */

const fs = require('fs');

const PORT = process.env.PORT || '6969';
const API_BASE = process.env.NUDLERS_API_URL || `http://localhost:${PORT}/api`;

function printUsage() {
  console.log(`
Usage:
  node monthly-comparer.js --current <cycle_or_file> --previous <cycle_or_file>

Options:
  --current <cycle_or_file>   Current cycle (e.g. 2025-05) or path to category JSON file
  --previous <cycle_or_file>  Previous cycle (e.g. 2025-04) or path to category JSON file
  --help                      Show this help message
`);
}

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = process.argv[i + 1];
      if (val && !val.startsWith('--')) {
        args[key] = val;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function formatCurrency(amount) {
  return `₪${Math.abs(amount).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function loadData(param) {
  if (!param) {
    throw new Error('Missing parameter');
  }

  // Check if it's a file
  if (fs.existsSync(param)) {
    try {
      const content = fs.readFileSync(param, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : (parsed.items || []);
    } catch (e) {
      throw new Error(`Failed to parse file "${param}": ${e.message}`);
    }
  }

  // Check if it looks like a JSON string
  if (param.trim().startsWith('[') || param.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(param);
      return Array.isArray(parsed) ? parsed : (parsed.items || []);
    } catch (e) {}
  }

  // Fetch from API
  const url = `${API_BASE}/reports/monthly-summary?billingCycle=${param}&groupBy=category`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    throw new Error(`Failed to fetch from local API (${url}): ${err.message}. If Next.js isn't running, please pass a JSON file path.`);
  }
}

async function run() {
  const args = parseArgs();

  if (!args.current || !args.previous) {
    console.error('Error: Both --current and --previous parameters are required.');
    printUsage();
    process.exit(1);
  }

  try {
    const currentData = await loadData(args.current);
    const previousData = await loadData(args.previous);

    // Normalize: map category -> absolute amount (since we compare absolute spending)
    const getExpensesMap = (data) => {
      const map = {};
      data.forEach(item => {
        const cat = item.category || 'Uncategorized';
        const total = Number(item.total) || 0;
        // Focus on expenses (negative values)
        if (total < 0) {
          map[cat] = Math.abs(total);
        }
      });
      return map;
    };

    const currentExpenses = getExpensesMap(currentData);
    const previousExpenses = getExpensesMap(previousData);

    const allCategories = Array.from(new Set([
      ...Object.keys(currentExpenses),
      ...Object.keys(previousExpenses)
    ]));

    const comparisons = [];
    let currentTotal = 0;
    let previousTotal = 0;

    allCategories.forEach(cat => {
      const curVal = currentExpenses[cat] || 0;
      const prevVal = previousExpenses[cat] || 0;

      currentTotal += curVal;
      previousTotal += prevVal;

      const diff = curVal - prevVal;
      const percentChange = prevVal > 0 ? (diff / prevVal) * 100 : (diff > 0 ? 100 : 0);

      comparisons.push({
        category: cat,
        current: curVal,
        previous: prevVal,
        diff,
        percentChange
      });
    });

    // Sort: highest current spending first
    comparisons.sort((a, b) => b.current - a.current);

    const significantIncrease = [];
    const decrease = [];
    const noChange = [];

    comparisons.forEach(item => {
      // Significant increase if > 20% and diff > ₪50 (to ignore tiny fluctuations)
      if (item.percentChange >= 20 && item.diff >= 50) {
        significantIncrease.push(item);
      } else if (item.diff <= -50 && item.percentChange <= -20) {
        decrease.push(item);
      } else {
        noChange.push(item);
      }
    });

    const totalDiff = currentTotal - previousTotal;
    const totalPercentChange = previousTotal > 0 ? (totalDiff / previousTotal) * 100 : 0;

    const currentLabel = fs.existsSync(args.current) ? 'החודש' : args.current;
    const previousLabel = fs.existsSync(args.previous) ? 'חודש שעבר' : args.previous;

    let markdown = `השוואה: ${currentLabel} vs. ${previousLabel}\n\n`;

    if (significantIncrease.length > 0) {
      markdown += `📈 עלייה משמעותית:\n`;
      significantIncrease.forEach(item => {
        markdown += `• ${item.category}: ${formatCurrency(item.current)} ← ${formatCurrency(item.previous)} (+${formatCurrency(item.diff)}, +${Math.round(item.percentChange)}%) ⚠️\n`;
      });
      markdown += `\n`;
    }

    if (decrease.length > 0) {
      markdown += `📉 ירידה:\n`;
      decrease.forEach(item => {
        markdown += `• ${item.category}: ${formatCurrency(item.current)} ← ${formatCurrency(item.previous)} (-${formatCurrency(item.diff)}, ${Math.round(item.percentChange)}%)\n`;
      });
      markdown += `\n`;
    }

    if (noChange.length > 0) {
      markdown += `➡️ ללא שינוי משמעותי:\n`;
      noChange.forEach(item => {
        const sign = item.diff >= 0 ? '+' : '-';
        const percentSign = item.diff >= 0 ? '+' : '';
        markdown += `• ${item.category}: ${formatCurrency(item.current)} ← ${formatCurrency(item.previous)} (${sign}${formatCurrency(item.diff)}, ${percentSign}${Math.round(item.percentChange)}%)\n`;
      });
      markdown += `\n`;
    }

    const totalSign = totalDiff >= 0 ? '+' : '-';
    const totalPercentSign = totalDiff >= 0 ? '+' : '';
    markdown += `סה"כ הוצאות: ${formatCurrency(currentTotal)} ← ${formatCurrency(previousTotal)} (${totalSign}${formatCurrency(totalDiff)}, ${totalPercentSign}${Math.round(totalPercentChange)}%)`;

    console.log(markdown);
  } catch (error) {
    console.error('Error running MoM comparison:', error.message);
    process.exit(1);
  }
}

run();
