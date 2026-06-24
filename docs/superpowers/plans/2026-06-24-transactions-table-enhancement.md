# Transactions Table Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the transactions table with accurate card type, bank account, payment timing, and charge/credit info so users get a true financial picture without double-counting.

**Architecture:** API-computed approach — enrich the existing GET `/api/transactions` query with additional JOINs to `card_vendors`, linked bank account `vendor_credentials`, and reconciliation data. Frontend renders new/modified columns from the enriched response. No schema migrations.

**Tech Stack:** Next.js Pages Router, PostgreSQL, TypeScript, MUI v6, react-i18next, Vitest

## Global Constraints

- No database schema changes — all data computed from existing tables
- Use CSS variables (`var(--n-*)`) for all colors
- Use `react-i18next` for all user-visible strings (both `he` and `en` locales)
- Follow existing `createApiHandler` pattern for API changes
- Use existing `CardVendorIcon` component for card brand icons
- Run `npm run lint` and `npm run test` from `app/` after each task

---

### Task 1: Enrich API Response

**Files:**
- Modify: `app/pages/api/transactions/index.js:280-322` (main query)

**Interfaces:**
- Consumes: existing tables `card_vendors`, `vendor_credentials`, `card_ownership`, `transaction_reconciliations`
- Produces: new fields in API response: `original_name`, `display_name`, `is_reconciled`, `card_type`, `is_debit`, `bank_account_name`, `billing_cycle_start_day`, `bank_debit_date`, `cc_account_number`, `cc_vendor_name`

- [ ] **Step 1: Write the failing test**

Create `app/tests/transactions-enrichment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMocks } from 'node-mocks-http';

vi.mock('../../pages/api/db', () => ({
  getDB: vi.fn()
}));

vi.mock('../../utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

vi.mock('../../pages/api/utils/encryption', () => ({
  safeDecrypt: vi.fn((val) => val ? 'decrypted' : null)
}));

vi.mock('../../pages/api/utils/scraperUtils', () => ({
  getBillingCycleStartDay: vi.fn().mockResolvedValue(10)
}));

import { getDB } from '../../pages/api/db';

describe('Transactions API enrichment', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { query: vi.fn(), release: vi.fn() };
    (getDB as any).mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return enriched fields for credit card transaction', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{
        identifier: 'tx1',
        vendor: 'visaCal',
        date: '2026-06-22',
        name: 'NETFLIX COM',
        display_name: 'NETFLIX COM',
        original_name: 'NETFLIX COM',
        price: -54.90,
        category: 'מנויים',
        transaction_type: 'credit_card',
        account_number: '0061',
        is_reconciled: false,
        card_type: 'credit',
        is_debit: false,
        bank_account_name: 'חשבון ראשי',
        billing_cycle_start_day: 10,
        bank_debit_date: null,
        is_favorite: false,
        notes: null,
        card6_digits_encrypted: null,
        vendor_nickname: null,
        matched_cc_identifier: null,
        matched_cc_vendor: null,
        cc_vendor_resolved: null,
        cc_account_number_resolved: null
      }]
    });

    const handler = (await import('../../pages/api/transactions/index.js')).default;
    const { req, res } = createMocks({
      method: 'GET',
      query: { billingCycle: '2026-06', transactionType: 'all' }
    });

    await handler(req, res);
    const data = res._getJSONData();

    expect(data[0]).toHaveProperty('original_name');
    expect(data[0]).toHaveProperty('is_reconciled');
    expect(data[0]).toHaveProperty('card_type');
    expect(data[0]).toHaveProperty('bank_account_name');
  });

  it('should return card_type=direct for bank transactions without reconciliation', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{
        identifier: 'tx2',
        vendor: 'hapoalim',
        date: '2026-06-21',
        name: 'הלוואה- פרעון',
        display_name: 'הלוואה- פרעון',
        original_name: 'הלוואה- פרעון',
        price: -864.74,
        category: 'הלוואה',
        transaction_type: 'bank',
        account_number: '12345',
        is_reconciled: false,
        card_type: 'direct',
        is_debit: null,
        bank_account_name: 'חשבון ראשי',
        billing_cycle_start_day: null,
        bank_debit_date: null,
        is_favorite: false,
        notes: null,
        card6_digits_encrypted: null,
        vendor_nickname: null,
        matched_cc_identifier: null,
        matched_cc_vendor: null,
        cc_vendor_resolved: null,
        cc_account_number_resolved: null
      }]
    });

    const handler = (await import('../../pages/api/transactions/index.js')).default;
    const { req, res } = createMocks({
      method: 'GET',
      query: { billingCycle: '2026-06', transactionType: 'bank' }
    });

    await handler(req, res);
    const data = res._getJSONData();
    expect(data[0].card_type).toBe('direct');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/transactions-enrichment.test.ts`
Expected: FAIL — enriched fields not yet in query

- [ ] **Step 3: Modify the transactions query**

In `app/pages/api/transactions/index.js`, replace the SELECT and FROM/JOIN block (lines 281-316) with:

