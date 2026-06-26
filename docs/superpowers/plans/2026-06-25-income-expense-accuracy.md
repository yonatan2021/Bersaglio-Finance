# Implementation Plan: Income/Expense Accuracy & Double-Count Fix

**Spec:** docs/superpowers/specs/2026-06-25-income-expense-accuracy-design.md
**Branch:** main
**Base commit:** 9b3c1eb

## Global Constraints

- Follow existing code patterns: `createApiHandler` for APIs, parameterized SQL, `client.release()` in finally blocks
- Use CSS variables (`var(--n-*)`) for theme colors
- i18n: update both `he` and `en` locale files under `app/i18n/locales/`
- Migration number: `019` (next after `018_transaction_reconciliation.sql`)
- Tests: Vitest, mock `getDB` and `logger`, test success + error paths
- All SQL uses parameterized queries
- Category type defaults to `'expense'` via `COALESCE(ct.type, 'expense')` for uncategorized transactions
- MUI components with TypeScript interfaces

## Task 1: Migration — category_types table

**Files:** `app/migrations/019_category_types.sql`

Create migration:
```sql
CREATE TABLE IF NOT EXISTS category_types (
  category VARCHAR(50) PRIMARY KEY,
  type VARCHAR(10) NOT NULL DEFAULT 'expense'
    CHECK (type IN ('income', 'expense', 'transfer')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed all existing categories as expense
INSERT INTO category_types (category, type)
SELECT DISTINCT category, 'expense'
FROM transactions
WHERE category IS NOT NULL AND category != '' AND category != 'N/A'
ON CONFLICT (category) DO NOTHING;

-- Auto-detect income categories
UPDATE category_types SET type = 'income'
WHERE category IN ('משכורת', 'Salary', 'Income', 'הכנסה');
```

**Tests:** None (migration only).

## Task 2: Category Types API

**Files:**
- `app/pages/api/categories/types.js` (new)
- `app/pages/api/categories/index.js` (modify — add type to response)

**GET /api/categories/types:**
Query `category_types` joined with transaction count:
```sql
SELECT ct.category, ct.type, COALESCE(tc.count, 0) as count
FROM category_types ct
LEFT JOIN (
  SELECT category, COUNT(*) as count
  FROM transactions
  WHERE category IS NOT NULL AND category != ''
  GROUP BY category
) tc ON ct.category = tc.category
ORDER BY count DESC
```

**PATCH /api/categories/types:**
Accept body `{ categories: [{ category: string, type: 'income'|'expense'|'transfer' }] }`.
Validate type values. Upsert each into `category_types`.

**Modify `index.js`:**
Add LEFT JOIN with `category_types` to existing query, return `type` alongside `name` and `count`.

**Tests:** `app/tests/category-types-api.test.ts`
- GET returns categories with types and counts
- PATCH updates single category type
- PATCH upserts new category
- PATCH rejects invalid type value
- GET index.js returns type field

## Task 3: Report Queries — Double-Count Fix + category_type

**Files:**
- `app/pages/api/reports/monthly-summary.js`
- `app/pages/api/reports/budget-vs-actual.js`

**Both files — add reconciliation exclusion:**
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

**monthly-summary.js — add category_type:**
Add `LEFT JOIN category_types ct ON t.category = ct.category` and include `COALESCE(ct.type, 'expense') as category_type` in groupBy results. Adjust aggregation to separate income/expense/transfer sums.

**budget-vs-actual.js — replace Bank filter:**
Replace `AND COALESCE(category, '') != 'Bank'` with:
```sql
LEFT JOIN category_types ct ON t.category = ct.category
...
AND COALESCE(ct.type, 'expense') = 'expense'
```

Remove hardcoded credit card payment name exclusions (מסטרקרד, ישראכרט, etc.) if they now fall under transfer/income categories. If not, leave them — they serve a different purpose (hiding bank-side CC payment entries).

