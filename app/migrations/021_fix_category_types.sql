-- Fix category type classifications
-- זיכויים (refunds/credits) should be income, not expense
UPDATE category_types SET type = 'income' WHERE category = 'זיכויים';

-- העברות (transfers) should be transfer, not expense
UPDATE category_types SET type = 'transfer' WHERE category = 'העברות';

-- Ensure salary-related categories are income
INSERT INTO category_types (category, type) VALUES ('משכורת', 'income')
ON CONFLICT (category) DO UPDATE SET type = 'income';

INSERT INTO category_types (category, type) VALUES ('הכנסה', 'income')
ON CONFLICT (category) DO UPDATE SET type = 'income';
