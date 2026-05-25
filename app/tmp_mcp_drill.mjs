import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
const client = new Client({ name: 'maya-finance-drilldown', version: '1.0.0' }, { capabilities: {} });
await client.connect(new SSEClientTransport(new URL('http://localhost:6969/api/mcp')));
async function call(name, args={}) { try { return { ok:true, result: await client.callTool({ name, arguments: args }) }; } catch(e) { return { ok:false, error:String(e?.message||e) }; }}
const out = {
  shonot: await call('get_category_expenses', { category: 'שונות', limit: 10 }),
  transfers: await call('get_category_expenses', { category: 'העברות', limit: 10 }),
  all: await call('get_all_transactions', { limit: 30 }),
  summaryByCard: await call('get_monthly_summary', { groupBy: 'last4digits' }),
};
console.log(JSON.stringify(out, null, 2));
await client.close();
