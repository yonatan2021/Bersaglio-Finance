import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Configuration
// In Next.js, we can trust the internal port or use localhost
const PORT = process.env.PORT || "6969";
const API_BASE = process.env.NUDLERS_API_URL || `http://localhost:${PORT}/api`;

// Helper function to make API requests
async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
}

// Helper to format currency
function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("he-IL", {
        style: "currency",
        currency: "ILS",
    }).format(amount);
}

// Helper function to consume SSE stream from sync-all-stream
async function consumeSseStream(
    endpoint: string,
    body: any
): Promise<any> {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
        throw new Error("No response body received from sync stream");
    }

    const reader = (response.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accountsList: Array<{ id: number; nickname: string; vendor: string }> = [];
    let accountsStatus: Array<{ id: number; nickname: string; success: boolean; error?: string }> = [];
    let finalSummary: any = null;

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            // Save the last partial line back to the buffer
            buffer = lines.pop() || "";

            let currentEvent = "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("event:")) {
                    currentEvent = trimmed.replace("event:", "").trim();
                } else if (trimmed.startsWith("data:")) {
                    const dataStr = trimmed.replace("data:", "").trim();
                    try {
                        const data = JSON.parse(dataStr);
                        if (currentEvent === "queue") {
                            accountsList = data.accounts || [];
                        } else if (currentEvent === "account_complete") {
                            const acc = accountsList.find(a => a.id === data.id);
                            accountsStatus.push({
                                id: data.id,
                                nickname: acc ? acc.nickname : `Account ${data.id}`,
                                success: true,
                            });
                        } else if (currentEvent === "account_error") {
                            const acc = accountsList.find(a => a.id === data.id);
                            accountsStatus.push({
                                id: data.id,
                                nickname: acc ? acc.nickname : `Account ${data.id}`,
                                success: false,
                                error: data.message,
                            });
                        } else if (currentEvent === "complete") {
                            finalSummary = data.summary;
                        }
                    } catch (e) {
                        // Ignore parsing errors for individual debug lines
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return {
        success: true,
        accounts: accountsStatus,
        summary: finalSummary,
    };
}

export function createMcpServer() {
    const server = new McpServer({
        name: "nudlers",
        version: "1.0.0",
    });

    // ============================================================================
    // TOOL: Get Monthly Summary
    // ============================================================================
    server.registerTool(
        "get_monthly_summary",
        {
            description: "Get a monthly financial summary with expenses grouped by vendor/card. Returns bank income, bank expenses, card expenses, and net balance.",
            inputSchema: {
                billingCycle: z
                    .string()
                    .optional()
                    .describe("Billing cycle in YYYY-MM format (e.g., 2026-01). If not provided, uses current month."),
                startDate: z
                    .string()
                    .optional()
                    .describe("Start date in YYYY-MM-DD format (alternative to billingCycle)"),
                endDate: z
                    .string()
                    .optional()
                    .describe("End date in YYYY-MM-DD format (alternative to billingCycle)"),
                groupBy: z
                    .enum(["vendor", "description", "last4digits"])
                    .optional()
                    .describe("How to group results: 'vendor' (default), 'description', or 'last4digits'"),
            },
        },
        async ({ billingCycle, startDate, endDate, groupBy }) => {
            try {
                const params = new URLSearchParams();

                if (billingCycle) {
                    params.append("billingCycle", billingCycle);
                } else if (startDate && endDate) {
                    params.append("startDate", startDate);
                    params.append("endDate", endDate);
                } else {
                    // Default to current month
                    const now = new Date();
                    const currentCycle = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                    params.append("billingCycle", currentCycle);
                }

                if (groupBy) {
                    params.append("groupBy", groupBy);
                }

                const response = await apiRequest<{ items: any[] } | any[]>(`/reports/monthly-summary?${params}`);
                let data: any[] = [];

                if (Array.isArray(response)) {
                    data = response;
                } else if (response && Array.isArray(response.items)) {
                    data = response.items;
                }

                if (!data || data.length === 0) {
                    return {
                        content: [{ type: "text", text: "No data found for the specified period." }],
                    };
                }

                // Calculate totals
                let totalCardExpenses = 0;
                let totalBankIncome = 0;
                let totalBankExpenses = 0;

                const lines = data.map((row: any) => {
                    totalCardExpenses += Number(row.card_expenses) || 0;
                    totalBankIncome += Number(row.bank_income) || 0;
                    totalBankExpenses += Number(row.bank_expenses) || 0;

                    if (groupBy === "description") {
                        return `• ${row.description} (${row.category || "Uncategorized"}): ${formatCurrency(row.card_expenses)} (${row.transaction_count} transactions)`;
                    } else if (groupBy === "last4digits") {
                        return `• Card ***${row.last4digits}: ${formatCurrency(row.card_expenses)} (${row.transaction_count} transactions)`;
                    } else {
                        const name = row.vendor_nickname || row.vendor;
                        return `• ${name}: Card ${formatCurrency(row.card_expenses)}, Bank Income ${formatCurrency(row.bank_income)}, Bank Expenses ${formatCurrency(row.bank_expenses)}`;
                    }
                });

                const summary = [
                    `📊 Monthly Summary`,
                    `Period: ${billingCycle || `${startDate} to ${endDate}`}`,
                    "",
                    "--- Breakdown ---",
                    ...lines,
                    "",
                    "--- Totals ---",
                    `💳 Total Card Expenses: ${formatCurrency(totalCardExpenses)}`,
                    `📈 Total Bank Income: ${formatCurrency(totalBankIncome)}`,
                    `📉 Total Bank Expenses: ${formatCurrency(totalBankExpenses)}`,
                    `💰 Net Balance: ${formatCurrency(totalBankIncome - totalBankExpenses - totalCardExpenses)}`,
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching monthly summary: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Category Expenses
    // ============================================================================
    server.registerTool(
        "get_category_expenses",
        {
            description: "Get all transactions for a specific category in a given time period.",
            inputSchema: {
                category: z.string().describe("Category name to filter by (e.g., 'Groceries', 'Dining')"),
                billingCycle: z
                    .string()
                    .optional()
                    .describe("Billing cycle in YYYY-MM format"),
                startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
                endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
                limit: z.number().optional().describe("Maximum number of transactions to return (default 50)"),
            },
        },
        async ({ category, billingCycle, startDate, endDate, limit = 50 }) => {
            try {
                const params = new URLSearchParams();
                params.append("category", category);

                if (billingCycle) {
                    params.append("billingCycle", billingCycle);
                } else if (startDate && endDate) {
                    params.append("startDate", startDate);
                    params.append("endDate", endDate);
                } else {
                    const now = new Date();
                    params.append("billingCycle", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
                }

                if (limit) {
                    params.append("limit", limit.toString());
                }

                const response = await apiRequest<{ items: any[] } | any[]>(`/transactions?${params}`);

                let data: any[] = [];
                if (Array.isArray(response)) {
                    data = response;
                } else if (response && Array.isArray(response.items)) {
                    data = response.items;
                }

                if (!data || data.length === 0) {
                    return {
                        content: [{ type: "text", text: `No transactions found for category "${category}".` }],
                    };
                }

                const total = data.reduce((sum, t) => sum + Math.abs(Number(t.price) || 0), 0);

                const transactions = data.slice(0, 20).map((t: any) => {
                    const date = new Date(t.date).toLocaleDateString("he-IL");
                    const installment = t.installments_total > 1
                        ? ` (${t.installments_number}/${t.installments_total})`
                        : "";
                    return `• ${date}: ${t.name} - ${formatCurrency(Math.abs(t.price))}${installment}`;
                });

                const summary = [
                    `📁 Category: ${category}`,
                    `💰 Total: ${formatCurrency(total)} (${data.length} transactions)`,
                    "",
                    "--- Recent Transactions ---",
                    ...transactions,
                    data.length >= limit ? `\n... and more transactions available (use limit param to see more)` : "",
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching category expenses: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get All Categories
    // ============================================================================
    server.registerTool(
        "get_all_categories",
        {
            description: "List all spending categories that exist in the system.",
        },
        async () => {
            try {
                const response = await apiRequest<string[] | { items: string[] }>("/categories");
                let data: string[] = [];
                if (Array.isArray(response)) {
                    data = response;
                } else if (response && Array.isArray((response as any).items)) {
                    data = (response as any).items;
                }

                if (!data || data.length === 0) {
                    return {
                        content: [{ type: "text", text: "No categories found." }],
                    };
                }

                const summary = [
                    `📋 All Categories (${data.length} total)`,
                    "",
                    ...data.map((cat: string) => `• ${cat}`),
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching categories: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Search Transactions
    // ============================================================================
    server.registerTool(
        "search_transactions",
        {
            description: "Search for transactions by description, vendor, category, or identifier.",
            inputSchema: {
                query: z.string().min(2).describe("Search query (minimum 2 characters)"),
                billingCycle: z.string().optional().describe("Filter by billing cycle (YYYY-MM)"),
                startDate: z.string().optional().describe("Filter start date (YYYY-MM-DD)"),
                endDate: z.string().optional().describe("Filter end date (YYYY-MM-DD)"),
            },
        },
        async ({ query, billingCycle, startDate, endDate }) => {
            try {
                const params = new URLSearchParams();
                params.append("q", query);

                if (billingCycle) {
                    params.append("billingCycle", billingCycle);
                } else if (startDate && endDate) {
                    params.append("startDate", startDate);
                    params.append("endDate", endDate);
                }

                const response = await apiRequest<{ items: any[] } | any[]>(`/transactions?${params}`);

                let data: any[] = [];
                if (Array.isArray(response)) {
                    data = response;
                } else if (response && Array.isArray(response.items)) {
                    data = response.items;
                }

                if (!data || data.length === 0) {
                    return {
                        content: [{ type: "text", text: `No transactions found matching "${query}".` }],
                    };
                }

                const total = data.reduce((sum, t) => sum + Math.abs(Number(t.price) || 0), 0);

                const transactions = data.slice(0, 25).map((t: any) => {
                    const date = new Date(t.date).toLocaleDateString("he-IL");
                    const category = t.category || "Uncategorized";
                    const vendor = t.vendor_nickname || t.vendor;
                    return `• ${date}: ${t.name} (${category}) - ${formatCurrency(Math.abs(t.price))} [${vendor}]`;
                });

                const summary = [
                    `🔍 Search Results for "${query}"`,
                    `Found ${data.length} transactions, Total: ${formatCurrency(total)}`,
                    "",
                    ...transactions,
                    data.length > 25 ? `\n... and ${data.length - 25} more results` : "",
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error searching transactions: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Budgets
    // ============================================================================
    server.registerTool(
        "get_budgets",
        {
            description: "Get budget vs actual spending comparison for all categories.",
            inputSchema: {
                billingCycle: z
                    .string()
                    .optional()
                    .describe("Billing cycle in YYYY-MM format. Defaults to current month."),
            },
        },
        async ({ billingCycle }) => {
            try {
                const params = new URLSearchParams();

                if (billingCycle) {
                    params.append("billingCycle", billingCycle);
                } else {
                    const now = new Date();
                    params.append("billingCycle", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
                }

                const data = await apiRequest<any>(`/reports/budget-vs-actual?${params}`);

                if (!data || !data.categories || data.categories.length === 0) {
                    return {
                        content: [{ type: "text", text: "No budget data found." }],
                    };
                }

                const categories = data.categories.map((cat: any) => {
                    const budget = Number(cat.budget) || 0;
                    const actual = Number(cat.actual) || 0;
                    const remaining = budget - actual;
                    const percentage = budget > 0 ? Math.round((actual / budget) * 100) : 0;

                    let status = "✅";
                    if (percentage > 100) status = "🔴";
                    else if (percentage > 80) status = "🟡";

                    return `${status} ${cat.category}: ${formatCurrency(actual)} / ${formatCurrency(budget)} (${percentage}%) - ${remaining >= 0 ? "Remaining" : "Over"}: ${formatCurrency(Math.abs(remaining))}`;
                });

                const totalBudget = Number(data.totalBudget) || 0;
                const totalActual = Number(data.totalActual) || 0;

                const summary = [
                    `💰 Budget vs Actual - ${billingCycle || "Current Month"}`,
                    "",
                    "--- By Category ---",
                    ...categories,
                    "",
                    "--- Total ---",
                    `Budget: ${formatCurrency(totalBudget)}`,
                    `Actual: ${formatCurrency(totalActual)}`,
                    `Remaining: ${formatCurrency(totalBudget - totalActual)}`,
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching budgets: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Sync Status
    // ============================================================================
    server.registerTool(
        "get_sync_status",
        {
            description: "Get the synchronization status for all connected bank accounts and credit cards.",
        },
        async () => {
            try {
                const data = await apiRequest<any>("/scrapers/status");

                if (!data || !data.accountSyncStatus || data.accountSyncStatus.length === 0) {
                    return {
                        content: [{ type: "text", text: "No accounts configured." }],
                    };
                }

                const accounts = data.accountSyncStatus.map((acc: any) => {
                    const lastSync = acc.last_synced_at
                        ? new Date(acc.last_synced_at).toLocaleString("he-IL")
                        : "Never";
                    const status = acc.last_synced_at ? "✅" : "⏳";
                    const name = acc.nickname || acc.vendor;
                    return `${status} ${name}: Last sync ${lastSync}`;
                });

                const summary = [
                    `🔄 Sync Status`,
                    "",
                    ...accounts,
                    "",
                    data.settings?.enabled
                        ? `⚙️ Auto-sync: Enabled (syncs at ${data.settings.syncHour}:00)`
                        : "⚙️ Auto-sync: Disabled",
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching sync status: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Recurring Payments
    // ============================================================================
    server.registerTool(
        "get_recurring_payments",
        {
            description: "Get a list of recurring payments and installments.",
        },
        async () => {
            try {
                const data = await apiRequest<any>("/reports/recurring-payments");

                if (!data || !data.payments || data.payments.length === 0) {
                    return {
                        content: [{ type: "text", text: "No recurring payments found." }],
                    };
                }

                const payments = data.payments.slice(0, 20).map((p: any) => {
                    const progress = p.installments_total > 1
                        ? ` (${p.installments_number}/${p.installments_total})`
                        : " (recurring)";
                    return `• ${p.name}: ${formatCurrency(Math.abs(p.price))}${progress}`;
                });

                const summary = [
                    `🔄 Recurring Payments & Installments`,
                    `Total: ${data.payments.length} active`,
                    "",
                    ...payments,
                    data.payments.length > 20 ? `\n... and ${data.payments.length - 20} more` : "",
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching recurring payments: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: List Accounts
    // ============================================================================
    server.registerTool(
        "list_accounts",
        {
            description: "List all configured bank accounts and credit cards.",
        },
        async () => {
            try {
                const data = await apiRequest<any[]>("/credentials");

                if (!data || data.length === 0) {
                    return {
                        content: [{ type: "text", text: "No accounts configured." }],
                    };
                }

                const accounts = data.map((acc: any) => {
                    const type = acc.vendor_type === "bank" ? "🏦" : "💳";
                    const name = acc.nickname || acc.vendor;
                    return `${type} ${name} (${acc.vendor})`;
                });

                const summary = [
                    `📋 Configured Accounts (${data.length} total)`,
                    "",
                    ...accounts,
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching accounts: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get All Transactions
    // ============================================================================
    server.registerTool(
        "get_all_transactions",
        {
            description: "Get all transactions for a specific time period.",
            inputSchema: {
                billingCycle: z.string().optional().describe("Billing cycle in YYYY-MM format"),
                startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
                endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
                limit: z.number().optional().describe("Maximum number of transactions to return (default 50)"),
            },
        },
        async ({ billingCycle, startDate, endDate, limit = 50 }) => {
            try {
                const params = new URLSearchParams();

                if (billingCycle) {
                    params.append("billingCycle", billingCycle);
                } else if (startDate && endDate) {
                    params.append("startDate", startDate);
                    params.append("endDate", endDate);
                } else {
                    const now = new Date();
                    params.append("billingCycle", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
                }

                if (limit) {
                    params.append("limit", limit.toString());
                }

                const response = await apiRequest<{ items: any[] } | any[]>(`/transactions?${params}`);

                let data: any[] = [];
                if (Array.isArray(response)) {
                    data = response;
                } else if (response && Array.isArray(response.items)) {
                    data = response.items;
                }

                if (!data || data.length === 0) {
                    return {
                        content: [{ type: "text", text: "No transactions found for the specified period." }],
                    };
                }

                // Sort by date descending
                const sorted = data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                const total = sorted.reduce((sum, t) => sum + Math.abs(Number(t.price) || 0), 0);

                const transactions = sorted.slice(0, limit).map((t: any) => {
                    const date = new Date(t.date).toLocaleDateString("he-IL");
                    const category = t.category || "Uncategorized";
                    return `• ${date}: ${t.name} (${category}) - ${formatCurrency(Math.abs(t.price))}`;
                });

                const summary = [
                    `📜 All Transactions`,
                    `Period: ${billingCycle || `${startDate} to ${endDate}`}`,
                    `Total: ${formatCurrency(total)} (${data.length} transactions)`,
                    "",
                    ...transactions,
                    data.length > limit ? `\n... and ${data.length - limit} more transactions` : "",
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching transactions: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Add Manual Expense
    // ============================================================================
    server.registerTool(
        "add_manual_expense",
        {
            description: "Add a manual expense or income transaction. Use this for cash purchases, transfers, or transactions not captured by bank scrapers.",
            inputSchema: {
                name: z.string().min(1).describe("Transaction description (e.g., 'Coffee at local cafe', 'Grocery shopping')"),
                price: z.number().describe("Amount in ILS. Negative for expenses, positive for income."),
                date: z.string().describe("Transaction date in YYYY-MM-DD format"),
                category: z.string().optional().describe("Category name (e.g., 'Dining', 'Groceries', 'Transportation')"),
                memo: z.string().optional().describe("Additional notes or details about the transaction"),
            },
        },
        async ({ name, price, date, category, memo }) => {
            try {
                // Validate date format
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (!dateRegex.test(date)) {
                    return {
                        content: [{ type: "text", text: `Invalid date format. Please use YYYY-MM-DD (e.g., 2024-01-15).` }],
                    };
                }

                const response = await apiRequest<any>("/transactions", {
                    method: "POST",
                    body: JSON.stringify({
                        name,
                        price,
                        date,
                        category,
                        memo,
                        vendor: "manual",
                    }),
                });

                if (response.success) {
                    const txn = response.transaction;
                    const formattedDate = new Date(txn.date).toLocaleDateString("he-IL");
                    const formattedAmount = formatCurrency(Math.abs(txn.price));
                    const type = txn.price < 0 ? "expense" : "income";

                    const summary = [
                        `✅ Manual ${type} added successfully!`,
                        "",
                        `📝 Description: ${txn.name}`,
                        `💰 Amount: ${formattedAmount}`,
                        `📅 Date: ${formattedDate}`,
                        txn.category ? `📁 Category: ${txn.category}` : "",
                        txn.memo ? `📋 Memo: ${txn.memo}` : "",
                    ].filter(Boolean).join("\n");

                    return {
                        content: [{ type: "text", text: summary }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: `Failed to add transaction: ${response.error || "Unknown error"}` }],
                    };
                }
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error adding manual expense: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Category Breakdown
    // ============================================================================
    server.registerTool(
        "get_category_breakdown",
        {
            description: "Get a breakdown of spending by category for a given period. Shows total spent per category with transaction counts.",
            inputSchema: {
                billingCycle: z.string().optional().describe("Billing cycle in YYYY-MM format"),
                startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
                endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
            },
        },
        async ({ billingCycle, startDate, endDate }) => {
            try {
                const params = new URLSearchParams();

                if (billingCycle) {
                    params.append("billingCycle", billingCycle);
                } else if (startDate && endDate) {
                    params.append("startDate", startDate);
                    params.append("endDate", endDate);
                } else {
                    const now = new Date();
                    params.append("billingCycle", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
                }

                // The refactored endpoint now returns the summary directly
                const responseData = await apiRequest<{ items: any[] }>(`/reports/monthly-summary?${params}&groupBy=category`);
                const response = responseData.items || [];

                if (!response || response.length === 0) {
                    return {
                        content: [{ type: "text", text: "No transactions found for the specified period." }],
                    };
                }

                // Sort by total DESC (highest absolute spending first)
                const sorted = [...response].sort((a, b) => {
                    const totalA = Math.abs(Number(a.total) || 0);
                    const totalB = Math.abs(Number(b.total) || 0);
                    return totalB - totalA;
                });
                const grandTotal = sorted.reduce((sum, v) => sum + Math.abs(Number(v.total) || 0), 0);

                const lines = sorted.map((row) => {
                    const total = Math.abs(Number(row.total) || 0);
                    const percentage = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
                    return `• ${row.category || "Uncategorized"}: ${formatCurrency(total)} (${row.count} txs, ${percentage}%)`;
                });

                const summary = [
                    `📊 Category Breakdown`,
                    `Period: ${billingCycle || `${startDate} to ${endDate}`}`,
                    `Total Spending: ${formatCurrency(grandTotal)}`,
                    "",
                    "--- By Category ---",
                    ...lines,
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching category breakdown: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Balance Projection
    // ============================================================================
    server.registerTool(
        "get_balance_projection",
        {
            description: "Get a daily balance projection for the next 30 days. Accounts for bank balances, recurring transactions, and credit card settlements.",
        },
        async () => {
            try {
                const data = await apiRequest<any>("/reports/projection");

                if (!data || !data.projection || data.projection.length === 0) {
                    return {
                        content: [{ type: "text", text: "No projection data available." }],
                    };
                }

                const summary = data.summary;
                const projection = data.projection;

                const lines = projection.filter((_: any, i: number) => i % 5 === 0 || i === projection.length - 1).map((p: any) => {
                    const date = new Date(p.date).toLocaleDateString("he-IL");
                    return `• ${date}: ${formatCurrency(p.totalBalance)}`;
                });

                const output = [
                    `📈 Balance Projection (Next 30 Days)`,
                    `Starting Balance: ${formatCurrency(summary.startingBalance)}`,
                    `Ending Balance: ${formatCurrency(summary.endingBalance)}`,
                    `Net Change: ${formatCurrency(summary.endingBalance - summary.startingBalance)}`,
                    "",
                    "--- Forecast Highlights ---",
                    ...lines,
                    "",
                    "--- Significant Upcoming Events ---",
                ];

                // Find days with significant changes or recurring events
                projection.forEach((p: any) => {
                    if (p.bankRecurring && p.bankRecurring.length > 0) {
                        const date = new Date(p.date).toLocaleDateString("he-IL");
                        p.bankRecurring.forEach((r: any) => {
                            output.push(`• ${date}: ${r.name} (${formatCurrency(r.amount)})`);
                        });
                    }
                    if (p.ccPayments && p.ccPayments.length > 0) {
                        const date = new Date(p.date).toLocaleDateString("he-IL");
                        p.ccPayments.forEach((cc: any) => {
                            output.push(`• ${date}: CC Settlement ${cc.displayName} (${formatCurrency(cc.amount)})`);
                        });
                    }
                });

                return {
                    content: [{ type: "text", text: output.join("\n") }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error fetching balance projection: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Trigger Full Sync
    // ============================================================================
    server.registerTool(
        "trigger_full_sync",
        {
            description: "Run a full synchronization scraper run for all active bank accounts and credit cards to fetch the latest transactions.",
            inputSchema: {
                daysBack: z
                    .number()
                    .optional()
                    .describe("Number of days back to sync (default: 30)"),
            },
        },
        async ({ daysBack }) => {
            try {
                const result = await consumeSseStream("/scrapers/sync-all-stream", { daysBack: daysBack || 30 });
                let text = `🔄 Sync completed!\n`;
                text += `Synced: ${result.accounts.length} accounts\n`;
                result.accounts.forEach((acc: any) => {
                    text += `• ${acc.nickname}: ${acc.success ? "✅ Success" : `❌ Failed (${acc.error})`}\n`;
                });
                if (result.summary) {
                    text += `\n--- Summary ---\n`;
                    text += `💳 Saved Transactions: ${result.summary.savedTransactions}\n`;
                    text += `🔄 Updated Transactions: ${result.summary.updatedTransactions}\n`;
                    text += `⏱️ Duration: ${result.summary.durationSeconds} seconds\n`;
                }
                return {
                    content: [{ type: "text", text }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error triggering sync: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Vault Status
    // ============================================================================
    server.registerTool(
        "get_vault_status",
        {
            description: "Check if the application credentials vault is locked or unlocked. Scrapers cannot run when the vault is locked.",
        },
        async () => {
            try {
                const data = await apiRequest<any>("/vault/status");
                const text = [
                    `🔒 Vault Status:`,
                    `• Locked: ${data.locked ? "Yes 🔴" : "No 🟢"}`,
                    `• Initialized: ${data.initialized ? "Yes" : "No"}`,
                ].join("\n");
                return {
                    content: [{ type: "text", text }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error checking vault status: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Anomalies
    // ============================================================================
    server.registerTool(
        "get_anomalies",
        {
            description: "Get list of detected financial anomalies (unusual activity, spikes, duplicates, etc.).",
            inputSchema: {
                status: z
                    .enum(["open", "acknowledged", "dismissed", "normal"])
                    .optional()
                    .describe("Status to filter anomalies by (default: 'open')"),
            },
        },
        async ({ status }) => {
            try {
                const statusParam = status || "open";
                const data = await apiRequest<any>(`/anomalies?status=${statusParam}`);
                const anomalies = data.anomalies || [];
                if (anomalies.length === 0) {
                    return {
                        content: [{ type: "text", text: `No anomalies with status "${statusParam}" found.` }],
                    };
                }
                const lines = anomalies.map((a: any) => {
                    return `• [ID ${a.id}] ${a.title} (${a.severity.toUpperCase()}): ${a.body}`;
                });
                const text = [
                    `⚠️ Financial Anomalies (${statusParam})`,
                    "",
                    ...lines,
                ].join("\n");
                return {
                    content: [{ type: "text", text }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error checking anomalies: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Trigger Anomaly Evaluation
    // ============================================================================
    server.registerTool(
        "trigger_anomaly_evaluation",
        {
            description: "Manually run the anomaly detection engine over all transactions to find any new discrepancies.",
        },
        async () => {
            try {
                const data = await apiRequest<any>("/anomalies", { method: "POST" });
                const text = [
                    `⚙️ Anomaly evaluation complete!`,
                    `• Open anomalies: ${data.openAnomaliesCount || 0}`,
                    `• Evaluated transactions: ${data.evaluatedCount || 0}`,
                    `• New anomalies detected: ${data.newCount || 0}`,
                ].join("\n");
                return {
                    content: [{ type: "text", text }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error triggering anomaly evaluation: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Update Anomaly Status
    // ============================================================================
    server.registerTool(
        "update_anomaly_status",
        {
            description: "Mark an anomaly as acknowledged, dismissed, or normal.",
            inputSchema: {
                id: z.number().describe("The ID of the anomaly to update"),
                status: z
                    .enum(["acknowledged", "dismissed", "normal"])
                    .describe("The new status to set"),
            },
        },
        async ({ id, status }) => {
            try {
                await apiRequest<any>(`/anomalies/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status }),
                });
                return {
                    content: [{ type: "text", text: `Anomaly ${id} status successfully updated to "${status}".` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error updating anomaly: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Set Category Budget
    // ============================================================================
    server.registerTool(
        "set_category_budget",
        {
            description: "Set or update the budget limit for a specific spending category.",
            inputSchema: {
                category: z.string().describe("The category name to set budget for (e.g., 'Dining', 'Groceries')"),
                budgetLimit: z.number().describe("The budget limit amount in ILS"),
            },
        },
        async ({ category, budgetLimit }) => {
            try {
                const res = await apiRequest<any>("/budgets", {
                    method: "POST",
                    body: JSON.stringify({ category, budget_limit: budgetLimit }),
                });
                return {
                    content: [{ type: "text", text: `Budget limit for category "${res.category}" set to ${formatCurrency(res.budget_limit)}.` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error setting category budget: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Set Total Budget
    // ============================================================================
    server.registerTool(
        "set_total_budget",
        {
            description: "Set or update the total overall monthly budget limit.",
            inputSchema: {
                budgetLimit: z.number().describe("The total monthly budget limit in ILS (must be greater than 0)"),
            },
        },
        async ({ budgetLimit }) => {
            try {
                const res = await apiRequest<any>("/reports/total-budget", {
                    method: "POST",
                    body: JSON.stringify({ budget_limit: budgetLimit }),
                });
                return {
                    content: [{ type: "text", text: `Total monthly budget limit set to ${formatCurrency(res.budget_limit)}.` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error setting total budget: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Get Total Budget
    // ============================================================================
    server.registerTool(
        "get_total_budget",
        {
            description: "Get the total overall monthly budget limit configured in the system.",
        },
        async () => {
            try {
                const res = await apiRequest<any>("/reports/total-budget");
                if (!res.is_set) {
                    return {
                        content: [{ type: "text", text: `No total monthly budget limit has been set yet.` }],
                    };
                }
                return {
                    content: [{ type: "text", text: `Total monthly budget limit is: ${formatCurrency(res.budget_limit)}` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error getting total budget: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Update Category By Description
    // ============================================================================
    server.registerTool(
        "update_category_by_description",
        {
            description: "Update the category for all transactions matching a specific description, and optionally create a categorization rule for future occurrences.",
            inputSchema: {
                description: z.string().describe("Exact description of the transactions to update"),
                newCategory: z.string().describe("The new category to assign"),
                createRule: z
                    .boolean()
                    .optional()
                    .default(true)
                    .describe("Create a rule for future transactions with this description (default: true). ALWAYS confirm with user before setting to true."),
            },
        },
        async ({ description, newCategory, createRule }) => {
            try {
                const res = await apiRequest<any>("/categories/update-by-description", {
                    method: "POST",
                    body: JSON.stringify({ description, newCategory, createRule: createRule !== false }),
                });
                const text = [
                    `🏷️ Category updated successfully!`,
                    `• Description: "${description}"`,
                    `• Assigned Category: "${newCategory}"`,
                    `• Transactions updated: ${res.transactionsUpdated}`,
                    `• Rule created: ${res.ruleCreated ? "Yes ✅" : "No"}`,
                ].join("\n");
                return {
                    content: [{ type: "text", text }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error updating category: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: List Categorization Rules
    // ============================================================================
    server.registerTool(
        "list_categorization_rules",
        {
            description: "List all custom transaction categorization rules currently active in the system.",
        },
        async () => {
            try {
                const rules = await apiRequest<any[]>("/categories/rules");
                if (rules.length === 0) {
                    return {
                        content: [{ type: "text", text: "No categorization rules defined." }],
                    };
                }
                const lines = rules.map((r: any) => `• [ID ${r.id}] "${r.name_pattern}" → "${r.target_category}" (${r.is_active ? "Active" : "Inactive"})`);
                return {
                    content: [{ type: "text", text: ["📋 Categorization Rules:", "", ...lines].join("\n") }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error listing rules: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Create Categorization Rule
    // ============================================================================
    server.registerTool(
        "create_categorization_rule",
        {
            description: "Manually create a new transaction categorization rule to auto-classify future transactions.",
            inputSchema: {
                namePattern: z.string().describe("Description substring pattern to match (e.g., 'Yellow')"),
                targetCategory: z.string().describe("Category name to assign (e.g., 'Transportation')"),
            },
        },
        async ({ namePattern, targetCategory }) => {
            try {
                const res = await apiRequest<any>("/categories/rules", {
                    method: "POST",
                    body: JSON.stringify({ name_pattern: namePattern, target_category: targetCategory }),
                });
                return {
                    content: [{ type: "text", text: `Rule created successfully: [ID ${res.id}] "${res.name_pattern}" → "${res.target_category}".` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error creating rule: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Delete Categorization Rule
    // ============================================================================
    server.registerTool(
        "delete_categorization_rule",
        {
            description: "Delete a custom transaction categorization rule by its ID. Caution: Irreversible operation. Hermes must prompt the user for confirmation first.",
            inputSchema: {
                id: z.number().describe("The ID of the categorization rule to delete"),
            },
        },
        async ({ id }) => {
            try {
                await apiRequest<any>("/categories/rules", {
                    method: "DELETE",
                    body: JSON.stringify({ id }),
                });
                return {
                    content: [{ type: "text", text: `Categorization rule ${id} deleted successfully.` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error deleting rule: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Apply Categorization Rules
    // ============================================================================
    server.registerTool(
        "apply_categorization_rules",
        {
            description: "Run all active categorization rules over all transactions in the database. Note: This bulk operation might alter many transaction categories.",
        },
        async () => {
            try {
                const res = await apiRequest<any>("/categories/apply-rules", { method: "POST" });
                return {
                    content: [{ type: "text", text: `Categorization rules applied successfully. Updated ${res.transactionsUpdated} transactions using ${res.rulesApplied} rules.` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error applying rules: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Update Transaction Details
    // ============================================================================
    server.registerTool(
        "update_transaction_details",
        {
            description: "Update metadata details of an existing transaction (such as category, notes, or favorite status). Core banking details like price/date are protected and cannot be changed.",
            inputSchema: {
                id: z.string().describe("Transaction ID in format: identifier|vendor"),
                category: z.string().optional().describe("New category to assign"),
                isFavorite: z.boolean().optional().describe("Set favorite status"),
                notes: z.string().optional().describe("Custom personal notes for the transaction"),
            },
        },
        async ({ id, category, isFavorite, notes }) => {
            try {
                const body: any = {};
                if (category !== undefined) body.category = category;
                if (isFavorite !== undefined) body.is_favorite = isFavorite;
                if (notes !== undefined) body.notes = notes;

                await apiRequest<any>(`/transactions/${id}`, {
                    method: "PUT",
                    body: JSON.stringify(body),
                });
                return {
                    content: [{ type: "text", text: `Transaction ${id} successfully updated.` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error updating transaction: ${error}` }],
                };
            }
        }
    );

    // ============================================================================
    // TOOL: Manage Non-Recurring Exclusion
    // ============================================================================
    server.registerTool(
        "manage_non_recurring_exclusion",
        {
            description: "Mark or unmark a transaction description as non-recurring to exclude/include it in subscription analysis.",
            inputSchema: {
                action: z.enum(["add", "remove"]).describe("Whether to add or remove the exclusion"),
                name: z.string().describe("The transaction description name to exclude"),
                accountNumber: z.string().optional().describe("The specific bank account or card number (optional)"),
            },
        },
        async ({ action, name, accountNumber }) => {
            try {
                const method = action === "add" ? "POST" : "DELETE";
                const res = await apiRequest<any>("/reports/non-recurring-exclusions", {
                    method,
                    body: JSON.stringify({ name, account_number: accountNumber }),
                });
                return {
                    content: [{ type: "text", text: res.message || `Exclusion successfully ${action}ed.` }],
                };
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error managing recurring exclusion: ${error}` }],
                };
            }
        }
    );

    return server;
}