```javascript
        return {
            sql: `
        SELECT 
          t.identifier,
          t.vendor,
          t.date,
          COALESCE(cc.name, t.name) as display_name,
          COALESCE(cc.name, t.name) as name,
          t.name as original_name,
          t.price,
          COALESCE(cc.category, t.category) as category,
          t.type,
          t.processed_date,
          t.original_amount,
          t.original_currency,
          t.charged_currency,
          COALESCE(cc.memo, t.memo) as memo,
          t.status,
          t.installments_number,
          t.installments_total,
          t.account_number,
          t.category_source,
          t.rule_matched,
          t.transaction_type,
          t.is_favorite,
          t.notes,
          vc.nickname as vendor_nickname,
          vc.card6_digits as card6_digits_encrypted,
          tr.cc_identifier as matched_cc_identifier,
          tr.cc_vendor as matched_cc_vendor,
          cc.vendor as cc_vendor_resolved,
          cc.account_number as cc_account_number_resolved,
          CASE WHEN tr.id IS NOT NULL THEN true ELSE false END as is_reconciled,
          cv.is_debit,
          cv.billing_cycle_start_day,
          CASE
            WHEN t.transaction_type = 'credit_card' AND cv.is_debit = true THEN 'debit'
            WHEN t.transaction_type = 'credit_card' THEN 'credit'
            WHEN t.transaction_type = 'bank' AND tr.id IS NOT NULL THEN
              CASE WHEN cc_cv.is_debit = true THEN 'debit' ELSE 'credit' END
            ELSE 'direct'
          END as card_type,
          COALESCE(
            linked_ba.nickname,
            co.custom_bank_account_nickname,
            (SELECT bvc.nickname FROM vendor_credentials bvc 
             WHERE bvc.vendor = t.vendor AND bvc.is_active = true LIMIT 1)
          ) as bank_account_name,
          bank_tx.date as bank_debit_date
        FROM transactions t
        LEFT JOIN card_ownership co ON t.vendor = co.vendor AND t.account_number = co.account_number
        LEFT JOIN vendor_credentials vc ON co.credential_id = vc.id
        LEFT JOIN vendor_credentials linked_ba ON co.linked_bank_account_id = linked_ba.id
        LEFT JOIN vendor_credentials ba ON ba.id = ${bankAccountParamIndex ? `$${bankAccountParamIndex}` : 'NULL'}
        LEFT JOIN card_vendors cv ON RIGHT(t.account_number, 4) = cv.last4_digits AND t.transaction_type = 'credit_card'
        LEFT JOIN transaction_reconciliations tr ON t.identifier = tr.bank_identifier AND t.vendor = tr.bank_vendor AND tr.status = 'approved'
        LEFT JOIN transactions cc ON tr.cc_identifier = cc.identifier AND tr.cc_vendor = cc.vendor
        LEFT JOIN card_vendors cc_cv ON RIGHT(cc.account_number, 4) = cc_cv.last4_digits
        LEFT JOIN transaction_reconciliations cc_tr ON t.identifier = cc_tr.cc_identifier AND t.vendor = cc_tr.cc_vendor AND cc_tr.status = 'approved'
        LEFT JOIN transactions bank_tx ON cc_tr.bank_identifier = bank_tx.identifier AND cc_tr.bank_vendor = bank_tx.vendor
        ${whereClause}
        ORDER BY ${orderByCol} ${sortDir}, t.identifier, t.vendor
        LIMIT ${limitParam}
        OFFSET ${offsetParam}
      `,
            params
        };
```

Key changes explained:
- `display_name` = `COALESCE(cc.name, t.name)` — merchant name after reconciliation
- `original_name` = `t.name` — raw bank-side name
- `is_reconciled` = boolean from reconciliation join
- `card_type` = 'credit'/'debit'/'direct' computed from card_vendors.is_debit and transaction_type
- `bank_account_name` = cascading: linked_ba → custom_bank_account → bank vendor credential
- `bank_debit_date` = for CC transactions, the date when bank was debited (from reconciled bank-side transaction)
- `cc_cv` join = card_vendors for the CC-side transaction (for reconciled bank transactions)
- `cc_tr` + `bank_tx` joins = reverse reconciliation lookup (CC → bank) to get bank debit date

- [ ] **Step 4: Update the transform function**

In the transform function (line 357-361), add the new fields to the response:

```javascript
        return result.rows.map(row => ({
            ...row,
            card6_digits: row.card6_digits_encrypted ? safeDecrypt(row.card6_digits_encrypted) : null,
            card6_digits_encrypted: undefined,
            is_reconciled: row.is_reconciled === true || row.is_reconciled === 't',
            is_debit: row.is_debit === true || row.is_debit === 't',
            is_credit: row.price > 0
        }));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run tests/transactions-enrichment.test.ts`
Expected: PASS

- [ ] **Step 6: Verify no regressions**

Run: `cd app && npx vitest run`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
cd app && git add pages/api/transactions/index.js tests/transactions-enrichment.test.ts
git commit -m "feat(api): enrich transactions response with card type, bank account, and payment info"
```

---

### Task 2: Update TypeScript Interface and i18n

**Files:**
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx:36-53` (Transaction interface)
- Modify: `app/i18n/locales/he/tx.json`
- Modify: `app/i18n/locales/en/tx.json`

