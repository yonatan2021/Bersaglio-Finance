---
name: nudlers-data-access
description: "Complete reference for Nudlers MCP tools: 12 financial tools for Israeli bank/credit data. Covers all parameters, date formats, billing cycle concept, quick-lookup table, and error handling. Use this skill whenever you need to know which MCP tool to call and with what parameters."
version: 1.0.0
author: Yoni Gelfman
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [nudlers, mcp, finance, banking, israel, tools]
    related_skills: [nudlers-financial-analyst, native-mcp]
---

# Nudlers MCP — Data Access Reference

Nudlers is a personal finance app for Israeli banks and credit cards. It exposes an MCP server with 12 tools for querying transactions, budgets, subscriptions, and financial projections.

## Connection

- **URL**: `http://localhost:6969/api/mcp`
- **Transport**: SSE (Server-Sent Events)
- **MCP server name**: `nudlers`
- **Version**: 1.0.0

If the server is not running, Nudlers app must be started first (`npm run dev` or `npm start` in the `app/` directory).

## Key Concept: Billing Cycle

**Critical**: Nudlers does NOT group by calendar month. It uses billing cycles.

- Default billing cycle start: **day 10 of each month**
- `billingCycle: "2025-04"` means: **10 March 2025 → 9 April 2025**
- `billingCycle: "2025-05"` means: **10 April 2025 → 9 May 2025**
- When the user says "last month" or "this month", use `billingCycle`, not date ranges
- Current month default: tools auto-compute it when no date params are passed

**Date param options** (interchangeable across most tools):
- Option A: `billingCycle: "YYYY-MM"` — preferred for monthly questions
- Option B: `startDate: "YYYY-MM-DD"` + `endDate: "YYYY-MM-DD"` — for custom ranges

## Vendor Types

Nudlers has two transaction types:
- **Credit card vendors**: `visaCal`, `max`, `isracard`, `amex` — these generate card expenses
- **Bank vendors**: `hapoalim`, `leumi`, `mizrahi`, `discount`, `otsarHahayal`, `beinleumi`, `massad`, `pagi`, `yahav` — these generate bank income/expenses

This distinction affects `get_monthly_summary` output: card and bank data are reported separately.

---

## Tool Reference

### 1. `get_monthly_summary`

Get monthly financials grouped by vendor/card. Returns bank income, bank expenses, card expenses, and net balance.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `billingCycle` | string | no | current month | Format: `YYYY-MM` |
| `startDate` | string | no | — | Format: `YYYY-MM-DD` (use with endDate) |
| `endDate` | string | no | — | Format: `YYYY-MM-DD` (use with startDate) |
| `groupBy` | enum | no | `"vendor"` | `"vendor"` \| `"description"` \| `"last4digits"` |

**Returns:** Per-vendor breakdown with card expenses, bank income, bank expenses. Totals at bottom.

**Example:**
```json
{ "billingCycle": "2025-04", "groupBy": "vendor" }
```

**Use when:** User asks for overall monthly summary, what their total spending was, breakdown by bank.

---

### 2. `get_category_breakdown`

Spending breakdown by category with transaction counts and percentages. Best starting point for "how much did I spend?" questions.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `billingCycle` | string | no | current month | Format: `YYYY-MM` |
| `startDate` | string | no | — | Format: `YYYY-MM-DD` |
| `endDate` | string | no | — | Format: `YYYY-MM-DD` |

**Returns:** Categories sorted by spending (highest first), each with total amount, transaction count, and percentage of total.

**Example:**
```json
{ "billingCycle": "2025-04" }
```

**Use when:** User asks for category breakdown, spending distribution, "where did my money go?"

---

### 3. `get_category_expenses`

All transactions for a specific category in a time period.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `category` | string | **yes** | — | Category name (e.g., `"Groceries"`, `"Dining"`) |
| `billingCycle` | string | no | current month | Format: `YYYY-MM` |
| `startDate` | string | no | — | Format: `YYYY-MM-DD` |
| `endDate` | string | no | — | Format: `YYYY-MM-DD` |
| `limit` | number | no | `50` | Max transactions to return |

