# Transactions Table Enhancement — Design Spec

## Problem

The transactions page displays inaccurate information:
1. Generic bank names ("רכישה בדירקט-ישרא \ ויזה-דביט") persist instead of merchant names
2. The "כרטיס" column shows "חשבון ראשי" for debit card purchases — misleading
3. No visibility into which bank account is ultimately charged
4. No distinction between charges and credits
5. No indication of payment timing (immediate vs. billing cycle)
6. Double-counting between credit card and bank transactions distorts totals

## Approach

API-computed enrichment (Approach A). All required data already exists in the database through `card_ownership`, `card_vendors`, `vendor_credentials`, and `transaction_reconciliations` tables. No schema changes needed — enrich the API query with additional JOINs and computed fields, then update the frontend to display them.

## Table Column Structure

RTL order:

| Column | Content | Change |
|--------|---------|--------|
| **תיאור** | Merchant name. After reconciliation: CC merchant name on top, original bank name in small text below | Modified |
| **סוג** | Charge (red) / Credit (green) — icon + text | **New** |
| **קטגוריה** | No change | Existing |
| **סכום** | Absolute value, color derived from type column | Minor change |
| **תשלום** | "מיידי" / billing date / installments info | Modified |
| **כרטיס** | Card that made the purchase + reconciliation indicator. Direct bank = special icon | Modified |
| **חשבון בנק** | Bank account where money leaves/enters | **New** |
| **פעולות** | No change | Existing |

## Card Column Logic

Three states:

### 1. Regular credit card transaction
- Credit card company icon + last 4 digits
- If reconciled: ✓ indicator
- Example: `🟠 ····0061 ✓`

### 2. Debit card transaction (Visa Debit)
- Credit card company icon + last 4 digits + "דביט" tag
- Reconciliation indicator if relevant
- Example: `🟠 ····0061 דביט ✓`

### 3. Direct bank transaction (loan, fee, transfer)
- Bank icon 🏦 + "ישיר"
- No reconciliation indicator
- Example: `🏦 ישיר`

### Detection logic:
- `transaction_type = 'credit_card'` → check `card_vendors.is_debit` → credit or debit
- `transaction_type = 'bank'` + has approved reconciliation → show card from CC side
- `transaction_type = 'bank'` + no reconciliation + no card → direct bank

## Bank Account Column Logic

Shows which bank account the money actually leaves/enters.

### 1. Credit/debit card with linked bank
- Bank account name from `vendor_credentials.nickname` or `bank_account_number`
- Example: `חשבון ראשי` or `הפועלים ····1234`

### 2. Credit card without bank link
- Card not linked in `card_ownership`
- Display: `—` (not linked)
- Tooltip: "קשר כרטיס לחשבון בנק בהגדרות"

### 3. Direct bank transaction
- Bank account name from `vendor_credentials` by vendor
- Example: `חשבון ראשי`

## Payment Column Logic

Five states:

| # | State | Display |
|---|-------|---------|
| 1 | Debit (is_debit=true) | `מיידי` |
| 2 | Credit card + immediate charge (detected via reconciliation) | `מיידי (אשראי)` |
| 3 | Credit card + monthly billing | `חיוב 10/07` |
| 4 | Installments | `3/6 · חיוב 10/07` |
| 5 | Direct bank | `—` |

### Immediate charge detection on credit cards (state 2):
When a CC transaction has an approved reconciliation match, compare dates:
- Bank debit date close to transaction date (2-3 days) → immediate charge
- Bank debit date close to billing cycle day → monthly billing
- Bank transaction name contains "חיוב מיידי" → immediate charge

### Billing date calculation:
- Transaction date >= `billing_cycle_start_day` → billing next month
- Transaction date < `billing_cycle_start_day` → billing current month
- Logic already exists in `transaction_logic.js` (`getBillingCycleSql`)

## Charge/Credit Distinction

New "סוג" column:
- `price < 0` → חיוב (charge) — red indicator
- `price > 0` → זיכוי (credit) — green indicator
- Amount column displays absolute value; color comes from type column

## Summary & Breakdown

Displayed at table top/bottom:

```
סה״כ חיובים: ₪4,250  |  סה״כ זיכויים: ₪180  |  נטו: ₪4,070

📊 פירוט: אשראי ₪3,100 · דביט ₪650 · ישיר מבנק ₪500
```

### Counting rules:
- Reconciled transaction = counted once (CC side only, bank side hidden)
- Unreconciled transaction = counted normally
- Credits separated from charges
- Breakdown by 3 types: credit card / debit / direct bank

### New filters:
- By type (credit card / debit / direct bank)
- By bank account
- By specific card
- Summaries update according to active filter

## API Query Changes

File: `app/pages/api/transactions/index.js`

### New/enhanced JOINs:
```sql
-- Existing: card_ownership, vendor_credentials, reconciliation
LEFT JOIN card_ownership co ON t.vendor = co.vendor
  AND t.account_number = co.account_number
LEFT JOIN vendor_credentials vc ON co.credential_id = vc.id
LEFT JOIN transaction_reconciliations tr ON ...
LEFT JOIN transactions cc ON ...

-- New: card_vendors for debit/cycle detection
LEFT JOIN card_vendors cv ON t.account_number = cv.last4_digits

-- New: bank credential for direct bank transactions
LEFT JOIN vendor_credentials bank_vc ON t.vendor = bank_vc.vendor
```

### New fields returned by API:

| Field | Source | Description |
|-------|--------|-------------|
| `display_name` | `COALESCE(cc.name, t.name)` | Merchant name (existing, enhanced) |
| `original_name` | `t.name` | Original bank-side name |
| `card_type` | `cv.is_debit` | debit / credit / direct |
| `card_label` | `cv.card_vendor + last4` | Card display label |
| `bank_account` | `vc.nickname / bank_vc.nickname` | Bank account name |
| `is_reconciled` | `tr.status = 'approved'` | Whether reconciled |
| `payment_type` | Computed | immediate / monthly / installments |
| `billing_date` | Computed from `billing_cycle_start_day` | Billing date |
| `is_credit` | `t.price > 0` | Charge vs credit |

### No schema changes required.

## Frontend Changes

File: `app/components/CategoryDashboard/components/TransactionsTable.tsx`

- Add "סוג" column with charge/credit icon
- Modify "תיאור" to show `display_name` + `original_name` subtitle when reconciled
- Modify "כרטיס" column to handle 3 states (credit/debit/direct)
- Add "חשבון בנק" column
- Modify "תשלום" column for 5 states
- Add summary bar with breakdown
- Add new filter options (type, bank account, card)