**Tests:** `app/tests/report-queries.test.ts`
- monthly-summary excludes reconciled bank transactions
- monthly-summary returns category_type field
- budget-vs-actual excludes income categories
- budget-vs-actual excludes transfer categories

## Task 4: Transactions API — add category_type

**Files:** `app/pages/api/transactions/index.js`

Add to the main query:
```sql
LEFT JOIN category_types ct ON t.category = ct.category
```

Add to SELECT: `COALESCE(ct.type, 'expense') as category_type`

Add to response transform: `category_type: row.category_type`

Keep existing `is_credit: row.price > 0` for backward compatibility — frontend will migrate to using `category_type`.

**Tests:** `app/tests/transactions-api-category-type.test.ts`
- Transactions response includes category_type field
- Default category_type is 'expense' for uncategorized

## Task 5: Summary Bar Redesign

**Files:**
- `app/components/CategoryDashboard/components/TransactionsTable.tsx` (TransactionsSummaryBar)
- `app/i18n/locales/he/tx.json`
- `app/i18n/locales/en/tx.json`

**Summary bar changes:**
Replace `is_credit`-based logic with `category_type`:
```typescript
transactions.forEach(tx => {
  const amount = Math.abs(tx.price);
  const catType = tx.category_type || 'expense';
  if (catType === 'transfer') return; // excluded
  if (catType === 'income') {
    totalIncome += amount;
  } else {
    totalExpenses += amount;
    if (tx.card_type === 'debit') debitTotal += amount;
    else if (tx.card_type === 'direct') directTotal += amount;
    else creditCardTotal += amount;
  }
});
```

**Display changes:**
- Label: "סה״כ הוצאות" (was "סה״כ חיובים"), "סה״כ הכנסות" (was "סה״כ זיכויים")
- Add TrendingDown icon next to expenses, TrendingUp next to income (import from `@mui/icons-material`)
- Net color: dynamic — `--n-success` if positive (income > expenses), `--n-error` if negative
- Font size: `0.75rem` minimum (was `0.7rem`)
- Add `fontVariantNumeric: 'tabular-nums'` to number Typography elements

**i18n updates:**
- `he/tx.json`: `summary.totalCharges` → keep key, change value to "סה״כ הוצאות"; `summary.totalCredits` → "סה״כ הכנסות"
- `en/tx.json`: `summary.totalCharges` → "Total Expenses"; `summary.totalCredits` → "Total Income"

**Update Transaction interface** — add `category_type?: string` field.

**Tests:** None needed — UI component, verify visually.

## Task 6: MonthlySummary — income/expense separation

**Files:** `app/components/MonthlySummary.tsx`

**Changes:**
- Hero card total: filter by `category_type !== 'income' && category_type !== 'transfer'` when summing card_expenses
- Bank account cards: use `category_type` to separate income vs expense display
- Transfer-type excluded from net flow

**Depends on:** Task 3 (monthly-summary API returns category_type), Task 4 (transactions API returns category_type)

**Tests:** None needed — UI component, verify visually.

## Task 7: Category Type Management UI

**Files:**
- `app/components/CategoryDashboard/components/TransactionsTable.tsx` or relevant category management component
- `app/i18n/locales/he/tx.json` (or `categoryMgmt.json`)
- `app/i18n/locales/en/tx.json` (or `categoryMgmt.json`)

**UI:** Each category in the category list/management shows a small chip:
- הוצאה (gray) / הכנסה (green `--n-success`) / העברה (blue `--n-primary`)
- Click opens popover with 3 options
- Selection calls `PATCH /api/categories/types`
- Optimistic update with error rollback

**Depends on:** Task 2 (API exists)

**Tests:** None — UI, verify visually.

## Verification

After all tasks:
1. Run `npm run test` — all tests pass
2. Run `npm run build` — no type errors
3. Visual: summary bar shows separate income/expenses with correct labels and icons
4. Visual: category management shows type chips
5. Verify: salary transactions excluded from budget totals
6. Verify: reconciled bank transactions not double-counted in summary
