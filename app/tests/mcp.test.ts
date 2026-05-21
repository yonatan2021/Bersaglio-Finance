import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../pages/api/mcp';
import { EventEmitter } from 'events';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Response class to capture SSE stream and standard responses
class MockResponse extends EventEmitter {
    statusCode = 200;
    headers: Record<string, string | string[]> = {};
    body = '';
    chunks: string[] = [];
    finished = false;

    status(code: number) {
        this.statusCode = code;
        return this;
    }

    setHeader(name: string, value: string | string[]) {
        this.headers[name.toLowerCase()] = value;
        return this;
    }

    getHeader(name: string) {
        return this.headers[name.toLowerCase()];
    }

    writeHead(code: number, headers?: any) {
        this.statusCode = code;
        if (headers) {
            for (const [key, value] of Object.entries(headers)) {
                this.headers[key.toLowerCase()] = value as string;
            }
        }
        return this;
    }

    write(chunk: any) {
        const str = chunk.toString();
        this.chunks.push(str);
        this.body += str;
        return true;
    }

    end(chunk?: any) {
        if (chunk) {
            this.write(chunk);
        }
        this.finished = true;
        this.emit('finish');
        return this;
    }

    // Next.js specific
    send(body: any) {
        this.write(body);
        this.end();
        return this;
    }
}

// Mock Request class
class MockRequest extends EventEmitter {
    method: string;
    url: string;
    query: Record<string, string> = {};
    body: any = {};
    headers: Record<string, string> = {};

    constructor(method: string, url: string) {
        super();
        this.method = method;
        this.url = url;
    }
}

