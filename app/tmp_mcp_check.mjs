import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const client = new Client({ name: 'maya-finance-kanban', version: '1.0.0' }, { capabilities: {} });
const transport = new SSEClientTransport(new URL('http://localhost:6969/api/mcp'));
await client.connect(transport);

async function call(name, args={}) {
  try {
    const res = await client.callTool({ name, arguments: args });
    return { ok: true, result: res };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), stack: e?.stack };
  }
}

const calls = {
  sync: await call('get_sync_status'),
  vault: await call('get_vault_status'),
  accounts: await call('list_accounts'),
  balance: await call('get_balance_projection'),
  budgets: await call('get_budgets'),
  categoryCurrent: await call('get_category_breakdown'),
  categoryPrevious: await call('get_category_breakdown', { billingCycle: '2026-05' }),
  anomalies: await call('get_anomalies', { status: 'open' }),
  recurring: await call('get_recurring_payments'),
};
console.log(JSON.stringify(calls, null, 2));
await client.close();
