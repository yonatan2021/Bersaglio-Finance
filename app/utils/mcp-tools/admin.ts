import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, formatCurrency, formatTransactionAmount, consumeSseStream, handleMcpError } from "./helpers";

export function registerAdminTools(server: McpServer) {
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
                return handleMcpError(error);
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
                return handleMcpError(error);
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
                return handleMcpError(error);
            }
        }
    );

    // ============================================================================
    // TOOL: List Cards
    // ============================================================================
    server.registerTool(
        "list_cards",
        {
            description: "List all credit and debit cards configured in the system, including their nicknames, vendor, transactions count, type (credit/debit), and billing cycle start day.",
        },
        async () => {
            try {
                const cards = await apiRequest<any[]>("/cards");
                if (!cards || cards.length === 0) {
                    return {
                        content: [{ type: "text", text: "No cards found in the system." }],
                    };
                }
                const lines = cards.map((c: any) => {
                    const typeStr = c.is_debit ? "Debit (Immediate)" : "Credit (Recurring)";
                    const billingDayStr = c.is_debit ? "N/A" : `${c.billing_cycle_start_day || 10}`;
                    const nickname = c.card_nickname ? ` "${c.card_nickname}"` : "";
                    return `• Card •••• ${c.last4_digits}${nickname} (${c.card_vendor || "None"}) | Type: ${typeStr} | Billing Day: ${billingDayStr} | Transactions: ${c.transaction_count}`;
                });
                return {
                    content: [{ type: "text", text: ["💳 Configured Cards:", "", ...lines].join("\n") }],
                };
            } catch (error) {
                return handleMcpError(error);
            }
        }
    );

    // ============================================================================
    // TOOL: Configure Card Settings
    // ============================================================================
    server.registerTool(
        "configure_card",
        {
            description: "Configure settings for a specific card, including setting its brand/vendor, nickname, type (credit/debit), and billing cycle start day.",
            inputSchema: {
                last4Digits: z.string().describe("The last 4 digits of the card (e.g. '1234')"),
                cardVendor: z.string().describe("The brand/vendor of the card (e.g. 'visa', 'mastercard', 'max', 'isracard', 'amex', 'diners')"),
                cardNickname: z.string().optional().describe("A friendly nickname for the card"),
                isDebit: z.boolean().optional().describe("Set to true if this is a debit card (immediate billing), false for credit (recurring)"),
                billingCycleStartDay: z.number().min(1).max(28).optional().describe("The start day of the monthly billing cycle (1-28). Only applicable for credit cards."),
            },
        },
        async ({ last4Digits, cardVendor, cardNickname, isDebit, billingCycleStartDay }) => {
            try {
                const res = await apiRequest<any>("/cards", {
                    method: "POST",
                    body: JSON.stringify({
                        last4_digits: last4Digits,
                        card_vendor: cardVendor,
                        card_nickname: cardNickname,
                        is_debit: isDebit,
                        billing_cycle_start_day: billingCycleStartDay
                    }),
                });
                const typeStr = res.is_debit ? "Debit" : "Credit";
                const billingDayStr = res.is_debit ? "N/A" : `${res.billing_cycle_start_day || 10}`;
                const text = [
                    `💳 Card settings updated successfully!`,
                    `• Card: •••• ${res.last4_digits}`,
                    `• Vendor: ${res.card_vendor}`,
                    `• Nickname: ${res.card_nickname || "None"}`,
                    `• Type: ${typeStr}`,
                    `• Billing Cycle Start Day: ${billingDayStr}`
                ].join("\n");
                return {
                    content: [{ type: "text", text: text }],
                };
            } catch (error) {
                return handleMcpError(error);
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
                return handleMcpError(error);
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
                    content: [{ type: "text", text: text }],
                };
            } catch (error) {
                return handleMcpError(error);
            }
        }
    );

    // ============================================================================
    // TOOL: Anomalies [Composite]
    // ============================================================================
    server.registerTool(
        "anomalies",
        {
            description: "Manage and update financial anomalies. Actions:\n- 'list': get list of detected anomalies.\n- 'evaluate': manually trigger anomaly evaluation engine.\n- 'update': change the status of an anomaly (e.g. acknowledge/dismiss).",
            inputSchema: {
                action: z.enum(["list", "evaluate", "update"]).describe("The anomaly action to perform"),
                status: z
                    .enum(["open", "acknowledged", "dismissed", "normal"])
                    .optional()
                    .describe("Status to filter by (for 'list') or set to (for 'update')"),
                id: z.number().optional().describe("Anomaly ID (required for 'update')"),
            },
        },
        async ({ action, status, id }) => {
            try {
                if (action === "list") {
                    const statusParam = status || "open";
                    const data = await apiRequest<any>(`/anomalies?status=${statusParam}`);
                    const anomaliesList = data.anomalies || [];
                    if (anomaliesList.length === 0) {
                        return {
                            content: [{ type: "text", text: `No anomalies with status "${statusParam}" found.` }],
                        };
                    }
                    const lines = anomaliesList.map((a: any) => {
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
                }

                if (action === "evaluate") {
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
                }

                if (action === "update") {
                    if (id === undefined || !status) {
                        return {
                            content: [{ type: "text", text: "Error: Both 'id' and 'status' parameters are required for 'update' action." }],
                        };
                    }
                    if (status === "open") {
                        return {
                            content: [{ type: "text", text: "Error: Cannot update an anomaly status back to 'open'." }],
                        };
                    }
                    await apiRequest<any>(`/anomalies/${id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ status }),
                    });
                    return {
                        content: [{ type: "text", text: `Anomaly ${id} status successfully updated to "${status}".` }],
                    };
                }

                throw new Error(`Invalid action: ${action}`);
            } catch (error) {
                return handleMcpError(error);
            }
        }
    );
}
