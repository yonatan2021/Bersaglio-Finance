# Implementation Plan: Payment Method Classification & Debit Reconciliation

**Spec:** docs/superpowers/specs/2026-06-26-payment-method-classification-design.md
**Branch:** main
**Base commit:** b0af289

## Global Constraints

- Follow existing code patterns: `createApiHandler` for APIs, parameterized SQL, `client.release()` in finally blocks
- Use CSS variables (`var(--n-*)`) for theme colors
- i18n: update both `he` and `en` locale files under `app/i18n/locales/`
- Migration number: `020` (next after `019_category_types.sql`)
- Tests: Vitest, mock `getDB` and `logger`, test success + error paths
- All SQL uses parameterized queries
- MUI components with TypeScript interfaces
- `payment_method` has exactly 3 values: `'credit'`, `'debit'`, `'bank_direct'`
- Debit cards have no billing cycle — `billing_cycle_start_day` must be NULL
- Reconciled bank transactions must be excluded from all summary calculations (existing pattern in monthly-summary.js lines 72-86)

## Task 1: Migration — payment_method & original_name columns

**Files:** `app/migrations/020_payment_method.sql`

Create migration:
```sql
-- Add payment_method column to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

-- Add original_name to preserve bank name before merchant propagation
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_name VARCHAR(255);

-- Backfill payment_method from transaction_type + card_vendors.is_debit
UPDATE transactions t SET payment_method =
  CASE
    WHEN t.transaction_type = 'bank' THEN 'bank_direct'
    WHEN EXISTS (
      SELECT 1 FROM card_vendors cv
      WHERE cv.last4_digits = RIGHT(t.account_number, 4)
      AND cv.is_debit = true
    ) THEN 'debit'
    ELSE 'credit'
  END
WHERE t.payment_method IS NULL;

-- Set default for future inserts
ALTER TABLE transactions ALTER COLUMN payment_method SET DEFAULT 'credit';

-- Clean up debit card billing cycle (debit = immediate, no cycle)
UPDATE card_vendors SET billing_cycle_start_day = NULL WHERE is_debit = true;

-- Add CHECK constraint
ALTER TABLE transactions ADD CONSTRAINT chk_payment_method
  CHECK (payment_method IN ('credit', 'debit', 'bank_direct'));

-- Index for summary queries
CREATE INDEX IF NOT EXISTS idx_transactions_payment_method ON transactions(payment_method);
```

**Tests:** None (migration only).

## Task 2: Scraper — set payment_method on insert

**Files:** `app/pages/api/utils/scraperUtils.js`

In `insertTransaction()` function (around line 569):

1. After line 538 where `isCardDebit` is determined, use it to set `payment_method`:
   - `isBank = true` → `payment_method = 'bank_direct'`
   - `isCardDebit = true` → `payment_method = 'debit'`
   - else → `payment_method = 'credit'`

2. Add `payment_method` to the INSERT statement (line 572):
   - Add column name to INSERT columns list
   - Add parameter value to VALUES list
   - Increment parameter index

3. Add to the `ON CONFLICT` clause: when a transaction already exists, don't overwrite `payment_method`.

4. Add `payment_method` to the historyCache update (line 576).

**Tests:** `app/tests/scraperUtils-payment-method.test.ts`
- Bank transaction gets `payment_method = 'bank_direct'`
- Credit card transaction (non-debit) gets `payment_method = 'credit'`
- Credit card transaction from debit card gets `payment_method = 'debit'`
- Existing transaction (ON CONFLICT) preserves payment_method

## Task 3: Reconciliation — auto-match debit + merchant name propagation

**Files:**
- `app/utils/reconciliation.js` (modify)
- `app/pages/api/reconciliation/action.js` (modify)

**A. Auto-reconcile debit txns (reconciliation.js):**

Add function `autoReconcileDebitTransaction(client, debitTxn)`:
- Takes a debit card transaction (just inserted)
- Searches bank transactions: same linked bank account, amount match (±₪0.01), date ±1 day
- If exactly one match found with confidence ≥ 0.9 → auto-create `transaction_reconciliations` entry with `status = 'approved'`, `confidence = 0.95`
- Call `propagateMerchantName()` on the match
- Return whether auto-reconciled

**B. Merchant name propagation:**

Add function `propagateMerchantName(client, reconciliation)`:
- Takes an approved reconciliation record
- Fetches cc transaction name
- Updates bank transaction: set `original_name = name` (preserve original), set `name = cc_name`
- Only propagate if bank name is generic (use existing `isGenericDebit` heuristic from line 82-92)

**C. Action.js — propagate on manual approval:**

