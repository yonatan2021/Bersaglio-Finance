import { getDB } from '../db';
import logger from '../../../utils/logger.js';
import { getAIClient, mapAIError } from '../../../utils/aiClient.js';

// Verify auth for AI chat endpoint.
// If NUDLERS_API_KEY is set, require it as Authorization header or ?apiKey query param.
// Otherwise, allow all requests (local-only mode).
function verifyAuth(req) {
  const requiredKey = process.env.NUDLERS_API_KEY;
  if (!requiredKey) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7) === requiredKey) {
    return true;
  }

  if (req.query?.apiKey === requiredKey) {
    return true;
  }

  return false;
}

const SYSTEM_PROMPT = `You are a smart financial analyst for "Bersaglio Fin" expense tracker. You have direct access to the user's transaction database through function calls.

CRITICAL RULES:
1. ALWAYS call functions to get real data before answering questions about spending, transactions, or finances
2. NEVER guess or make up numbers - always fetch actual data
3. After getting data, perform calculations and analysis yourself
4. Format amounts in ₪ (Israeli Shekel) with thousands separators
5. Be specific with numbers and dates from the actual data
6. If a query is unclear about dates, default to the current month

You have access to these tools:
- get_transactions: Get raw transaction list (filterable by date, category, search term)
- get_spending_by_category: Get spending breakdown by category
- get_monthly_comparison: Compare spending between months
- get_recurring_payments: Get subscriptions and installment plans
- get_top_merchants: Get biggest spending by merchant/vendor
- search_transactions: Search transactions by name/description

When analyzing data:
- Calculate totals, averages, and percentages yourself
- Identify patterns and anomalies
- Give actionable insights
- Use bullet points and bold for key numbers`;

