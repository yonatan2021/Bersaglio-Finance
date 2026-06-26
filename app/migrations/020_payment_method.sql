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