In `action.js`, after updating status to `'approved'`:
- Call `propagateMerchantName(client, result.rows[0])`
- Import from `reconciliation.js`

**Tests:** `app/tests/reconciliation-debit.test.ts`
- Auto-reconcile: debit txn with matching bank txn → creates approved match
- Auto-reconcile: no bank match → no match created
- Auto-reconcile: multiple bank matches → no auto-match (ambiguous)
- Merchant name propagation: generic bank name updated with cc name
- Merchant name propagation: non-generic bank name not overwritten
- original_name preserved after propagation
- Manual approval triggers name propagation

## Task 4: Monthly summary — 3-way payment method breakdown

**Files:** `app/pages/api/reports/monthly-summary.js`

Replace all `card_expenses` calculation with 3 separate fields:

**In every SELECT that has `card_expenses` (lines 144-146, 165-167, 184-186, 223-225):**

Replace:
```sql
COALESCE(SUM(
  CASE WHEN t.transaction_type = 'credit_card' THEN -t.price ELSE 0 END
), 0)::numeric as card_expenses
```

With:
```sql
COALESCE(SUM(CASE WHEN t.payment_method = 'credit' AND t.price < 0 THEN ABS(t.price) ELSE 0 END), 0)::numeric as credit_expenses,
COALESCE(SUM(CASE WHEN t.payment_method = 'debit' AND t.price < 0 THEN ABS(t.price) ELSE 0 END), 0)::numeric as debit_expenses,
COALESCE(SUM(CASE WHEN t.payment_method = 'bank_direct' AND t.price < 0 THEN ABS(t.price) ELSE 0 END), 0)::numeric as bank_direct_expenses
```

Also replace `bank_income` and `bank_expenses` to use `payment_method`:
```sql
COALESCE(SUM(CASE WHEN t.payment_method = 'bank_direct' AND t.price > 0 THEN t.price ELSE 0 END), 0)::numeric as bank_income,
```

**In ORDER BY maps (lines 114-121):**
Replace `card_expenses` references with sum of all 3 expense types.

**Keep backward compat in transform (line 249-257):**
Add `card_expenses` as sum of `credit_expenses + debit_expenses` for any consumer that still expects it:
```javascript
item.card_expenses = Number(item.credit_expenses || 0) + Number(item.debit_expenses || 0);
```

**Tests:** Update `app/tests/monthly_summary_api.test.ts`
- Response includes `credit_expenses`, `debit_expenses`, `bank_direct_expenses`
- `card_expenses` backward compat = credit + debit sum
- Debit transactions counted in `debit_expenses` not `credit_expenses`
- Reconciled bank txns excluded from `bank_direct_expenses`

## Task 5: Frontend — summary bar 3-way breakdown

**Files:**
- `app/components/MonthlySummary.tsx`
- `app/i18n/locales/he.json`
- `app/i18n/locales/en.json`

**MonthlySummary.tsx changes:**

1. Update `BankCCSummary` interface (line 49): add `credit_expenses`, `debit_expenses`, `bank_direct_expenses` fields

2. Update totals calculation (around line 1026): accumulate 3 expense types separately

3. Update summary bar display (around line 1190-1260):
   - Show breakdown: `אשראי: ₪X | דביט: ₪Y | ישיר מבנק: ₪Z`
   - Total expenses = sum of all 3
   - Budget comparison uses total expenses

4. Update card classification logic (around line 592-630):
   - Use `debit_expenses > 0` to identify debit cards
   - Use `credit_expenses > 0` to identify credit cards
   - Use `bank_direct_expenses > 0` to identify bank accounts

**i18n keys to add:**
- `he`: `summary.creditExpenses`: "אשראי", `summary.debitExpenses`: "דביט", `summary.bankDirectExpenses`: "ישיר מבנק"
- `en`: `summary.creditExpenses`: "Credit", `summary.debitExpenses`: "Debit", `summary.bankDirectExpenses`: "Bank Direct"

**Tests:** No component tests (UI change, verify via preview).

## Task 6: CardVendorsModal — hide billing day for debit

**Files:** `app/components/CardVendorsModal.tsx`

Current state: lines 687-705 already handle `is_debit` — shows "N/A" and disables click on billing day field. But:

1. In table header row: when `is_debit`, show "סוג כרטיס" as "דביט" instead of "אשראי (מחזורי)" — **already done at line 631**

2. In edit form: when `isDebit` toggle is on, hide/disable billing cycle day input entirely (not just show N/A in display mode)

3. On save: when `is_debit = true`, force `billing_cycle_start_day = null` regardless of form value

**Tests:** No component tests (UI change, verify via preview).
