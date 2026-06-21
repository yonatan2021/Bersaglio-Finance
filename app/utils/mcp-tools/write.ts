import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, formatCurrency, formatTransactionAmount, handleMcpError } from "./helpers";

export function registerWriteTools(server: McpServer) {
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
                return handleMcpError(error);
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
                return handleMcpError(error);
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
                return handleMcpError(error);
            }
        }
    );

    // ============================================================================
    // TOOL: Budget [Composite]
    // ============================================================================
    server.registerTool(
        "budget",
        {
            description: "Manage budget limits. Actions:\n- 'get': compare budget vs actual per category for a billing cycle.\n- 'set_category': set limit for one category.\n- 'set_total': set the overall monthly cap.",
            inputSchema: {
                action: z.enum(["get", "set_category", "set_total"]).describe("The budget action to perform"),
                category: z.string().optional().describe("Category name (required for 'set_category')"),
                amount: z.number().optional().describe("Limit amount in ILS (required for 'set_category' and 'set_total')"),
                billingCycle: z.string().optional().describe("Billing cycle in YYYY-MM format (optional for 'get', defaults to current month)"),
            },
        },
        async ({ action, category, amount, billingCycle }) => {
            try {
                if (action === "get") {
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
                        const budgetLimit = Number(cat.budget) || 0;
                        const actual = Number(cat.actual) || 0;
                        const remaining = budgetLimit - actual;
                        const percentage = budgetLimit > 0 ? Math.round((actual / budgetLimit) * 100) : 0;

                        let status = "✅";
                        if (percentage > 100) status = "🔴";
                        else if (percentage > 80) status = "🟡";

                        return `${status} ${cat.category}: ${formatCurrency(actual)} / ${formatCurrency(budgetLimit)} (${percentage}%) - ${remaining >= 0 ? "Remaining" : "Over"}: ${formatCurrency(Math.abs(remaining))}`;
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
                }

                if (action === "set_category") {
                    if (!category || amount === undefined) {
                        return {
                            content: [{ type: "text", text: "Error: Both 'category' and 'amount' are required for 'set_category' action." }]
                        };
                    }
                    const res = await apiRequest<any>("/budgets", {
                        method: "POST",
                        body: JSON.stringify({ category, budget_limit: amount }),
                    });
                    return {
                        content: [{ type: "text", text: `Budget limit for category "${res.category}" set to ${formatCurrency(res.budget_limit)}.` }]
                    };
                }

                if (action === "set_total") {
                    if (amount === undefined) {
                        return {
                            content: [{ type: "text", text: "Error: 'amount' is required for 'set_total' action." }]
                        };
                    }
                    const res = await apiRequest<any>("/reports/total-budget", {
                        method: "POST",
                        body: JSON.stringify({ budget_limit: amount }),
                    });
                    return {
                        content: [{ type: "text", text: `Total monthly budget limit set to ${formatCurrency(res.budget_limit)}.` }]
                    };
                }

                throw new Error(`Invalid action: ${action}`);
            } catch (error) {
                return handleMcpError(error);
            }
        }
    );

    // ============================================================================
    // TOOL: Categorization Rules [Composite]
    // ============================================================================
    server.registerTool(
        "categorization_rules",
        {
            description: "Manage custom categorization rules and apply them. Actions:\n- 'list': list all transaction categorization rules.\n- 'create': create rule for a description pattern.\n- 'delete': delete a rule by ID.\n- 'apply': apply rules over all historical transactions in bulk.\n- 'update_by_description': classify all transactions matching a description and optionally create a rule.",
            inputSchema: {
                action: z.enum(["list", "create", "delete", "apply", "update_by_description"]).describe("The categorization rules action to perform"),
                id: z.number().optional().describe("Rule ID (required for 'delete')"),
                namePattern: z.string().optional().describe("Description substring pattern to match (required for 'create')"),
                targetCategory: z.string().optional().describe("Category name to assign (required for 'create')"),
                description: z.string().optional().describe("Exact transaction description to match (required for 'update_by_description')"),
                newCategory: z.string().optional().describe("The new category to assign (required for 'update_by_description')"),
                createRule: z.boolean().optional().describe("Create rule for future transactions with this description (default: true for 'update_by_description')"),
            },
        },
        async ({ action, id, namePattern, targetCategory, description, newCategory, createRule }) => {
            try {
                if (action === "list") {
                    const rules = await apiRequest<any[]>("/categories/rules");
                    if (!rules || rules.length === 0) {
                        return {
                            content: [{ type: "text", text: "No custom categorization rules found." }],
                        };
                    }
                    const lines = rules.map((r: any) => `• ID ${r.id}: "${r.name_pattern}" → "${r.target_category}"`);
                    return {
                        content: [{ type: "text", text: ["📋 Custom Categorization Rules:", "", ...lines].join("\n") }],
                    };
                }

                if (action === "create") {
                    if (!namePattern || !targetCategory) {
                        return {
                            content: [{ type: "text", text: "Error: Both 'namePattern' and 'targetCategory' are required for 'create' action." }]
                        };
                    }
                    const res = await apiRequest<any>("/categories/rules", {
                        method: "POST",
                        body: JSON.stringify({ name_pattern: namePattern, target_category: targetCategory }),
                    });
                    return {
                        content: [{ type: "text", text: `Rule created successfully: [ID ${res.id}] "${res.name_pattern}" → "${res.target_category}".` }],
                    };
                }

                if (action === "delete") {
                    if (id === undefined) {
                        return {
                            content: [{ type: "text", text: "Error: 'id' is required for 'delete' action." }]
                        };
                    }
                    await apiRequest<any>("/categories/rules", {
                        method: "DELETE",
                        body: JSON.stringify({ id }),
                    });
                    return {
                        content: [{ type: "text", text: `Categorization rule ${id} deleted successfully.` }],
                    };
                }

                if (action === "apply") {
                    const res = await apiRequest<any>("/categories/apply-rules", { method: "POST" });
                    return {
                        content: [{ type: "text", text: `Categorization rules applied successfully. Updated ${res.transactionsUpdated} transactions using ${res.rulesApplied} rules.` }],
                    };
                }

                if (action === "update_by_description") {
                    if (!description || !newCategory) {
                        return {
                            content: [{ type: "text", text: "Error: Both 'description' and 'newCategory' are required for 'update_by_description' action." }]
                        };
                    }
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
                }

                throw new Error(`Invalid action: ${action}`);
            } catch (error) {
                return handleMcpError(error);
            }
        }
    );
}
