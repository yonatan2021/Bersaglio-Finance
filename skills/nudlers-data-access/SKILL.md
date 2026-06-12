---
name: nudlers-data-access
description: "Complete reference for Nudlers MCP tools: 29 financial tools for Israeli bank/credit data. Covers all parameters, date formats, billing cycle concepts (credit vs. debit, custom billing days), quick-lookup table, and error handling. Use this skill whenever you need to know which MCP tool to call and with what parameters."
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

Nudlers is a personal finance app for Israeli banks and credit cards. It exposes an MCP server with 27 tools for querying transactions, budgets, subscriptions, financial projections, sync controls, anomalies, and rules.

## Connection

- **URL**: `http://localhost:6969/api/mcp`
- **Transport**: SSE (Server-Sent Events)
- **MCP server name**: `nudlers`
- **Version**: 1.0.0

If the server is not running, Nudlers app must be started first (`npm run dev` or `npm start` in the `app/` directory).

## Key Concept: Billing Cycle

**Critical**: Nudlers does NOT group by calendar month. It uses billing cycles.

- **Default billing cycle start**: Credit cards default to **day 10 of each month**. However, this start day is customizable on a per-card basis (values between 1 and 28).
- **Debit vs Credit**: 
  - **Debit cards** are billed immediately. Therefore, their effective billing cycle start day is always **1** (day 1 of each month).
  - **Credit cards** default to start day 10, or use their configured `billing_cycle_start_day`.
- **SQL / Grouping Logic**:
  - If a transaction's day of month is `>= startDay`, it falls into that month's cycle (`YYYY-MM`).
  - If the day of month is `< startDay`, it falls into the previous month's cycle (`YYYY-MM-1`).
- **Example (Start day = 10)**:
  - `billingCycle: "2025-04"` means: **10 March 2025 → 9 April 2025**
- **Example (Start day = 15)**:
  - `billingCycle: "2025-04"` means: **15 March 2025 → 14 April 2025**
- **Example (Debit Card / Start day = 1)**:
  - `billingCycle: "2025-04"` means: **1 April 2025 → 30 April 2025**
- When the user says "last month" or "this month", use `billingCycle`, not date ranges.
- Current month default: tools auto-compute it when no date params are passed.

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

### 13. `trigger_full_sync`

Run a full synchronization scraper run for all active bank accounts and credit cards to fetch the latest transactions.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `daysBack` | number | no | `30` | Number of days back to sync |

**Returns:** A summary status of each account synchronized, plus execution stats (saved transactions, updated transactions, duration).

**⚠️ Important Handling**: The SSE stream outputs details of which accounts succeeded and which failed, along with synchronization statistics. Do not report a general "sync succeeded" if some accounts failed. Report the status of each connected account explicitly, along with the stats (saved transactions, updated transactions, duration) clearly.

**Use when:** User asks to sync data, updates are missing, or the sync status check shows data is stale.

---

### 14. `get_vault_status`

Check if the application credentials vault is locked or unlocked. Scrapers cannot run when the vault is locked.

No parameters.

**Returns:** Vault lock status (`locked: true/false`) and initialization status.

**Use when:** Checking status before calling `trigger_full_sync`, or diagnosing scraper/sync failures.

---

### 15. `get_anomalies`

Get a list of detected financial anomalies (unusual activity, spikes, duplicate charges, etc.).

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `status` | enum | no | `"open"` | `"open"` \| `"acknowledged"` \| `"dismissed"` \| `"normal"` |

**Returns:** List of anomalies, including severity, title, and descriptive body text.

**Use when:** User asks about unusual charges, suspicious transactions, or general financial anomalies.

---

### 16. `trigger_anomaly_evaluation`

Manually trigger the anomaly detection engine over all transactions to check for new discrepancies. No parameters.

**Returns:** Summary containing open anomalies count, evaluated transactions count, and new anomalies detected.

**Use when:** User asks to scan or check for anomalies, or after a new data sync is completed.

---

### 17. `update_anomaly_status`

Update the status of an anomaly (e.g. acknowledge or dismiss it).

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | number | **yes** | — | The ID of the anomaly |
| `status` | enum | **yes** | — | `"acknowledged"` \| `"dismissed"` \| `"normal"` |

**Returns:** Confirmation message.

**Use when:** User wants to dismiss or acknowledge a warning/anomaly.

---

### 18. `set_category_budget`

Set or update the budget limit for a specific spending category.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `category` | string | **yes** | — | Category name |
| `budgetLimit` | number | **yes** | — | The budget limit in ILS |

