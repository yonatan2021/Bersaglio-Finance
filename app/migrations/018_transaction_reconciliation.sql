-- Create transaction reconciliations table
CREATE TABLE IF NOT EXISTS transaction_reconciliations (
    id SERIAL PRIMARY KEY,
    bank_identifier VARCHAR(50) NOT NULL,
    bank_vendor VARCHAR(50) NOT NULL,
    cc_identifier VARCHAR(50) NOT NULL,
    cc_vendor VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    confidence FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bank_identifier, bank_vendor) REFERENCES transactions(identifier, vendor) ON DELETE CASCADE,
    FOREIGN KEY (cc_identifier, cc_vendor) REFERENCES transactions(identifier, vendor) ON DELETE CASCADE,
    UNIQUE (bank_identifier, bank_vendor),
    UNIQUE (cc_identifier, cc_vendor)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON transaction_reconciliations(status);