**Returns:** Transaction list with date, name, amount, installment info (N/M format). Total at top.

**Example:**
```json
{ "category": "Groceries", "billingCycle": "2025-04", "limit": 100 }
```

**Use when:** User asks to drill into a specific category, "show me all my restaurant charges", "what did I buy at the supermarket?"

---

### 4. `get_all_categories`

List all spending categories that exist in the system. No parameters.

**Returns:** Simple list of all category names.

**Use when:** User asks what categories exist, before calling `get_category_expenses` to verify a category name, building a dropdown in your response.

---

### 5. `search_transactions`

Search transactions by description, vendor, category, or identifier.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | **yes** | — | Min 2 characters |
| `billingCycle` | string | no | — | Filter by billing cycle |
| `startDate` | string | no | — | Filter start date |
| `endDate` | string | no | — | Filter end date |

**Returns:** Matching transactions with date, name, category, amount, vendor. Total at top.

**Example:**
```json
{ "query": "netflix", "billingCycle": "2025-04" }
```

**Use when:** User asks about a specific merchant, "find my Netflix charges", "did I buy from X?", "how much did I pay to Y?"

---

### 6. `get_all_transactions`

Get all transactions for a time period, sorted by date descending.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `billingCycle` | string | no | current month | Format: `YYYY-MM` |
| `startDate` | string | no | — | Format: `YYYY-MM-DD` |
| `endDate` | string | no | — | Format: `YYYY-MM-DD` |
| `limit` | number | no | `50` | Max transactions to return |

**Returns:** Full transaction list with date, name, category, amount.

**Example:**
```json
{ "billingCycle": "2025-04", "limit": 100 }
```

**Use when:** User wants to see all their transactions, export-like requests, or when no specific filter applies.

---

### 7. `get_budgets`

Budget vs actual spending comparison for all categories.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `billingCycle` | string | no | current month | Format: `YYYY-MM` |

**Returns:** Per-category: budget limit, actual spending, percentage used, remaining/over amount. Status icons: ✅ (under 80%), 🟡 (80-100%), 🔴 (over budget). Total at bottom.

**Example:**
```json
{ "billingCycle": "2025-04" }
```

**Use when:** User asks about budgets, "am I over budget?", "how much budget do I have left?", budget analysis.

---

### 8. `get_recurring_payments`

List of recurring payments and installments. No parameters.

**Returns:** All active recurring payments and active installments. Each entry: name, amount, progress for installments (N/M), or "(recurring)" for subscriptions.

**Use when:** User asks about subscriptions, monthly fixed costs, installment payments, "what do I pay every month?"

**Note:** Installments (תשלומים) show progress like `(3/12)`. Recurring subscriptions show `(recurring)`.

---

### 9. `get_balance_projection`

Daily balance projection for the next 30 days. Combines current bank balances, recurring transactions, and upcoming credit card settlements.

No parameters.

**Returns:** Starting balance, ending balance, net change. Key dates every 5 days. Upcoming events: recurring payments and credit card settlement dates.

**Use when:** User asks about future balance, "will I have enough money?", "when is my next credit card payment?", cash flow questions.

---

### 10. `get_sync_status`

Sync status for all connected bank accounts and credit cards. No parameters.

**Returns:** Per-account: status icon (✅/❌/⏳), name, last sync time. Auto-sync configuration.

**Use when:** Data seems outdated, user asks when data was last updated, before doing important analysis ("is my data up to date?").

---

### 11. `list_accounts`

List all configured bank accounts and credit cards. No parameters.

**Returns:** Account list with type icon (🏦 bank, 💳 credit card), nickname, vendor name.

**Use when:** User asks what accounts are connected, first-time orientation, or when vendor names are unclear.

---

### 12. `add_manual_expense`