// OpenAI-format tool definitions
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_transactions',
      description: 'Fetch transaction list from database. Use this for detailed transaction analysis, finding specific transactions, or when you need raw data to calculate.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to first day of current month.' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today.' },
          category: { type: 'string', description: "Filter by category name (e.g., 'Food', 'Transport'). Leave empty for all." },
          searchTerm: { type: 'string', description: "Search in transaction names (e.g., 'Netflix', 'Restaurant')" },
          limit: { type: 'number', description: 'Max transactions to return. Default 100, max 500.' },
          sortBy: { type: 'string', description: "Sort by 'amount' (largest first) or 'date' (newest first). Default: date" }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_spending_by_category',
      description: 'Get total spending grouped by category. Use this for category analysis, pie charts, or understanding where money goes.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_monthly_comparison',
      description: 'Compare spending between two months or periods. Use for trend analysis.',
      parameters: {
        type: 'object',
        properties: {
          month1: { type: 'string', description: 'First month (YYYY-MM)' },
          month2: { type: 'string', description: 'Second month (YYYY-MM)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recurring_payments',
      description: 'Get all recurring subscriptions and active installment plans. Use to show fixed monthly costs.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_top_merchants',
      description: 'Get spending grouped by merchant/store name. Use to find where most money is spent.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          limit: { type: 'number', description: 'Number of top merchants. Default 20.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_transactions',
      description: 'Search transactions by description. Use when user asks about specific merchant or type of spending.',
      parameters: {
        type: 'object',
        properties: {
          searchTerm: { type: 'string', description: 'Text to search for in transaction names' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' }
        },
        required: ['searchTerm']
      }
    }
  }
];

// Get default dates (current month)
function getDefaultDates() {
  const now = new Date();
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { startDate, endDate };
}

// Function implementations
async function getTransactions({ startDate, endDate, category, searchTerm, limit = 100, sortBy = 'date' }) {
  const db = await getDB();
  try {
    const defaults = getDefaultDates();
    const start = startDate || defaults.startDate;
    const end = endDate || defaults.endDate;
    limit = Math.min(limit, 500);

    let sql = `
      SELECT
        name,
        price,
        date,
        category,
        vendor,
        installments_number,
        installments_total
      FROM transactions
      WHERE date >= $1::date AND date <= $2::date
        AND category IS NOT NULL
        AND category != ''
    `;
    const params = [start, end];
    let paramIdx = 3;

    if (category) {
      sql += ` AND LOWER(category) = LOWER($${paramIdx})`;
      params.push(category);
      paramIdx++;
    }

    if (searchTerm) {
      sql += ` AND LOWER(name) LIKE LOWER($${paramIdx})`;
      params.push(`%${searchTerm}%`);
      paramIdx++;
    }

    sql += sortBy === 'amount'
      ? ` ORDER BY ABS(price) DESC`
      : ` ORDER BY date DESC`;
    sql += ` LIMIT $${paramIdx}`;
    params.push(limit);

    const result = await db.query(sql, params);

    const transactions = result.rows.map(r => ({
      name: r.name,
      amount: Math.abs(parseFloat(r.price)),
      date: r.date,
      category: r.category,
      vendor: r.vendor,
      installment: r.installments_total > 1 ? `${r.installments_number}/${r.installments_total}` : null
    }));

    const total = transactions.reduce((sum, t) => sum + t.amount, 0);

    return {
      transactions,
      count: transactions.length,
      totalAmount: Math.round(total),
      dateRange: { start, end },
      averageTransaction: transactions.length > 0 ? Math.round(total / transactions.length) : 0
    };
  } finally {
    db.release();
  }
}

async function getSpendingByCategory({ startDate, endDate }) {
  const db = await getDB();
  try {
    const defaults = getDefaultDates();
    const start = startDate || defaults.startDate;
    const end = endDate || defaults.endDate;

    const result = await db.query(`
      SELECT
        category,
        COUNT(*) as count,
        ABS(ROUND(SUM(price))) as total,
        ABS(ROUND(AVG(price))) as average
      FROM transactions
      WHERE date >= $1::date AND date <= $2::date
        AND category IS NOT NULL
        AND category != ''
        AND category != 'Bank'
        AND category != 'Income'
      GROUP BY category
      ORDER BY ABS(SUM(price)) DESC
    `, [start, end]);

    const categories = result.rows.map(r => ({
      category: r.category,
      transactionCount: parseInt(r.count, 10),
      totalSpent: parseFloat(r.total),
      averageTransaction: parseFloat(r.average)
    }));

    const grandTotal = categories.reduce((sum, c) => sum + c.totalSpent, 0);

    return {
      categories: categories.map(c => ({
        ...c,
        percentOfTotal: grandTotal > 0 ? Math.round((c.totalSpent / grandTotal) * 100) : 0
      })),
      totalSpending: Math.round(grandTotal),
      dateRange: { start, end },
      categoryCount: categories.length
    };
  } finally {
    db.release();
  }
}

async function getMonthlyComparison({ month1, month2 }) {
  const db = await getDB();
  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

    const m1 = month1 || currentMonth;
    const m2 = month2 || previousMonth;

    const result = await db.query(`
      SELECT
        TO_CHAR(date, 'YYYY-MM') as month,
        category,
        ABS(ROUND(SUM(price))) as total
      FROM transactions
      WHERE TO_CHAR(date, 'YYYY-MM') IN ($1, $2)
        AND category IS NOT NULL
        AND category != ''
        AND category != 'Bank'
        AND category != 'Income'
      GROUP BY TO_CHAR(date, 'YYYY-MM'), category
      ORDER BY month, ABS(SUM(price)) DESC
    `, [m1, m2]);

    const month1Data = { total: 0, categories: {} };
    const month2Data = { total: 0, categories: {} };

    for (const row of result.rows) {
      const amount = parseFloat(row.total);
      if (row.month === m1) {
        month1Data.total += amount;
        month1Data.categories[row.category] = amount;
      } else {
        month2Data.total += amount;
        month2Data.categories[row.category] = amount;
      }
    }

    const allCategories = [...new Set([...Object.keys(month1Data.categories), ...Object.keys(month2Data.categories)])];
    const categoryComparison = allCategories.map(cat => ({
      category: cat,
      month1Amount: month1Data.categories[cat] || 0,
      month2Amount: month2Data.categories[cat] || 0,
      difference: (month1Data.categories[cat] || 0) - (month2Data.categories[cat] || 0)
    })).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

    return {
      month1: { month: m1, totalSpending: Math.round(month1Data.total) },
      month2: { month: m2, totalSpending: Math.round(month2Data.total) },
      difference: Math.round(month1Data.total - month2Data.total),
      percentChange: month2Data.total > 0
        ? Math.round(((month1Data.total - month2Data.total) / month2Data.total) * 100)
        : 0,
      categoryComparison: categoryComparison.slice(0, 10)
    };
  } finally {
    db.release();
  }
}