describe('MCP Server API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(''),
            json: () => Promise.resolve({})
        } as Response);
    });

    it('should establish an SSE connection on GET', async () => {
        const req = new MockRequest('GET', '/api/mcp');
        const res = new MockResponse();
        (res as any).socket = {
            setTimeout: vi.fn(),
            setNoDelay: vi.fn(),
            setKeepAlive: vi.fn(),
        };
        (res as any).flush = vi.fn();

        // Emit close after some time to let the handler finish
        setTimeout(() => req.emit('close'), 200);

        await handler(req, res);

        // Expect SSE headers
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['cache-control']).toContain('no-cache');
        expect(res.headers['connection']).toBe('keep-alive');

        const output = res.body;
        expect(output).toContain('event: endpoint');
        expect(output).toContain('/api/mcp?sessionId=');
    });

    it('should handle POST messages for tools', async () => {
        const initReq = new MockRequest('GET', '/api/mcp');
        const initRes = new MockResponse();
        (initRes as any).socket = {
            setTimeout: vi.fn(),
            setNoDelay: vi.fn(),
            setKeepAlive: vi.fn(),
        };

        // Start GET handler in background
        const handlerPromise = handler(initReq, initRes);

        await new Promise(resolve => setTimeout(resolve, 100));

        const match = initRes.body.match(/sessionId=([a-zA-Z0-9-]+)/);
        expect(match).toBeTruthy();
        const sessionId = match![1];

        const postReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        postReq.query = { sessionId };
        postReq.headers = { 'content-type': 'application/json' };

        postReq.body = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0.0" }
            }
        };

        const postRes = new MockResponse();
        setTimeout(() => {
            postReq.emit('data', Buffer.from(JSON.stringify(postReq.body)));
            postReq.emit('end');
        }, 10);

        await handler(postReq, postRes);
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(postRes.statusCode).toBeLessThan(300);
        expect(initRes.body).toContain('serverInfo');
        expect(initRes.body).toContain('nudlers');

        // Cleanup
        initReq.emit('close');
        await handlerPromise;
    });

    it('should list available tools', async () => {
        // 1. Establish connection
        const initReq = new MockRequest('GET', '/api/mcp');
        const initRes = new MockResponse();
        (initRes as any).socket = {
            setTimeout: vi.fn(),
            setNoDelay: vi.fn(),
            setKeepAlive: vi.fn(),
        };
        const handlerPromise = handler(initReq, initRes);
        await new Promise(resolve => setTimeout(resolve, 100));

        const match = initRes.body.match(/sessionId=([a-zA-Z0-9-]+)/);
        const sessionId = match![1];

        // 2. Initialize
        const valReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        valReq.query = { sessionId };
        valReq.headers = { 'content-type': 'application/json' };
        valReq.body = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0.0" }
            }
        };
        setTimeout(() => {
            valReq.emit('data', Buffer.from(JSON.stringify(valReq.body)));
            valReq.emit('end');
        }, 10);

        const valRes = new MockResponse();
        await handler(valReq, valRes);
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(valRes.statusCode).toBeLessThan(300);

        // 3. List Tools
        const postReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        postReq.query = { sessionId };
        postReq.headers = { 'content-type': 'application/json' };
        postReq.body = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {}
        };

        setTimeout(() => {
            postReq.emit('data', Buffer.from(JSON.stringify(postReq.body)));
            postReq.emit('end');
        }, 10);

        const postRes = new MockResponse();
        await handler(postReq, postRes);

        await new Promise(resolve => setTimeout(resolve, 1000));
        expect(postRes.statusCode).toBeLessThan(300);

        // Verify all expected tools are in the output stream
        expect(initRes.body).toContain('get_monthly_summary');
        expect(initRes.body).toContain('get_category_expenses');
        expect(initRes.body).toContain('get_all_categories');
        expect(initRes.body).toContain('search_transactions');
        expect(initRes.body).toContain('get_budgets');
        expect(initRes.body).toContain('get_sync_status');
        expect(initRes.body).toContain('get_recurring_payments');
        expect(initRes.body).toContain('list_accounts');
        expect(initRes.body).toContain('get_all_transactions');
        expect(initRes.body).toContain('add_manual_expense');
        expect(initRes.body).toContain('get_category_breakdown');
        expect(initRes.body).toContain('get_balance_projection');

        // Verify the 15 new secure/management tools are also listed
        expect(initRes.body).toContain('trigger_full_sync');
        expect(initRes.body).toContain('get_vault_status');
        expect(initRes.body).toContain('get_anomalies');
        expect(initRes.body).toContain('trigger_anomaly_evaluation');
        expect(initRes.body).toContain('update_anomaly_status');
        expect(initRes.body).toContain('set_category_budget');
        expect(initRes.body).toContain('set_total_budget');
        expect(initRes.body).toContain('get_total_budget');
        expect(initRes.body).toContain('update_category_by_description');
        expect(initRes.body).toContain('list_categorization_rules');
        expect(initRes.body).toContain('create_categorization_rule');
        expect(initRes.body).toContain('delete_categorization_rule');
        expect(initRes.body).toContain('apply_categorization_rules');
        expect(initRes.body).toContain('update_transaction_details');
        expect(initRes.body).toContain('manage_non_recurring_exclusion');

        // Cleanup
        initReq.emit('close');
        await handlerPromise;
    });

    it('should call get_vault_status tool and return status', async () => {
        const initReq = new MockRequest('GET', '/api/mcp');
        const initRes = new MockResponse();
        (initRes as any).socket = {
            setTimeout: vi.fn(),
            setNoDelay: vi.fn(),
            setKeepAlive: vi.fn(),
        };
        const handlerPromise = handler(initReq, initRes);
        await new Promise(resolve => setTimeout(resolve, 100));

        const match = initRes.body.match(/sessionId=([a-zA-Z0-9-]+)/);
        const sessionId = match![1];

        // Initialize
        const valReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        valReq.query = { sessionId };
        valReq.headers = { 'content-type': 'application/json' };
        valReq.body = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0.0" }
            }
        };
        setTimeout(() => {
            valReq.emit('data', Buffer.from(JSON.stringify(valReq.body)));
            valReq.emit('end');
        }, 10);

        const valRes = new MockResponse();
        await handler(valReq, valRes);
        await new Promise(resolve => setTimeout(resolve, 200));

        // Mock vault status API response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ locked: false, initialized: true })
        } as Response);

        // Call Tool
        const postReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        postReq.query = { sessionId };
        postReq.headers = { 'content-type': 'application/json' };
        postReq.body = {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
                name: "get_vault_status",
                arguments: {}
            }
        };

        setTimeout(() => {
            postReq.emit('data', Buffer.from(JSON.stringify(postReq.body)));
            postReq.emit('end');
        }, 10);

        const postRes = new MockResponse();
        await handler(postReq, postRes);

        await new Promise(resolve => setTimeout(resolve, 500));
        expect(postRes.statusCode).toBeLessThan(300);

        // Verify API was called
        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/vault/status'), expect.any(Object));
        
        // Verify tool response is in the SSE stream output
        expect(initRes.body).toContain('Vault Status:');
        expect(initRes.body).toContain('Locked: No');

        // Cleanup
        initReq.emit('close');
        await handlerPromise;
    });

    it('should call get_anomalies tool and list anomalies', async () => {
        const initReq = new MockRequest('GET', '/api/mcp');
        const initRes = new MockResponse();
        (initRes as any).socket = {
            setTimeout: vi.fn(),
            setNoDelay: vi.fn(),
            setKeepAlive: vi.fn(),
        };
        const handlerPromise = handler(initReq, initRes);
        await new Promise(resolve => setTimeout(resolve, 100));

        const match = initRes.body.match(/sessionId=([a-zA-Z0-9-]+)/);
        const sessionId = match![1];

        // Initialize
        const valReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        valReq.query = { sessionId };
        valReq.headers = { 'content-type': 'application/json' };
        valReq.body = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0.0" }
            }
        };
        setTimeout(() => {
            valReq.emit('data', Buffer.from(JSON.stringify(valReq.body)));
            valReq.emit('end');
        }, 10);

        const valRes = new MockResponse();
        await handler(valReq, valRes);
        await new Promise(resolve => setTimeout(resolve, 200));

        // Mock anomalies API response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                anomalies: [
                    { id: 101, title: 'Spike in Dining', severity: 'medium', body: 'Spent 500 ILS on restaurants' }
                ]
            })
        } as Response);

        // Call Tool
        const postReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        postReq.query = { sessionId };
        postReq.headers = { 'content-type': 'application/json' };
        postReq.body = {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: {
                name: "get_anomalies",
                arguments: { status: "open" }
            }
        };

        setTimeout(() => {
            postReq.emit('data', Buffer.from(JSON.stringify(postReq.body)));
            postReq.emit('end');
        }, 10);

        const postRes = new MockResponse();
        await handler(postReq, postRes);

        await new Promise(resolve => setTimeout(resolve, 500));
        expect(postRes.statusCode).toBeLessThan(300);

        // Verify API was called with correct status query param
        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/anomalies?status=open'), expect.any(Object));
        
        // Verify tool response is in the output stream
        expect(initRes.body).toContain('Financial Anomalies (open)');
        expect(initRes.body).toContain('[ID 101] Spike in Dining (MEDIUM): Spent 500 ILS on restaurants');

        // Cleanup
        initReq.emit('close');
        await handlerPromise;
    });

    it('should call update_transaction_details tool and update metadata', async () => {
        const initReq = new MockRequest('GET', '/api/mcp');
        const initRes = new MockResponse();
        (initRes as any).socket = {
            setTimeout: vi.fn(),
            setNoDelay: vi.fn(),
            setKeepAlive: vi.fn(),
        };
        const handlerPromise = handler(initReq, initRes);
        await new Promise(resolve => setTimeout(resolve, 100));

        const match = initRes.body.match(/sessionId=([a-zA-Z0-9-]+)/);
        const sessionId = match![1];

        // Initialize
        const valReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        valReq.query = { sessionId };
        valReq.headers = { 'content-type': 'application/json' };
        valReq.body = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "test-client", version: "1.0.0" }
            }
        };
        setTimeout(() => {
            valReq.emit('data', Buffer.from(JSON.stringify(valReq.body)));
            valReq.emit('end');
        }, 10);

        const valRes = new MockResponse();
        await handler(valReq, valRes);
        await new Promise(resolve => setTimeout(resolve, 200));

        // Mock PUT response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ success: true })
        } as Response);

        // Call Tool with valid attributes
        const postReq = new MockRequest('POST', `/api/mcp?sessionId=${sessionId}`);
        postReq.query = { sessionId };
        postReq.headers = { 'content-type': 'application/json' };
        postReq.body = {
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: {
                name: "update_transaction_details",
                arguments: {
                    id: "tx1|visaCal",
                    category: "Food",
                    notes: "lunch with team"
                }
            }
        };

        setTimeout(() => {
            postReq.emit('data', Buffer.from(JSON.stringify(postReq.body)));
            postReq.emit('end');
        }, 10);

        const postRes = new MockResponse();
        await handler(postReq, postRes);

        await new Promise(resolve => setTimeout(resolve, 500));
        expect(postRes.statusCode).toBeLessThan(300);

        // Verify API was called with the correct URL and body, containing ONLY category and notes (is_favorite should not be in the body, and price/date definitely not)
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('/transactions/tx1|visaCal'),
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ category: "Food", notes: "lunch with team" })
            })
        );
        
        // Verify tool response is in output stream
        expect(initRes.body).toContain('Transaction tx1|visaCal successfully updated.');

        // Cleanup
        initReq.emit('close');
        await handlerPromise;
    });

    // Cleanup
    afterEach(() => {
        // Close any lingering sessions if possible
    });
});