Add a manual transaction (cash, transfers, expenses not captured by scrapers).

**⚠️ This is the only write tool. Always confirm with the user before calling it.**

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | **yes** | — | Transaction description |
| `price` | number | **yes** | — | Amount in ILS. Positive = expense, Negative = income |
| `date` | string | **yes** | — | Format: `YYYY-MM-DD` |
| `category` | string | no | — | Category name |
| `memo` | string | no | — | Additional notes |

**Example:**
```json
{ "name": "Coffee at local cafe", "price": 22, "date": "2025-04-15", "category": "Dining" }
```

**Use when:** User wants to record a cash payment, a transfer, or any expense not in their bank data.

---

## Quick-Lookup Table

| User question | Tool to call | Key params |
|---|---|---|
| "כמה הוצאתי החודש?" | `get_category_breakdown` | current cycle (no params) |
| "כמה הוצאתי החודש שעבר?" | `get_category_breakdown` | `billingCycle: "YYYY-MM"` of last month |
| "מה הסיכום החודשי שלי?" | `get_monthly_summary` | current cycle |
| "כמה הוצאתי על מסעדות?" | `get_category_expenses` | `category: "Dining"` |
| "מה הקטגוריות שלי?" | `get_all_categories` | — |
| "חפש עסקה של נטפליקס" | `search_transactions` | `query: "netflix"` |
| "מה כל העסקאות שלי?" | `get_all_transactions` | current cycle |
| "האם אני בתקציב?" | `get_budgets` | current cycle |
| "כמה תקציב נשאר לי?" | `get_budgets` | current cycle |
| "מה המינויים שלי?" | `get_recurring_payments` | — |
| "כמה אני משלם בתשלומים?" | `get_recurring_payments` | — |
| "מה היתרה שלי בעוד חודש?" | `get_balance_projection` | — |
| "מתי החיוב הבא של הכרטיס?" | `get_balance_projection` | — |
| "מתי עודכנו הנתונים לאחרונה?" | `get_sync_status` | — |
| "אילו חשבונות מחוברים?" | `list_accounts` | — |
| "רוצה להוסיף הוצאה ידנית" | `add_manual_expense` | confirm first! |
| "כמה הוצאתי על מכולת ב-3 חודשים?" | `get_category_expenses` × 3 | one call per billingCycle |
| "תשווה לחודש שעבר" | `get_category_breakdown` × 2 | current + previous billingCycle |
| "כמה שילמתי ל-YES/HOT?" | `search_transactions` | `query: "yes"` or `"hot"` |
| "הוצאות לפי כרטיס" | `get_monthly_summary` | `groupBy: "last4digits"` |

---

## Tool Chaining Patterns

### Pattern 1: Category drill-down
1. `get_category_breakdown` → see all categories and totals
2. `get_category_expenses` for the category the user wants to explore → see individual transactions

### Pattern 2: Month comparison
1. `get_category_breakdown` for this month
2. `get_category_breakdown` for last month
3. Compare manually in your response

### Pattern 3: Unknown category name
1. `get_all_categories` → get exact category names
2. `get_category_expenses` with the exact name

### Pattern 4: Before major analysis
1. `get_sync_status` → verify data is current (especially if data seems stale)
2. Proceed with query tools

### Pattern 5: Subscription audit
1. `get_recurring_payments` → see all recurring and installments
2. `search_transactions` for specific service if user wants details
3. Total up monthly cost manually

---

## Error Reference

| Error | Meaning | Action |
|---|---|---|
| "Error: API request failed: 401" | Vault is locked | Tell user to unlock vault in Nudlers app |
| "No data found for the specified period" | No transactions in that period | Check sync status, or period may be empty |
| "No accounts configured" | No bank accounts set up | User needs to configure accounts in Nudlers |
| Server connection refused | Nudlers app not running | Tell user to start the app |
| "No projection data available" | No bank balance data | May need to sync bank accounts first |