**Interfaces:**
- Consumes: API response fields from Task 1
- Produces: Extended `Transaction` interface and translation keys used by Tasks 3-6

- [ ] **Step 1: Update Transaction interface**

In `app/components/CategoryDashboard/components/TransactionsTable.tsx`, replace the Transaction interface (lines 36-53):

```typescript
export interface Transaction {
  name: string;
  display_name?: string;
  original_name?: string;
  price: number;
  date: string;
  category: string;
  identifier: string;
  vendor: string;
  installments_number?: number;
  installments_total?: number;
  vendor_nickname?: string;
  original_amount?: number;
  original_currency?: string;
  charged_currency?: string;
  account_number?: string;
  processed_date?: string;
  is_favorite?: boolean;
  notes?: string;
  transaction_type?: string;
  is_reconciled?: boolean;
  card_type?: 'credit' | 'debit' | 'direct';
  is_debit?: boolean;
  bank_account_name?: string;
  billing_cycle_start_day?: number;
  bank_debit_date?: string;
  is_credit?: boolean;
  cc_vendor_resolved?: string;
  cc_account_number_resolved?: string;
}
```

- [ ] **Step 2: Add Hebrew translations**

In `app/i18n/locales/he/tx.json`, add these keys inside the `"table"` object:

```json
{
  "table": {
    "columnDescription": "תיאור",
    "columnType": "סוג",
    "columnCategory": "קטגוריה",
    "columnAmount": "סכום",
    "columnInstallments": "תשלום",
    "columnCard": "כרטיס",
    "columnBankAccount": "חשבון בנק",
    "columnDate": "תאריך",
    "columnActions": "פעולות",
    "columnName": "שם",
    "charge": "חיוב",
    "credit": "זיכוי",
    "debit": "דביט",
    "direct": "ישיר",
    "immediate": "מיידי",
    "immediateCreditCard": "מיידי (אשראי)",
    "billingDate": "חיוב {{date}}",
    "installmentWithBilling": "{{current}}/{{total}} · חיוב {{date}}",
    "reconciled": "עברה התאמה",
    "notLinked": "לא מקושר",
    "linkCardTooltip": "קשר כרטיס לחשבון בנק בהגדרות",
    "sortByDate": "תאריך",
    "sortByAmount": "סכום",
    "sortByName": "שם",
    "sortByCategory": "קטגוריה",
    "loading": "טוען...",
    "empty": "אין עסקאות.",
    "fallbackCardLabel": "כרטיס"
  },
  "summary": {
    "totalCharges": "סה״כ חיובים",
    "totalCredits": "סה״כ זיכויים",
    "net": "נטו",
    "breakdown": "פירוט",
    "creditCard": "אשראי",
    "debitCard": "דביט",
    "directBank": "ישיר מבנק"
  }
}
```

- [ ] **Step 3: Add English translations**

In `app/i18n/locales/en/tx.json`, add the same keys in English:

```json
{
  "table": {
    "columnDescription": "Description",
    "columnType": "Type",
    "columnCategory": "Category",
    "columnAmount": "Amount",
    "columnInstallments": "Payment",
    "columnCard": "Card",
    "columnBankAccount": "Bank Account",
    "columnDate": "Date",
    "columnActions": "Actions",
    "columnName": "Name",
    "charge": "Charge",
    "credit": "Credit",
    "debit": "Debit",
    "direct": "Direct",
    "immediate": "Immediate",
    "immediateCreditCard": "Immediate (CC)",
    "billingDate": "Billing {{date}}",
    "installmentWithBilling": "{{current}}/{{total}} · Billing {{date}}",
    "reconciled": "Reconciled",
    "notLinked": "Not linked",
    "linkCardTooltip": "Link card to bank account in settings",
    "sortByDate": "Date",
    "sortByAmount": "Amount",
    "sortByName": "Name",
    "sortByCategory": "Category",
    "loading": "Loading...",
    "empty": "No transactions.",
    "fallbackCardLabel": "Card"
  },
  "summary": {
    "totalCharges": "Total Charges",
    "totalCredits": "Total Credits",
    "net": "Net",
    "breakdown": "Breakdown",
    "creditCard": "Credit Card",
    "debitCard": "Debit",
    "directBank": "Direct Bank"
  }
}
```

- [ ] **Step 4: Verify lint passes**

Run: `cd app && npm run lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd app && git add components/CategoryDashboard/components/TransactionsTable.tsx i18n/locales/he/tx.json i18n/locales/en/tx.json
git commit -m "feat(ui): update Transaction interface and add i18n keys for enriched columns"
```

---

### Task 3: Description Column + Charge/Credit Type Column