async function getRecurringPayments() {
  const db = await getDB();
  try {
    const installmentsResult = await db.query(`
      WITH latest AS (
        SELECT
          name, price, category,
          installments_number, installments_total,
          date,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(name)), ABS(price)
            ORDER BY date DESC
          ) as rn
        FROM transactions
        WHERE installments_total > 1
      )
      SELECT * FROM latest WHERE rn = 1
      ORDER BY ABS(price) DESC
    `);

    const recurringResult = await db.query(`
      SELECT
        name,
        ABS(price) as amount,
        category,
        COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) as month_count,
        MAX(date) as last_date
      FROM transactions
      WHERE price < 0
        AND (installments_total IS NULL OR installments_total <= 1)
        AND category NOT IN ('Bank', 'Income')
      GROUP BY LOWER(TRIM(name)), ABS(price), name, category
      HAVING COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) >= 2
      ORDER BY ABS(price) DESC
      LIMIT 30
    `);

    const installments = installmentsResult.rows
      .filter(r => r.installments_number < r.installments_total)
      .map(r => ({
        name: r.name,
        monthlyAmount: Math.abs(parseFloat(r.price)),
        category: r.category,
        progress: `${r.installments_number}/${r.installments_total}`,
        remainingPayments: r.installments_total - r.installments_number,
        remainingTotal: Math.abs(parseFloat(r.price)) * (r.installments_total - r.installments_number)
      }));

    const subscriptions = recurringResult.rows.map(r => ({
      name: r.name,
      monthlyAmount: parseFloat(r.amount),
      category: r.category,
      frequency: r.month_count >= 6 ? 'Monthly' : 'Recurring',
      lastCharge: r.last_date
    }));

    const totalMonthlyInstallments = installments.reduce((sum, i) => sum + i.monthlyAmount, 0);
    const totalMonthlySubscriptions = subscriptions.reduce((sum, s) => sum + s.monthlyAmount, 0);

    return {
      installments,
      subscriptions,
      totalMonthlyFixed: Math.round(totalMonthlyInstallments + totalMonthlySubscriptions),
      installmentCount: installments.length,
      subscriptionCount: subscriptions.length
    };
  } finally {
    db.release();
  }
}

async function getTopMerchants({ startDate, endDate, limit = 20 }) {
  const db = await getDB();
  try {
    const defaults = getDefaultDates();
    const start = startDate || defaults.startDate;
    const end = endDate || defaults.endDate;

    const result = await db.query(`
      SELECT
        name as merchant,
        category,
        COUNT(*) as transaction_count,
        ABS(ROUND(SUM(price))) as total_spent,
        ABS(ROUND(AVG(price))) as avg_transaction
      FROM transactions
      WHERE date >= $1::date AND date <= $2::date
        AND category IS NOT NULL
        AND category != ''
        AND category != 'Bank'
      GROUP BY name, category
      ORDER BY ABS(SUM(price)) DESC
      LIMIT $3
    `, [start, end, limit]);

    return {
      merchants: result.rows.map(r => ({
        merchant: r.merchant,
        category: r.category,
        transactionCount: parseInt(r.transaction_count, 10),
        totalSpent: parseFloat(r.total_spent),
        averageAmount: parseFloat(r.avg_transaction)
      })),
      dateRange: { start, end }
    };
  } finally {
    db.release();
  }
}

