import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, formatCurrency, formatTransactionAmount, handleMcpError } from "./helpers";

export function registerCoreTools(server: McpServer) {
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
                } else if (endDate) {
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
                        const cardExp = Number(row.card_expenses) || 0;
                        const bankInc = Number(row.bank_income) || 0;
                        const bankExp = Number(row.bank_expenses) || 0;
                        const parts: string[] = [];
                        if (cardExp > 0) parts.push(`Card ${formatTransactionAmount(-cardExp)}`);
                        if (bankInc > 0) parts.push(`Bank Income ${formatTransactionAmount(bankInc)}`);
                        if (bankExp > 0) parts.push(`Bank Expenses ${formatTransactionAmount(-bankExp)}`);

                        if (parts.length === 0) {
                            parts.push(formatTransactionAmount(Number(row.amount) || 0));
                        }

                        return `• ${row.description} (${row.category || "Uncategorized"}): ${parts.join(", ")} (${row.transaction_count} transactions)`;
                    } else if (groupBy === "last4digits") {
                        const cardExp = Number(row.card_expenses) || 0;
                        const bankInc = Number(row.bank_income) || 0;
                        const bankExp = Number(row.bank_expenses) || 0;
                        const parts: string[] = [];
                        if (cardExp > 0) parts.push(`Card ${formatTransactionAmount(-cardExp)}`);
                        if (bankInc > 0) parts.push(`Bank Income ${formatTransactionAmount(bankInc)}`);
                        if (bankExp > 0) parts.push(`Bank Expenses ${formatTransactionAmount(-bankExp)}`);

                        const netBal = row.net_balance !== undefined ? Number(row.net_balance) : (bankInc - bankExp - cardExp);

                        return `• Account ***${row.last4digits} (${row.bank_account_nickname || "Unknown"}): ${parts.join(", ")} [Net: ${formatTransactionAmount(netBal)}] (${row.transaction_count} transactions)`;
                    } else {
                        const name = row.vendor_nickname || row.vendor;
                        const cardExp = Number(row.card_expenses) || 0;
                        const bankInc = Number(row.bank_income) || 0;
                        const bankExp = Number(row.bank_expenses) || 0;
                        return `• ${name}: Card Expenses ${formatTransactionAmount(-cardExp)}, Bank Income ${formatTransactionAmount(bankInc)}, Bank Expenses ${formatTransactionAmount(-bankExp)}`;
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
                    `💳 Total Card Expenses: ${formatTransactionAmount(-totalCardExpenses)}`,
                    `📈 Total Bank Income: ${formatTransactionAmount(totalBankIncome)}`,
                    `📉 Total Bank Expenses: ${formatTransactionAmount(-totalBankExpenses)}`,
                    `💰 Net Balance: ${formatTransactionAmount(totalBankIncome - totalBankExpenses - totalCardExpenses)}`,
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return handleMcpError(error);
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

                const netTotal = data.reduce((sum, t) => sum + (Number(t.price) || 0), 0);

                const transactions = data.slice(0, 20).map((t: any) => {
                    const date = new Date(t.date).toLocaleDateString("he-IL");
                    const installment = t.installments_total > 1
                        ? ` (${t.installments_number}/${t.installments_total})`
                        : "";
                    return `• ${date}: ${t.name} - ${formatTransactionAmount(Number(t.price))}${installment}`;
                });

                const summary = [
                    `📁 Category: ${category}`,
                    `💰 Net Total: ${formatTransactionAmount(netTotal)} (${data.length} transactions)`,
                    "",
                    "--- Recent Transactions ---",
                    ...transactions,
                    data.length >= limit ? `\n... and more transactions available (use limit param to see more)` : "",
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return handleMcpError(error);
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

                const netTotal = data.reduce((sum, t) => sum + (Number(t.price) || 0), 0);

                const transactions = data.slice(0, 25).map((t: any) => {
                    const date = new Date(t.date).toLocaleDateString("he-IL");
                    const category = t.category || "Uncategorized";
                    const vendor = t.vendor_nickname || t.vendor;
                    return `• ${date}: ${t.name} (${category}) - ${formatTransactionAmount(Number(t.price))} [${vendor}]`;
                });

                const summary = [
                    `🔍 Search Results for "${query}"`,
                    `Found ${data.length} transactions, Net Total: ${formatTransactionAmount(netTotal)}`,
                    "",
                    ...transactions,
                    data.length > 25 ? `\n... and ${data.length - 25} more results` : "",
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return handleMcpError(error);
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

                const responseData = await apiRequest<{ items: any[] }>(`/reports/monthly-summary?${params}&groupBy=category`);
                const response = responseData.items || [];

                if (!response || response.length === 0) {
                    return {
                        content: [{ type: "text", text: "No transactions found for the specified period." }],
                    };
                }

                // Segregate expenses (< 0) and income (> 0)
                const expenses = response.filter((row: any) => (Number(row.total) || 0) < 0);
                const income = response.filter((row: any) => (Number(row.total) || 0) > 0);
                const zero = response.filter((row: any) => (Number(row.total) || 0) === 0);

                // Sort expenses: most negative (highest spending) first
                const sortedExpenses = [...expenses, ...zero].sort((a, b) => (Number(a.total) || 0) - (Number(b.total) || 0));
                // Sort income: most positive (highest income) first
                const sortedIncome = [...income].sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

                const totalExpenses = expenses.reduce((sum, v) => sum + Math.abs(Number(v.total) || 0), 0);
                const totalIncome = income.reduce((sum, v) => sum + (Number(v.total) || 0), 0);

                const expenseLines = sortedExpenses.map((row) => {
                    const total = Number(row.total) || 0;
                    const percentage = totalExpenses > 0 ? Math.round((Math.abs(total) / totalExpenses) * 100) : 0;
                    return `• ${row.category || "Uncategorized"}: ${formatTransactionAmount(total)} (${row.count || 0} txs, ${percentage}%)`;
                });

                const incomeLines = sortedIncome.map((row) => {
                    const total = Number(row.total) || 0;
                    const percentage = totalIncome > 0 ? Math.round((total / totalIncome) * 100) : 0;
                    return `• ${row.category || "Uncategorized"}: ${formatTransactionAmount(total)} (${row.count || 0} txs, ${percentage}%)`;
                });

                const summary = [
                    `📊 Category Breakdown`,
                    `Period: ${billingCycle || `${startDate} to ${endDate}`}`,
                    "",
                    `--- Expenses (הוצאות) ---`,
                    `Total Expenses: ${formatTransactionAmount(-totalExpenses)}`,
                    ...expenseLines,
                    "",
                    `--- Income (הכנסות) ---`,
                    `Total Income: ${formatTransactionAmount(totalIncome)}`,
                    ...incomeLines,
                    "",
                    `💰 Net Total: ${formatTransactionAmount(totalIncome - totalExpenses)}`
                ].join("\n");

                return {
                    content: [{ type: "text", text: summary }],
                };
            } catch (error) {
                return handleMcpError(error);
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
                return handleMcpError(error);
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
                    return `• ${p.name}: ${formatTransactionAmount(Number(p.price) || 0)}${progress}`;
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
                return handleMcpError(error);
            }
        }
    );
}