**Files:**
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx:459-504` (description cell)
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx:297-307` (table header)
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx:510-527` (amount cell)

**Interfaces:**
- Consumes: `Transaction.display_name`, `Transaction.original_name`, `Transaction.is_reconciled`, `Transaction.is_credit`, `Transaction.price`
- Produces: Updated description cell with subtitle, new type column, amount with absolute value

- [ ] **Step 1: Add type column header**

In `TransactionsTable.tsx`, after the description column header (line 300), add the type column header. Update the `columnWidths` object (line 245) and add the header:

```typescript
const columnWidths = { description: '28%', type: '7%', category: '13%', amount: '10%', installment: '10%', card: '12%', bankAccount: '12%', date: '8%', actions: '8%' };
```

In the TableHead (after the description header, around line 301):

```tsx
{renderSortableHeader(t('tx:table.columnDescription'), 'name', 'left', columnWidths.description)}
<TableCell style={{ ...tableHeaderBaseStyle, width: columnWidths.type }}>{t('tx:table.columnType')}</TableCell>
```

- [ ] **Step 2: Update description cell in TransactionRow**

Replace the description TableCell content (lines 459-504) to show `display_name` with `original_name` subtitle when reconciled:

```tsx
<TableCell style={{ ...cellStyle, maxWidth: '300px' }}>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Tooltip title={transaction.is_favorite ? t('tx:tooltips.unfavorite') : t('tx:tooltips.favorite')}>
      <IconButton
        size="small"
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(transaction); }}
        sx={{
          color: transaction.is_favorite ? '#fbbf24' : theme.palette.text.disabled,
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          p: '4px',
          '&:hover': {
            transform: 'scale(1.2) rotate(5deg)',
            color: '#fbbf24',
            background: 'rgba(251, 191, 36, 0.08)'
          },
          '& svg': {
            filter: transaction.is_favorite ? 'drop-shadow(0 0 2px rgba(251, 191, 36, 0.4))' : 'none'
          }
        }}
      >
        {transaction.is_favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{transaction.name}</Typography>
      {transaction.is_reconciled && transaction.original_name && transaction.original_name !== transaction.name && (
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontSize: '0.65rem', display: 'block', mt: 0.25 }}
          noWrap
        >
          {transaction.original_name}
        </Typography>
      )}
      {transaction.notes && (
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontStyle: 'italic', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}
          noWrap
        >
          <NotesIcon sx={{ fontSize: '0.75rem', opacity: 0.7 }} />
          {transaction.notes}
        </Typography>
      )}
    </Box>
  </Box>
</TableCell>
```

- [ ] **Step 3: Add type column cell in TransactionRow**

After the description cell, add a new TableCell for charge/credit type. Import `RemoveCircleOutline` and `AddCircleOutline` from MUI icons at the top of the file:

```tsx
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
```

Then add the cell after description:

```tsx
<TableCell style={{ ...cellStyle, textAlign: 'center' }}>
  <Tooltip title={transaction.is_credit ? t('tx:table.credit') : t('tx:table.charge')}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
      {transaction.is_credit ? (
        <AddCircleOutlineIcon sx={{ fontSize: '1rem', color: 'var(--n-success)' }} />
      ) : (
        <RemoveCircleOutlineIcon sx={{ fontSize: '1rem', color: 'var(--n-error)' }} />
      )}
    </Box>
  </Tooltip>
</TableCell>
```

- [ ] **Step 4: Update amount cell to show absolute value**

Replace the amount display (line 519) to always show absolute value, with color from `is_credit`:

```tsx
<TableCell align="right" style={{
  ...cellStyle,
  color: transaction.is_credit ? 'var(--n-success)' : 'var(--n-error)',
  fontWeight: 600
}}>
  {editingTransaction?.identifier === transaction.identifier && !hideActions ? (
    <TextField value={editPrice} onChange={(e) => setEditPrice(e.target.value)} size="small" type="number" sx={{ width: '80px' }} />
  ) : (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span>₪{formatNumber(Math.abs(transaction.price))}</span>
      {transaction.original_currency && !['ILS', '₪', 'NIS'].includes(transaction.original_currency) && transaction.original_amount && (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
          ({getCurrencySymbol(transaction.original_currency)}{formatNumber(Math.abs(transaction.original_amount))})
        </Typography>
      )}
    </Box>
  )}
</TableCell>
```

- [ ] **Step 5: Update the colSpan for date group header**

The date group header row uses `colSpan={7}`. Update it to match the new column count (now 9 columns including type and bank account):

```tsx
<TableCell colSpan={9} sx={{ fontWeight: 700, p: 1 }}>{formatDateHeader(date)}</TableCell>
```

- [ ] **Step 6: Verify visually**

Run: `cd app && npm run dev`
Open browser, navigate to transactions page. Verify:
- Description shows merchant name
- Reconciled transactions show original bank name in small text below
- New "סוג" column shows red/green icons
- Amount shows absolute value with correct color

- [ ] **Step 7: Commit**

```bash
cd app && git add components/CategoryDashboard/components/TransactionsTable.tsx
git commit -m "feat(ui): add charge/credit type column and reconciled name subtitle in description"
```

---

### Task 4: Card Column (3 States) + Bank Account Column

**Files:**
- Modify: `app/components/AccountDisplay.tsx` (enhance with card_type support)
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx` (add bank account column)

**Interfaces:**
- Consumes: `Transaction.card_type`, `Transaction.is_debit`, `Transaction.is_reconciled`, `Transaction.bank_account_name`, `Transaction.cc_vendor_resolved`, `Transaction.cc_account_number_resolved`
- Produces: Updated card column with 3 states, new bank account column

- [ ] **Step 1: Enhance AccountDisplay for 3 card states**

In `app/components/AccountDisplay.tsx`, update the component to handle the new `card_type` and reconciliation info. Add to the transaction interface:

```typescript
interface AccountDisplayProps {
    transaction: {
        vendor?: string;
        account_number?: string | null;
        transaction_type?: string | null;
        bank_nickname?: string | null;
        vendor_nickname?: string | null;
        bank_account_display?: string | null;
        card_type?: 'credit' | 'debit' | 'direct';
        is_debit?: boolean;
        is_reconciled?: boolean;
        cc_vendor_resolved?: string | null;
        cc_account_number_resolved?: string | null;
    };
    vendorOverride?: string;
    premium?: boolean;
}
```

Then update the component logic. Replace the `isBank` check and the main render logic:

```tsx
const AccountDisplay: React.FC<AccountDisplayProps & { compact?: boolean }> = React.memo(({ transaction, vendorOverride, premium = false, compact = false }) => {
    const theme = useTheme();
    const { t } = useTranslation('misc');
    const { getCardVendor, getCardNickname } = useCardVendors();

    const cardType = transaction.card_type || (
        transaction.transaction_type === 'bank' || (transaction.vendor && BANK_VENDORS.includes(transaction.vendor))
            ? 'direct' : 'credit'
    );

    // State 3: Direct bank transaction
    if (cardType === 'direct') {
        const vendor = transaction.vendor || vendorOverride || 'unknown';
        const nickname = transaction.vendor_nickname || transaction.bank_nickname;
        const bankName = nickname || (BANK_VENDORS.includes(vendor) ? t(`accountDisplay.banks.${vendor}`, t('accountDisplay.fallbackBank')) : t('accountDisplay.fallbackBank'));

        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CardVendorIcon vendor={vendor} size={premium ? 18 : 24} />
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{
                        fontWeight: 700,
                        fontSize: compact ? '11px' : '13px',
                        color: theme.palette.text.primary,
                        whiteSpace: 'nowrap'
                    }}>
                        {t('accountDisplay.direct', 'ישיר')}
                    </span>
                </Box>
            </Box>
        );
    }

    // State 1 & 2: Credit card or Debit card
    // For reconciled bank transactions, use the CC-side card info
    const accountNumber = transaction.cc_account_number_resolved || transaction.account_number;
    const resolvedVendor = transaction.cc_vendor_resolved || transaction.vendor;

    if (accountNumber) {
        const last4 = accountNumber.slice(-4);
        const nickname = getCardNickname(accountNumber);
        const vendor = getCardVendor(accountNumber) || resolvedVendor || null;

        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CardVendorIcon vendor={vendor} size={premium ? 18 : 24} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {nickname && !compact && (
                        <span style={{
                            fontWeight: 700,
                            color: theme.palette.text.primary,
                            fontSize: compact ? '10px' : '12px',
                            lineHeight: 1.1
                        }}>
                            {nickname}
                        </span>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{
                            fontWeight: '500',
                            color: theme.palette.text.secondary,
                            backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(148, 163, 184, 0.1)',
                            padding: compact ? '2px 4px' : '4px 8px',
                            borderRadius: '6px',
                            fontSize: compact ? '10px' : '11px',
                            display: 'inline-block',
                            width: 'fit-content'
                        }}>
                            •••• {last4}
                        </span>
                        {cardType === 'debit' && (
                            <span style={{
                                fontSize: '9px',
                                fontWeight: 700,
                                color: theme.palette.warning.main,
                                backgroundColor: theme.palette.mode === 'dark' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(251, 191, 36, 0.15)',
                                padding: '1px 4px',
                                borderRadius: '4px'
                            }}>
                                {t('accountDisplay.debit', 'דביט')}
                            </span>
                        )}
                        {transaction.is_reconciled && (
                            <span style={{
                                fontSize: '10px',
                                color: 'var(--n-success)',
                                fontWeight: 700
                            }}>✓</span>
                        )}
                    </Box>
                </Box>
            </Box>
        );
    }

    return <span style={{ color: theme.palette.text.disabled }}>—</span>;
});
```

- [ ] **Step 2: Add i18n keys for AccountDisplay**

In `app/i18n/locales/he/misc.json`, add inside the `accountDisplay` object:

```json
"direct": "ישיר",
"debit": "דביט"
```

In `app/i18n/locales/en/misc.json`, add:

```json
"direct": "Direct",
"debit": "Debit"
```

- [ ] **Step 3: Add bank account column to TransactionsTable header**

In the TableHead section, add bank account column after the card column:

```tsx
{renderSortableHeader(t('tx:table.columnCard'), 'account_number', 'left', columnWidths.card)}
<TableCell style={{ ...tableHeaderBaseStyle, width: columnWidths.bankAccount }}>{t('tx:table.columnBankAccount')}</TableCell>
```

- [ ] **Step 4: Add bank account cell in TransactionRow**

After the card AccountDisplay cell (around line 534), add the bank account cell:

```tsx
<TableCell style={cellStyle}>
  {transaction.bank_account_name ? (
    <Typography variant="body2" sx={{ fontSize: compact ? '11px' : '13px', fontWeight: 600 }}>
      {transaction.bank_account_name}
    </Typography>
  ) : (
    <Tooltip title={t('tx:table.linkCardTooltip')}>
      <Typography variant="body2" sx={{ color: 'text.disabled', fontSize: compact ? '11px' : '13px' }}>
        {t('tx:table.notLinked')}
      </Typography>
    </Tooltip>
  )}
</TableCell>
```