async function searchTransactions({ searchTerm, startDate, endDate }) {
  const db = await getDB();
  try {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const start = startDate || sixMonthsAgo.toISOString().split('T')[0];
    const end = endDate || now.toISOString().split('T')[0];

    const result = await db.query(`
      SELECT
        name, price, date, category, vendor
      FROM transactions
      WHERE date >= $1::date AND date <= $2::date
        AND LOWER(name) LIKE LOWER($3)
      ORDER BY date DESC
      LIMIT 50
    `, [start, end, `%${searchTerm}%`]);

    const transactions = result.rows.map(r => ({
      name: r.name,
      amount: Math.abs(parseFloat(r.price)),
      date: r.date,
      category: r.category
    }));

    return {
      searchTerm,
      matches: transactions,
      matchCount: transactions.length,
      totalAmount: Math.round(transactions.reduce((sum, t) => sum + t.amount, 0)),
      dateRange: { start, end }
    };
  } finally {
    db.release();
  }
}

async function executeFunction(name, args) {
  logger.info({ functionName: name, args }, 'Executing function');
  switch (name) {
    case 'get_transactions': return await getTransactions(args || {});
    case 'get_spending_by_category': return await getSpendingByCategory(args || {});
    case 'get_monthly_comparison': return await getMonthlyComparison(args || {});
    case 'get_recurring_payments': return await getRecurringPayments();
    case 'get_top_merchants': return await getTopMerchants(args || {});
    case 'search_transactions': return await searchTransactions(args || {});
    default: return { error: `Unknown function: ${name}` };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = await getDB();

  try {
    const { message, context, sessionId } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Resolve provider config
    let openai, model;
    try {
      ({ openai, model } = await getAIClient());
    } catch (e) {
      if (e.code === 'AI_API_KEY_MISSING') {
        return res.status(500).json({ error: e.message });
      }
      throw e;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let currentSessionId = sessionId;

    if (!currentSessionId) {
      const sessionResult = await db.query(
        'INSERT INTO chat_sessions (title) VALUES ($1) RETURNING id',
        [message.substring(0, 60)]
      );
      currentSessionId = sessionResult.rows[0].id;
    } else {
      await db.query('UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [currentSessionId]);
    }

    await db.query(
      'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
      [currentSessionId, 'user', message]
    );

    sendEvent({ status: 'session_assigned', sessionId: currentSessionId });

    // Fetch prior history (most recent 50, chronological)
    const historyResult = await db.query(
      `SELECT role, content FROM (
        SELECT id, role, content FROM chat_messages
        WHERE session_id = $1 AND role != 'system'
        ORDER BY id DESC LIMIT 50
      ) AS sub ORDER BY id ASC`,
      [currentSessionId]
    );

    // Build context appended to system prompt
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let contextInfo = `\nToday is ${todayStr}.`;
    if (context?.view) contextInfo += ` User is viewing: ${context.view}.`;
    if (context?.dateRange) {
      contextInfo += ` Current date range filter: ${context.dateRange.startDate} to ${context.dateRange.endDate}.`;
    }

    // Build OpenAI message array. The last row in historyResult is the user message we just saved.
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + contextInfo }
    ];
    for (const r of historyResult.rows) {
      if (!r.content || r.content.trim() === '') continue;
      const role = r.role === 'assistant' ? 'assistant' : 'user';
      messages.push({ role, content: r.content });
    }

    sendEvent({ status: 'thinking', model });

    let fullText = '';
    let iterationCount = 0;
    const MAX_ITERATIONS = 5;

    // Streaming + tool-call loop
    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      let stream;
      try {
        stream = await openai.chat.completions.create({
          model,
          messages,
          tools,
          temperature: 0.2,
          max_tokens: 2000,
          stream: true
        });
      } catch (err) {
        logger.error({ error: err.message, status: err.status }, 'AI request failed');
        throw err;
      }

      // Assemble streamed deltas: text chunks accumulate into fullText, tool_calls accumulate by index.
      const toolCallAccum = new Map(); // index -> { id, name, args (string) }
      let assistantText = '';

      try {
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};

          if (delta.content) {
            assistantText += delta.content;
            fullText += delta.content;
            sendEvent({ status: 'streaming', text: fullText, done: false });
            if (res.flush) res.flush();
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallAccum.get(idx) || { id: '', name: '', args: '' };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
              toolCallAccum.set(idx, existing);
            }
          }
        }
      } catch (streamErr) {
        logger.error({ error: streamErr.message }, 'Stream iteration failed');
        if (fullText) break;
        throw streamErr;
      }

      // No tool calls → done
      if (toolCallAccum.size === 0) {
        break;
      }

      // Materialize the assistant turn (with tool_calls) and execute each call.
      // Some non-spec providers may omit `id` — synthesize one so tool_call_id is stable.
      const toolCalls = Array.from(toolCallAccum.entries())
        .sort(([a], [b]) => a - b)
        .map(([idx, tc]) => ({
          id: tc.id || `call_${currentSessionId}_${iterationCount}_${idx}`,
          type: 'function',
          function: { name: tc.name, arguments: tc.args || '{}' }
        }));

      messages.push({
        role: 'assistant',
        content: assistantText || null,
        tool_calls: toolCalls
      });

      logger.info({ count: toolCalls.length, names: toolCalls.map(t => t.function.name) }, 'Received tool calls');

      sendEvent({
        status: 'fetching_data',
        functions: toolCalls.map(t => t.function.name),
        message: `Analyzing: ${toolCalls.map(t => t.function.name.replace(/_/g, ' ')).join(', ')}...`
      });

      for (const tc of toolCalls) {
        let parsedArgs;
        let parseError = null;
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch (e) {
          parseError = e.message;
          logger.warn({ name: tc.function.name, args: tc.function.arguments, err: e.message }, 'Failed to parse tool args');
        }

        let toolResult;
        if (parseError) {
          // Surface parse error to the model so it can retry with valid JSON
          toolResult = { error: `Invalid JSON arguments: ${parseError}` };
        } else {
          try {
            toolResult = await executeFunction(tc.function.name, parsedArgs);
          } catch (err) {
            logger.error({ functionName: tc.function.name, error: err.message }, 'Function execution error');
            toolResult = { error: err.message };
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult)
        });
      }
      // Loop continues — model now has tool results and will produce final text or more tool calls.
    }

    if (iterationCount >= MAX_ITERATIONS) {
      logger.warn('AI reached max tool call iterations');
      sendEvent({
        status: 'streaming',
        text: fullText + '\n\n*(Note: I reached my limit of analysis steps for this request. Please ask for more details if needed.)*',
        done: false
      });
    }

    if (!fullText) {
      fullText = "I couldn't generate a response. Please try rephrasing your question.";
    }

    await db.query(
      'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
      [currentSessionId, 'assistant', fullText]
    );

    sendEvent({
      status: 'complete',
      text: fullText,
      done: true,
      model,
      sessionId: currentSessionId
    });
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'AI Chat Error');
    if (res.writableEnded) return;

    const userMessage = mapAIError(error, 'AI');

    if (!res.headersSent) {
      return res.status(500).json({ error: userMessage });
    }

    try {
      res.write(`data: ${JSON.stringify({ error: userMessage, status: 'error' })}\n\n`);
    } catch (e) {
      logger.debug({ error: e.message }, 'Failed to send SSE error event (client likely disconnected)');
    }
  } finally {
    db.release();
  }

  res.end();
}

export const config = { api: { bodyParser: true } };
