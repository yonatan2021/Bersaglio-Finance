ALTER TABLE card_vendors ADD COLUMN IF NOT EXISTS is_debit BOOLEAN DEFAULT FALSE;
ALTER TABLE card_vendors ADD COLUMN IF NOT EXISTS billing_cycle_start_day INTEGER;

ALTER TABLE card_vendors DROP CONSTRAINT IF EXISTS chk_billing_cycle_start_day;
ALTER TABLE card_vendors ADD CONSTRAINT chk_billing_cycle_start_day CHECK (
  billing_cycle_start_day IS NULL OR (billing_cycle_start_day >= 1 AND billing_cycle_start_day <= 28)
);