- [ ] **Step 5: Verify visually**

Run: `cd app && npm run dev`
Check:
- Credit card transactions: show card icon + last4 digits
- Debit transactions: show card icon + last4 + "דביט" tag
- Direct bank: show "ישיר"
- Reconciled: show ✓ next to card
- Bank account column: shows linked bank name or "לא מקושר"

- [ ] **Step 6: Commit**

```bash
cd app && git add components/AccountDisplay.tsx components/CategoryDashboard/components/TransactionsTable.tsx i18n/locales/he/misc.json i18n/locales/en/misc.json
git commit -m "feat(ui): add 3-state card column and bank account column to transactions table"
```

---

### Task 5: Payment Column (5 States)

**Files:**
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx` (payment cell)

**Interfaces:**
- Consumes: `Transaction.card_type`, `Transaction.is_debit`, `Transaction.billing_cycle_start_day`, `Transaction.installments_number`, `Transaction.installments_total`, `Transaction.date`, `Transaction.bank_debit_date`
- Produces: Payment cell with 5 display states

- [ ] **Step 1: Create billing date calculation helper**

Add this helper function at the top of `TransactionsTable.tsx` (after the `getCurrencySymbol` function):

```typescript
function getPaymentInfo(transaction: Transaction): { label: string; params?: Record<string, string> } {
  // State 5: Direct bank — no payment info
  if (transaction.card_type === 'direct') {
    return { label: 'dash' };
  }

  // State 1: Debit card — always immediate
  if (transaction.is_debit) {
    return { label: 'immediate' };
  }

  // State 2: Credit card with immediate charge (detected via reconciliation)
  if (transaction.card_type === 'credit' && transaction.bank_debit_date) {
    const txDate = new Date(transaction.date);
    const bankDate = new Date(transaction.bank_debit_date);
    const daysDiff = Math.abs(txDate.getTime() - bankDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 3) {
      return { label: 'immediateCreditCard' };
    }
  }

  // Calculate billing date
  const billingDay = transaction.billing_cycle_start_day || 10;
  const txDate = new Date(transaction.date);
  const txDay = txDate.getDate();
  let billingMonth: Date;
  if (txDay >= billingDay) {
    billingMonth = new Date(txDate.getFullYear(), txDate.getMonth() + 1, billingDay);
  } else {
    billingMonth = new Date(txDate.getFullYear(), txDate.getMonth(), billingDay);
  }
  const billingDateStr = `${billingMonth.getDate().toString().padStart(2, '0')}/${(billingMonth.getMonth() + 1).toString().padStart(2, '0')}`;

  // State 4: Installments
  if (transaction.installments_total && transaction.installments_total > 1) {
    return {
      label: 'installmentWithBilling',
      params: {
        current: String(transaction.installments_number || 1),
        total: String(transaction.installments_total),
        date: billingDateStr
      }
    };
  }

  // State 3: Regular monthly billing
  return { label: 'billingDate', params: { date: billingDateStr } };
}
```

- [ ] **Step 2: Update payment cell in TransactionRow**

Replace the installments TableCell (lines 528-532):

```tsx
{!hideInstallmentsColumn && (
  <TableCell align="center" style={cellStyle}>
    {(() => {
      const info = getPaymentInfo(transaction);
      if (info.label === 'dash') return '—';
      if (info.label === 'immediate') return t('tx:table.immediate');
      if (info.label === 'immediateCreditCard') return t('tx:table.immediateCreditCard');
      return t(`tx:table.${info.label}`, info.params || {});
    })()}
  </TableCell>
)}
```

- [ ] **Step 3: Verify visually**

Run: `cd app && npm run dev`
Check:
- Debit card transactions: show "מיידי"
- Regular CC: show "חיוב DD/MM"
- Installments: show "X/Y · חיוב DD/MM"
- Direct bank: show "—"
- CC with immediate charge (if any reconciled): show "מיידי (אשראי)"

- [ ] **Step 4: Commit**

```bash
cd app && git add components/CategoryDashboard/components/TransactionsTable.tsx
git commit -m "feat(ui): implement 5-state payment column with billing cycle info"
```

---

### Task 6: Summary Bar with Breakdown and Source Type Filters

**Files:**
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx` (add summary bar)
- Modify: `app/components/CategoryDashboard/index.tsx` (add filter controls)
- Modify: `app/components/CategoryDashboard/useTransactions.ts` (add filter state + API param)
- Modify: `app/pages/api/transactions/index.js` (add sourceType filter param)

**Interfaces:**
- Consumes: `Transaction[]` array with enriched fields, filter state from `useTransactions`
- Produces: Summary bar component, filter UI, API filtering by source type

- [ ] **Step 1: Add sourceType filter to API**

In `app/pages/api/transactions/index.js`, add `sourceType` to the destructured query params (around line 138):

```javascript
const {
    // ... existing params ...
    sourceType,  // 'credit' | 'debit' | 'direct' | undefined
} = req.query;
```

Add a filter condition after the uncategorizedOnly filter (around line 245):

