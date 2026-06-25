# Income/Expense Accuracy & Double-Count Fix

**Date:** 2026-06-25
**Status:** Draft
**Scope:** Category type system, report query fixes, summary bar improvements

## Problem Statement

Two accuracy issues in financial reporting:

1. **Income treated as expense** — No category type distinction. Salary, disability benefits, rental income all count toward "expenses" in budget and summary calculations. Categories have no `income`/`expense` classification.

2. **Double-counting** — Credit card charges appear as individual CC transactions AND as lump-sum bank debits on billing date. The `transaction_reconciliations` system exists to match these, but report APIs (`monthly-summary`, `budget-vs-actual`) don't filter reconciled bank transactions — only the transaction list API does.

**Result:** Summary bar shows inflated "סה״כ חיובים" (e.g., ₪21K instead of actual spend), and income appears mixed into expense totals.

## Design

### 1. Category Types Table

New table to classify categories as income, expense, or transfer:

```sql
CREATE TABLE IF NOT EXISTS category_types (
  category VARCHAR(50) PRIMARY KEY,
  type VARCHAR(10) NOT NULL DEFAULT 'expense'
    CHECK (type IN ('income', 'expense', 'transfer')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Type definitions:**
- `expense` — Default. Regular spending (groceries, bills, subscriptions, etc.)
- `income` — Money received: salary, disability benefits, rental income, refunds, reimbursements
- `transfer` — Movement between own accounts. Excluded from all summaries.

**Migration auto-seeds:**
- All existing categories inserted as `expense`
- Auto-detect and mark as `income`: categories matching `משכורת`, `Salary`, `Income`, `הכנסה`

**API — `GET /api/categories/types`:**
Returns all categories with their types:
```json
[
  { "category": "סופר", "type": "expense", "count": 45 },
  { "category": "משכורת", "type": "income", "count": 2 }
]
```

**API — `PATCH /api/categories/types`:**
Update type for one or more categories:
```json
{ "categories": [{ "category": "השכרה", "type": "income" }] }
```

Upserts into `category_types` — if category doesn't exist in table yet, creates it.

### 2. Double-Count Fix — Report Queries

Add reconciliation filter to all report APIs. When a bank transaction has an approved reconciliation match, exclude it from aggregation (credit card version = source of truth).

**Filter clause added to `monthly-summary.js` and `budget-vs-actual.js`:**

```sql
AND NOT (
  t.transaction_type = 'bank'
  AND EXISTS (
    SELECT 1 FROM transaction_reconciliations tr
    WHERE tr.bank_identifier = t.identifier
      AND tr.bank_vendor = t.vendor
      AND tr.status = 'approved'
  )
)
```

**Affected files:**
- `app/pages/api/reports/monthly-summary.js`
- `app/pages/api/reports/budget-vs-actual.js`

### 3. Summary Bar — Income/Expense Separation

**Data changes in transaction queries:**

All transaction-returning APIs JOIN with `category_types`:

```sql
LEFT JOIN category_types ct ON t.category = ct.category
```

Add to SELECT: `COALESCE(ct.type, 'expense') as category_type`

**Frontend — TransactionsSummaryBar redesign:**

Current logic `is_credit: price > 0` replaced with `category_type`-based classification:

```
totalExpenses = SUM(ABS(price)) WHERE category_type = 'expense'
totalIncome   = SUM(ABS(price)) WHERE category_type = 'income'
net           = totalIncome - totalExpenses
```

Transactions with `category_type = 'transfer'` excluded from all totals.

**Display layout (RTL):**

| Element | Label | Color | Icon |
|---------|-------|-------|------|
| Expenses | סה״כ הוצאות | `--n-error` (#DC2626) | TrendingDown |
| Income | סה״כ הכנסות | `--n-success` (#059669) | TrendingUp |
| Net | נטו | Dynamic (green if positive, red if negative) | — |
| Breakdown | פירוט | neutral | — |

**Breakdown row:** Shows expense sources only: אשראי / דביט / ישיר מבנק.

**UX fixes incorporated:**
- Font size: `0.75rem` minimum (was `0.7rem` = 11.2px, below readable threshold)
- Numbers: `font-variant-numeric: tabular-nums` for aligned columns
- Color + icon: Not color-only — each stat gets a directional icon (WCAG `color-not-only`)
- Contrast: Verify `--n-error` and `--n-success` meet 4.5:1 against both theme backgrounds

### 4. Budget System — Exclude Income & Transfer

**Change in `budget-vs-actual.js`:**

Replace current filter:
```sql
AND COALESCE(category, '') != 'Bank'
```

With:
```sql
LEFT JOIN category_types ct ON t.category = ct.category
...
AND COALESCE(ct.type, 'expense') = 'expense'
```

Only `expense` categories participate in budget calculations. Income and transfer categories are invisible to the budget system.

### 5. Category Type Management UI

**Location:** Inline in existing category management (CategoryDashboard).

**Behavior:** Each category row shows a chip/dropdown indicating its type:
- הוצאה (default, gray chip)
- הכנסה (green chip)
- העברה (blue chip)

Clicking the chip opens a small popover/dropdown to change the type. Change triggers `PATCH /api/categories/types`.

**No new page needed.** Category type is a property of the category, shown where categories are already listed.

### 6. Monthly Summary (MonthlySummary.tsx)

**Income display in bank account cards:**

Bank account summary cards already show `bank_income` and `bank_expenses`. After this change:
- Income from `income`-type categories shown as "הכנסות" with green color
- Expenses from `expense`-type categories shown as "הוצאות" with red color
- Transfer-type transactions excluded from net flow calculation

**Hero card (total card spend):** Excludes income and transfer categories from total. Budget progress bar reflects expenses only.

## Files Changed

| File | Change |
|------|--------|
| New migration `0XX_category_types.sql` | Create table, seed data |
| `pages/api/categories/types.js` | New — GET/PATCH category types |
| `pages/api/categories/index.js` | JOIN category_types, return type |
| `pages/api/reports/monthly-summary.js` | Add reconciliation filter + category_type JOIN |
| `pages/api/reports/budget-vs-actual.js` | Add reconciliation filter + replace Bank filter with category_type |
| `pages/api/transactions/index.js` | Add category_type to response |
| `components/CategoryDashboard/components/TransactionsTable.tsx` | Redesign summary bar |
| `components/MonthlySummary.tsx` | Use category_type for income/expense separation |
| i18n files | Add new labels: הוצאות, הכנסות, העברה |

## Out of Scope

- Reconciliation accuracy improvements (separate effort)
- Auto-reconciliation algorithm tuning
- Income budgeting / savings goals
- Per-transaction type override (type comes from category only)