**Returns:** Confirmation message with the updated budget limit.

**Use when:** User wants to set or adjust a budget for a category.

---

### 19. `set_total_budget`

Set or update the total overall monthly budget limit.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `budgetLimit` | number | **yes** | — | Total budget limit in ILS (> 0) |

**Returns:** Confirmation message.

**Use when:** User wants to set/change their overall monthly spending limit.

---

### 20. `get_total_budget`

Get the overall monthly budget limit. No parameters.

**Returns:** Current monthly budget limit, or indicates if it is not set.

**Use when:** Reviewing budget guidelines or comparing total spending to the overall budget.

---

### 21. `update_category_by_description`

Update the category for all past transactions matching a description, and optionally create a categorization rule for future occurrences.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `description` | string | **yes** | — | Exact description substring to match |
| `newCategory` | string | **yes** | — | New category name |
| `createRule` | boolean | no | `true` | Create rule for future transactions (Hermes should confirm with user) |

**Returns:** Summary of transactions updated and whether a rule was created.

**⚠️ Rules Protocol**: By default, `createRule` is true. Hermes should explain this to the user and ask if they want this change to apply automatically to all future transactions as a permanent rule.

**Use when:** User corrects a categorization for a recurring merchant description.

---

### 22. `list_categorization_rules`

List all active custom transaction categorization rules. No parameters.

**Returns:** List of active rules containing rule ID, name pattern to match, target category, and status.

**Use when:** User asks what rules are active, or when auditing categorization behavior.

---

### 23. `create_categorization_rule`

Manually create a new transaction categorization rule to auto-classify future transactions.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `namePattern` | string | **yes** | — | Description substring pattern to match |
| `targetCategory` | string | **yes** | — | Category name to assign |

**Returns:** Confirmation message with the new rule ID.

**Use when:** User wants to set up a new auto-categorization rule.

---

### 24. `delete_categorization_rule`

Delete a custom transaction categorization rule.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | number | **yes** | — | The ID of the rule to delete |

**⚠️ Caution**: This operation is irreversible. Hermes must request confirmation from the user before executing this tool.

**Use when:** User requests to delete/remove an auto-categorization rule.

---

### 25. `apply_categorization_rules`

Run all active categorization rules over all transactions in the database. No parameters.

**⚠️ Warning**: This is a heavy database operation that scans all historical transactions and applies active rules to them. It can significantly change past transaction categories.
Before invoking this tool, Hermes **MUST explain to the user** what is about to happen (that all historical transactions will be re-evaluated under current rules, potentially updating categories in bulk, which is a heavy DB operation). Explicit user confirmation/approval is NOT strictly mandatory, but explaining the impact to the user beforehand is required.

**Use when:** User adds/modifies rules and wants to apply them retroactively to their history.

---

### 26. `update_transaction_details`

Update metadata of an existing transaction (such as category, notes, or favorite status).

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | **yes** | — | Transaction ID in format `identifier\|vendor` |
| `category` | string | no | — | New category name |
| `isFavorite` | boolean | no | — | Favorite status |
| `notes` | string | no | — | Personal notes |

**⚠️ Secure Guards**: You cannot edit core transaction amounts (price) or transaction dates. These fields are protected and not accepted by this tool.

**Use when:** User wants to tag a transaction, set favorite status, add custom notes, or change the category of a single specific transaction.

---

### 27. `manage_non_recurring_exclusion`

Mark or unmark a transaction description as non-recurring to exclude/include it in subscription analysis.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `action` | enum | **yes** | — | `"add"` \| `"remove"` |
| `name` | string | **yes** | — | Transaction description |
| `accountNumber` | string | no | — | Specific bank account/card number |

**Returns:** Confirmation message.

**Use when:** Excluding one-off transactions that are wrongly identified as subscriptions, or restoring them.

---

### 28. `list_cards`

List all credit and debit cards configured in the system, including their nicknames, vendor, transactions count, type (credit/debit), and billing cycle start day.

No parameters.

**Returns:** List of configured cards with digits, nickname, vendor, type (Credit or Debit), billing day, and transaction count.

**Use when:** User asks what cards they have, wants to check if a card is debit/credit, or wants to find a card's current billing cycle start day.

---

### 29. `configure_card`

Configure settings for a specific card, including setting its brand/vendor, nickname, type (credit/debit), and billing cycle start day.