```javascript
if (sourceType === 'credit') {
    conditions.push(`(t.transaction_type = 'credit_card' AND (cv.is_debit IS NULL OR cv.is_debit = false))`);
} else if (sourceType === 'debit') {
    conditions.push(`((t.transaction_type = 'credit_card' AND cv.is_debit = true) OR (t.transaction_type = 'bank' AND EXISTS (
        SELECT 1 FROM transaction_reconciliations tr2 
        JOIN transactions cc2 ON tr2.cc_identifier = cc2.identifier AND tr2.cc_vendor = cc2.vendor
        JOIN card_vendors cv2 ON RIGHT(cc2.account_number, 4) = cv2.last4_digits
        WHERE tr2.bank_identifier = t.identifier AND tr2.bank_vendor = t.vendor AND tr2.status = 'approved' AND cv2.is_debit = true
    )))`);
} else if (sourceType === 'direct') {
    conditions.push(`(t.transaction_type = 'bank' AND NOT EXISTS (
        SELECT 1 FROM transaction_reconciliations tr3
        WHERE tr3.bank_identifier = t.identifier AND tr3.bank_vendor = t.vendor AND tr3.status = 'approved'
    ))`);
}
```

- [ ] **Step 2: Add sourceType filter state to useTransactions**

In `app/components/CategoryDashboard/useTransactions.ts`, add state and pass to API:

After `const [favoritesOnly, setFavoritesOnly] = React.useState(false);` (line 28):

```typescript
const [sourceTypeFilter, setSourceTypeFilter] = React.useState<string>('');
```

In `fetchTransactionsWithRange`, after the favoritesOnly param append (around line 62):

```typescript
if (sourceTypeFilter) {
    url.searchParams.append("sourceType", sourceTypeFilter);
}
```

In `handleSearch`, after the favoritesOnly param append (around line 133):

```typescript
if (sourceTypeFilter) {
    queryParams += `&sourceType=${sourceTypeFilter}`;
}
```

Add `sourceTypeFilter` to both `useCallback` dependency arrays.

In the return object, add:

```typescript
sourceTypeFilter,
setSourceTypeFilter
```

- [ ] **Step 3: Create TransactionsSummaryBar component**

Add this component at the bottom of `TransactionsTable.tsx` (before the default export):

