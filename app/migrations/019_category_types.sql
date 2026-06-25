-- Create category_types table to track whether categories are income, expense, or transfer
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

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_category_types_type ON category_types(type);
