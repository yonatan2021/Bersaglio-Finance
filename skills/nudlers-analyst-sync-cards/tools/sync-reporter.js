#!/usr/bin/env node

/**
 * sync-reporter.js
 * Formats sync results and handles partial failures for Nudlers scrapers.
 */

const fs = require('fs');

const PORT = process.env.PORT || '6969';
const API_BASE = process.env.NUDLERS_API_URL || `http://localhost:${PORT}/api`;

function printUsage() {
  console.log(`
Usage:
  node sync-reporter.js [sync_json_or_file]

Options:
  [sync_json_or_file]  Path to a JSON file containing sync output, or a JSON string.
  --help               Show this help message
`);
}

async function loadData(param) {
  if (!param) {
    // If no param, try fetching the last sync status from Nudlers
    const url = `${API_BASE}/scrapers/status`;
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      return await res.json();
    } catch (err) {
      throw new Error(`Failed to fetch status from ${url}: ${err.message}. Please pass a JSON file path.`);
    }
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

  throw new Error(`Invalid argument: "${param}". Must be a valid JSON string or file path.`);
}

function run() {
  const arg = process.argv[2];

  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  }

  try {
    loadData(arg).then(data => {
      if (!data) {
        console.log('לא נמצאו נתוני סינכרון.');
        return;
      }

      // Check if this is the SSE result or a standard scrape status response
      let accounts = [];
      let summary = {};

      if (data.accounts && Array.isArray(data.accounts)) {
        accounts = data.accounts;
        summary = data.summary || {};
      } else if (Array.isArray(data)) {
        // Assume array of account statuses
        accounts = data;
      } else if (data.status && typeof data.status === 'object') {
        // Handle last status format
        accounts = Object.keys(data.status).map(key => ({
          nickname: key,
          success: data.status[key].success,
          error: data.status[key].error
        }));
      }

      const succeeded = accounts.filter(a => a.success);
      const failed = accounts.filter(a => !a.success);

      let markdown = '';

      if (failed.length === 0 && accounts.length > 0) {
        markdown += `✅ הסינכרון הושלם בהצלחה עבור כל החשבונות!\n\n`;
      } else if (succeeded.length > 0 && failed.length > 0) {
        markdown += `⚠️ סנכרון הושלם עם שגיאות חלקיות:\n`;
      } else {
        markdown += `❌ סנכרון החשבונות נכשל:\n`;
      }

      accounts.forEach(acc => {
        const name = acc.nickname || acc.name || `חשבון`;
        if (acc.success) {
          markdown += `• ${name}: ✅ סונכרן בהצלחה\n`;
        } else {
          markdown += `• ${name}: ❌ נכשל (פירוט השגיאה: ${acc.error || 'שגיאה לא ידועה'})\n`;
        }
      });

      markdown += `\n📋 נתוני סינכרון:\n`;
      markdown += `• עסקאות חדשות שנשמרו: ${summary.newTransactionsCount !== undefined ? summary.newTransactionsCount : (data.newTransactions || 0)}\n`;
      markdown += `• עסקאות שעודכנו: ${summary.updatedTransactionsCount !== undefined ? summary.updatedTransactionsCount : (data.updatedTransactions || 0)}\n`;
      if (summary.durationSeconds || data.duration) {
        markdown += `• משך הסינכרון: ${summary.durationSeconds || data.duration} שניות\n`;
      }

      console.log(markdown);
    }).catch(err => {
      console.error('Error generating sync report:', err.message);
      process.exit(1);
    });
  } catch (error) {
    console.error('Error in sync-reporter:', error.message);
    process.exit(1);
  }
}

run();
