# Payment Method Classification & Debit Card Reconciliation

**Date:** 2026-06-26
**Status:** Draft
**Scope:** Fix debit/credit card classification, double-counting in summaries, and reconciliation merchant name propagation

## Problem Statement

Three interconnected bugs in transaction handling:

1. **No debit/credit distinction in transactions** — `transaction_type` only knows `credit_card` or `bank`. Debit card transactions from credit card vendors (e.g., Visa Cal debit) are classified as `credit_card`, making debit breakdown show ₪0.00.

2. **Double-counting** — Debit card purchases appear twice in DB: once from credit card vendor scraper (`transaction_type = 'credit_card'`) and once from bank scraper (`transaction_type = 'bank'`). Both are counted in summaries even after reconciliation.

3. **Reconciliation gaps** — After matching, merchant name from credit card side doesn't propagate to bank transaction (which shows generic names like "כרטיס אשראי"). Debit card transactions are not auto-reconciled against their bank counterparts.

## Design

### Section 1: Schema Changes

**New column `payment_method`** on `transactions` table with 3 values:

| Value | Meaning | Date Grouping | Billing Cycle |
|-------|---------|---------------|---------------|
| `credit` | Credit card, monthly billing | `processed_date` → billing cycle month | Uses `billing_cycle_start_day` (default 10) |
| `debit` | Debit card, immediate charge | `t.date` (transaction day) | None — immediate |
| `bank_direct` | Direct bank operation | `t.date` | None |

**New column `original_name`** on `transactions` table — preserves bank's original transaction name before merchant name propagation overwrites it.

**Card settings UI:**
- When card `is_debit = true`: hide "יום חיוב" field (irrelevant for debit), show "סוג כרטיס" as "דביט" instead of "אשראי (מחזורי)"
- Set `billing_cycle_start_day = NULL` for debit cards in `card_vendors`

**Backfill existing data:**
```sql
UPDATE transactions t SET payment_method =
  CASE
    WHEN t.transaction_type = 'bank' THEN 'bank_direct'
    WHEN EXISTS (
      SELECT 1 FROM card_vendors cv
      WHERE cv.last4_digits = RIGHT(t.account_number, 4)
      AND cv.is_debit = true
    ) THEN 'debit'
    ELSE 'credit'
  END;
```

### Section 2: Reconciliation Fixes

**A. Auto-reconcile debit card transactions:**

On scraper insert of debit card transaction → search for matching bank transaction:
- Same linked bank account
- Same absolute amount (±₪0.01 tolerance)
- Date within ±1 day
- If match found → create `transaction_reconciliations` entry with `status = 'approved'`, `confidence = 0.95`

Debit txns are nearly identical to bank txns (same day, same amount) — much higher auto-match confidence than monthly credit card charges.

**B. Merchant name propagation:**

When reconciliation is approved (auto or manual) → copy `name` from credit card/debit transaction to matched bank transaction. Store bank's original name in `original_name` before overwrite.

**C. Summary exclusion verification:**

Existing `reconciliationExclusion` filter in monthly-summary.js (lines 72-86) already excludes reconciled bank txns with `status = 'approved'`. Verify this applies consistently across all groupBy modes and that debit-card reconciled bank txns are properly excluded from `bank_direct` totals.

### Section 3: Summary/Breakdown Calculation

**New breakdown structure (summary bar):**
```
סה"כ הוצאות: ₪30,914.35
├── אשראי: ₪11,376.87     (payment_method = 'credit')
├── דביט: ₪X,XXX.XX       (payment_method = 'debit')
└── ישיר מבנק: ₪19,537.48  (payment_method = 'bank_direct')
```

**Query changes in monthly-summary.js:**

Replace all `CASE WHEN t.transaction_type = 'credit_card' THEN -t.price` with:

```sql
CASE WHEN t.payment_method = 'credit' THEN ABS(t.price) ELSE 0 END as credit_expenses,
CASE WHEN t.payment_method = 'debit' THEN ABS(t.price) ELSE 0 END as debit_expenses,
CASE WHEN t.payment_method = 'bank_direct' AND t.price < 0 THEN ABS(t.price) ELSE 0 END as bank_expenses
```

Income calculation unchanged — only `bank_direct` with `price > 0` (salary, transfers in).

### Section 4: Scraper Integration

**In `scraperUtils.insertTransaction()`:**

After determining `transaction_type`, set `payment_method`:
- `transaction_type = 'bank'` → `payment_method = 'bank_direct'`
- `transaction_type = 'credit_card'` → lookup `card_vendors.is_debit` for card's last4 digits → `'debit'` or `'credit'`

The `is_debit` flag is already loaded at lines 532-543 for billing cycle calculation — reuse that lookup.

**Auto-reconciliation on insert:**

After inserting a debit card transaction:
1. Query recent bank transactions (same linked bank account, ±1 day, same amount)
2. If single match found → insert `transaction_reconciliations` with `status = 'approved'`, `confidence = 0.95`
3. Copy merchant name from debit txn to bank txn, save bank's original name to `original_name`

### Section 5: Migration

**Migration file: `020_payment_method.sql`**

1. `ALTER TABLE transactions ADD COLUMN payment_method VARCHAR(20) DEFAULT 'credit'`
2. `ALTER TABLE transactions ADD COLUMN original_name VARCHAR(255)`
3. Backfill `payment_method` from `transaction_type` + `card_vendors.is_debit`
4. `UPDATE card_vendors SET billing_cycle_start_day = NULL WHERE is_debit = true`
5. Post-migration: trigger reconciliation scan for historical debit-bank pairs

## Files Affected

| File | Changes |
|------|---------|
| `migrations/020_payment_method.sql` | New migration |
| `pages/api/utils/scraperUtils.js` | Set `payment_method` on insert, auto-reconcile debit |
| `pages/api/reports/monthly-summary.js` | Replace `card_expenses` with 3-way breakdown |
| `utils/reconciliation.js` | Add merchant name propagation on approval |
| `pages/api/reconciliation/candidates.js` | Handle debit auto-matching |
| `pages/api/reconciliation/[id].js` | Propagate name on approve action |
| `components/CategoryDashboard/SummaryBar.tsx` | Display 3-way breakdown |
| `components/CardVendorSettings.tsx` | Hide billing day for debit cards |
| `utils/transaction_logic.js` | No changes needed (already handles debit correctly) |

## Success Criteria

- Debit card transactions show correct totals in breakdown (not ₪0.00)
- No double-counting: each real-world transaction counted once
- After reconciliation, bank txn shows merchant name from credit card side
- Card settings hides billing day for debit cards
- Credit card txns grouped by billing cycle month, debit by transaction date
- Existing tests pass, new tests cover payment_method classification