```tsx
interface TransactionsSummaryBarProps {
  transactions: Transaction[];
}

const TransactionsSummaryBar: React.FC<TransactionsSummaryBarProps> = ({ transactions }) => {
  const { t } = useTranslation('tx');
  const theme = useTheme();

  const stats = React.useMemo(() => {
    let totalCharges = 0;
    let totalCredits = 0;
    let creditCardTotal = 0;
    let debitTotal = 0;
    let directTotal = 0;

    transactions.forEach(tx => {
      const amount = Math.abs(tx.price);
      if (tx.is_credit) {
        totalCredits += amount;
      } else {
        totalCharges += amount;
        if (tx.card_type === 'debit') debitTotal += amount;
        else if (tx.card_type === 'direct') directTotal += amount;
        else creditCardTotal += amount;
      }
    });

    return { totalCharges, totalCredits, net: totalCharges - totalCredits, creditCardTotal, debitTotal, directTotal };
  }, [transactions]);

  return (
    <Box sx={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 2,
      p: 2,
      mb: 2,
      borderRadius: '12px',
      background: theme.palette.mode === 'dark' ? 'rgba(30, 41, 59, 0.6)' : 'rgba(241, 245, 249, 0.8)',
      border: `1px solid ${theme.palette.divider}`
    }}>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1 }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>{t('summary.totalCharges')}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'var(--n-error)' }}>₪{formatNumber(stats.totalCharges)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>{t('summary.totalCredits')}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'var(--n-success)' }}>₪{formatNumber(stats.totalCredits)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>{t('summary.net')}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>₪{formatNumber(stats.net)}</Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>📊 {t('summary.breakdown')}:</Typography>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('summary.creditCard')} ₪{formatNumber(stats.creditCardTotal)}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>·</Typography>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('summary.debitCard')} ₪{formatNumber(stats.debitTotal)}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>·</Typography>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('summary.directBank')} ₪{formatNumber(stats.directTotal)}</Typography>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 4: Add summary bar to the table**

In the `content` render section of TransactionsTable (around line 261), add the summary bar before the table:

```tsx
const content = (
    <Box sx={{ width: '100%' }}>
      {transactions.length > 0 && <TransactionsSummaryBar transactions={transactions} />}
      {isMobile ? (
        // ... mobile content ...
```

- [ ] **Step 5: Add source type filter chips to CategoryDashboard**

In `app/components/CategoryDashboard/index.tsx`, import Chip and add filter chips. After the `useTransactions()` hook call, destructure `sourceTypeFilter` and `setSourceTypeFilter`:

```typescript
const {
    // ... existing ...
    sourceTypeFilter,
    setSourceTypeFilter
} = useTransactions();
```

Add filter chips before the TransactionsTable (around line 194, after the scrollable Box opens):

```tsx
<Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
  {['', 'credit', 'debit', 'direct'].map(type => (
    <Chip
      key={type || 'all'}
      label={type === '' ? t('transactions.filterAll') : type === 'credit' ? t('transactions.filterCredit') : type === 'debit' ? t('transactions.filterDebit') : t('transactions.filterDirect')}
      variant={sourceTypeFilter === type ? 'filled' : 'outlined'}
      onClick={() => setSourceTypeFilter(type)}
      sx={{
        fontWeight: sourceTypeFilter === type ? 700 : 400,
        borderRadius: '20px'
      }}
    />
  ))}
</Box>
```

Import `Chip` from MUI and add the i18n keys for filter labels in both locale files.

In `app/i18n/locales/he/views.json`, add inside `transactions`:

```json
"filterAll": "הכל",
"filterCredit": "אשראי",
"filterDebit": "דביט",
"filterDirect": "ישיר מבנק"
```

In `app/i18n/locales/en/views.json`, add inside `transactions`:

```json
"filterAll": "All",
"filterCredit": "Credit Card",
"filterDebit": "Debit",
"filterDirect": "Direct Bank"
```

- [ ] **Step 6: Verify all features visually**

Run: `cd app && npm run dev`
Check:
- Summary bar shows correct totals and breakdown
- Filter chips toggle source type
- Filtered transactions update summary numbers
- All columns display correctly together

- [ ] **Step 7: Run full test suite**

Run: `cd app && npm run test && npm run lint`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
cd app && git add pages/api/transactions/index.js components/CategoryDashboard/components/TransactionsTable.tsx components/CategoryDashboard/index.tsx components/CategoryDashboard/useTransactions.ts i18n/locales/he/tx.json i18n/locales/en/tx.json i18n/locales/he/views.json i18n/locales/en/views.json
git commit -m "feat(ui): add summary bar with breakdown and source type filter chips"
```

---

### Task 7: Mobile Card View Updates

**Files:**
- Modify: `app/components/CategoryDashboard/components/TransactionsTable.tsx` (TransactionMobileCardContent)

**Interfaces:**
- Consumes: All enriched Transaction fields
- Produces: Updated mobile card showing card type, bank account, payment info

- [ ] **Step 1: Update TransactionMobileCardContent**

In the mobile card component (around line 631), update to include the new information. After the existing card vendor display (around line 677), add bank account and payment info:

```tsx
<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
    <AccountDisplay transaction={transaction} compact />
    {transaction.bank_account_name && (
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '10px' }}>
        → {transaction.bank_account_name}
      </Typography>
    )}
  </Box>
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Typography variant="caption" sx={{ 
      color: transaction.is_credit ? 'var(--n-success)' : 'var(--n-error)',
      fontSize: '10px',
      fontWeight: 600 
    }}>
      {transaction.is_credit ? t('tx:table.credit') : t('tx:table.charge')}
    </Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '10px' }}>
      {(() => {
        const info = getPaymentInfo(transaction);
        if (info.label === 'dash') return '';
        if (info.label === 'immediate') return t('tx:table.immediate');
        if (info.label === 'immediateCreditCard') return t('tx:table.immediateCreditCard');
        return t(`tx:table.${info.label}`, info.params || {});
      })()}
    </Typography>
  </Box>
</Box>
```

Also update the amount display in mobile (around line 667) to use `is_credit`:

```tsx
<Typography variant="subtitle2" sx={{ fontWeight: 800, color: transaction.is_credit ? 'var(--n-success)' : 'var(--n-error)' }}>
  ₪{formatNumber(Math.abs(transaction.price))}
</Typography>
```

And add the reconciled original name subtitle (around line 651):

```tsx
<Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>{transaction.name}</Typography>
{transaction.is_reconciled && transaction.original_name && transaction.original_name !== transaction.name && (
  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block' }} noWrap>
    {transaction.original_name}
  </Typography>
)}
```

- [ ] **Step 2: Verify on mobile viewport**

Run: `cd app && npm run dev`
Open browser DevTools, toggle mobile viewport. Verify mobile cards show:
- Merchant name with original name subtitle when reconciled
- Charge/credit indicator
- Card info with debit/direct state
- Bank account name
- Payment timing info

- [ ] **Step 3: Commit**

```bash
cd app && git add components/CategoryDashboard/components/TransactionsTable.tsx
git commit -m "feat(ui): update mobile transaction cards with enriched column data"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - ✅ Description column with merchant name + original name subtitle (Task 3)
   - ✅ Charge/credit type column (Task 3)
   - ✅ Card column 3 states: credit/debit/direct (Task 4)
   - ✅ Bank account column (Task 4)
   - ✅ Payment column 5 states (Task 5)
   - ✅ Summary bar with breakdown (Task 6)
   - ✅ Source type filters (Task 6)
   - ✅ Reconciliation indicator (Task 4, in AccountDisplay)
   - ✅ Mobile view updates (Task 7)
   - ✅ API enrichment (Task 1)
   - ✅ i18n both locales (Task 2)

2. **Placeholder scan:** No TBD/TODO found.

3. **Type consistency:** `Transaction` interface (Task 2) matches API fields (Task 1). `card_type` is `'credit' | 'debit' | 'direct'` everywhere. `getPaymentInfo` helper (Task 5) used in both desktop (Task 5) and mobile (Task 7).