**Parameters:**
| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `last4Digits` | string | **yes** | — | Last 4 digits of the card to configure (e.g., `"1234"`) |
| `cardVendor` | string | **yes** | — | Card vendor/brand (e.g., `"visa"`, `"mastercard"`, `"max"`, `"isracard"`, `"amex"`, `"diners"`) |
| `cardNickname` | string | no | — | Friendly nickname for the card |
| `isDebit` | boolean | no | — | `true` if debit card (immediate billing), `false` if credit |
| `billingCycleStartDay` | number | no | — | Billing day of the month (1–28). Only applicable for credit cards. |

**Returns:** Confirmation message with the updated card properties.

**Use when:** User wants to set a nickname, change a card to debit, or customize a credit card's billing day.

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
| "סנכרן את החשבונות שלי / תמשוך נתונים חדשים" | `trigger_full_sync` | check vault lock status first! |
| "האם הכספת נעולה? / מה מצב הכספת?" | `get_vault_status` | — |
| "האם יש עסקאות חריגות? / תבדוק חריגות" | `get_anomalies` | `status: "open"` |
| "תריץ בדיקה של חריגות/אנומליות" | `trigger_anomaly_evaluation` | — |
| "תאשר את החריגה הזו / תתעלם מחריגה 101" | `update_anomaly_status` | `id: 101`, `status: "acknowledged"` / `"dismissed"` |
| "תגדיר תקציב של 1000 ש"ח למסעדות" | `set_category_budget` | `category: "Dining"`, `budgetLimit: 1000` |
| "תעדכן את התקציב הכללי ל-5000 ש"ח" | `set_total_budget` | `budgetLimit: 5000` |
| "מה התקציב הכללי שלי החודש?" | `get_total_budget` | — |
| "תשנה את כל עסקאות וולט למסעדות" | `update_category_by_description` | `description: "Wolt"`, `newCategory: "Dining"`, ask user for rule |
| "אילו חוקי קטלוג קיימים?" | `list_categorization_rules` | — |
| "תיצור חוק קטלוג חדש עבור פנגו לתחבורה" | `create_categorization_rule` | `namePattern: "Pango"`, `targetCategory: "Transportation"` |
| "תמחק את חוק הקטלוג 5" | `delete_categorization_rule` | `id: 5` (confirm first!) |
| "תחיל את כל החוקים על העסקאות הישנות" | `apply_categorization_rules` | explain potential impacts first! |
| "תעדכן את הקטגוריה של העסקה הזו לבידור / תוסיף הערה לעסקה" | `update_transaction_details` | `id: "ID"`, category/notes/isFavorite only (no price/date) |
| "אל תספור את נטפליקס כמנוי קבוע / תספור את X כמנוי" | `manage_non_recurring_exclusion` | `action: "add"` / `"remove"`, `name: "netflix"` |
| "אילו כרטיסים מוגדרים אצלי? / אילו כרטיסי אשראי יש?" | `list_cards` | — |
| "תגדיר שכרטיס 4321 הוא כרטיס דביט מיידי" | `configure_card` | `last4Digits: "4321"`, `isDebit: true`, `cardVendor: "visa"` |
| "תשנה את יום החיוב של כרטיס 8765 ל-15 בחודש" | `configure_card` | `last4Digits: "8765"`, `billingCycleStartDay: 15`, `cardVendor: "max"` |
| "תן שם חיבה לכרטיס 9999" | `configure_card` | `last4Digits: "9999"`, `cardNickname: "Nickname"`, `cardVendor: "isracard"` |

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

### Pattern 6: Running a Synchronization
1. `get_vault_status` → verify if the vault is unlocked
2. If vault is locked, ask the user to unlock it in the Nudlers web app (Hermes cannot unlock the vault).
3. If vault is unlocked, call `trigger_full_sync`
4. Parse the SSE response summary, and explicitly report individual account status successes and failures.

### Pattern 7: Card configuration update
1. `list_cards` → see all existing cards and retrieve their details (vendor, nickname, type, current billing cycle start day).
2. Formulate the call to `configure_card` ensuring you use the correct `last4Digits` and provide the required `cardVendor`.
3. Call `configure_card` and present the updated status to the user.

---

## Error Reference

| Error | Meaning | Action |
|---|---|---|
| "Error: API request failed: 401" | Vault is locked | Tell user to unlock vault in Nudlers app |
| "No data found for the specified period" | No transactions in that period | Check sync status, or period may be empty |
| "No accounts configured" | No bank accounts set up | User needs to configure accounts in Nudlers |
| Server connection refused | Nudlers app not running | Tell user to start the app |
| "No projection data available" | No bank balance data | May need to sync bank accounts first |
