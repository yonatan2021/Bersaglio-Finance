import logger from './logger.js';

/**
 * Checks if a bank transaction name is a generic debit indicator
 * (e.g., "חיוב דביט", "debit", "חיוב כרטיס") rather than a meaningful merchant name.
 *
 * @param {string} name - Transaction name
 * @returns {boolean}
 */
export function isGenericDebit(name) {
  const nameLower = (name || '').toLowerCase();
  return nameLower.includes('דביט') ||
    nameLower.includes('debit') ||
    nameLower.includes('חיוב כרטיס') ||
    nameLower.includes('משיכה') ||
    nameLower.includes('עסקה') ||
    nameLower.includes('חיוב מיידי') ||
    nameLower.includes('כרטיסי אשראי') ||
    nameLower.includes('ויזה') ||
    nameLower.includes('ישראכרט') ||
    nameLower.includes('דירקט');
}

/**
 * Searches for matching bank and credit card transactions to propose as reconciliation candidates.
 * Uses date proximity, exact amount matching, bank account links, and text heuristics.
 *
 * @param {object} client - Database client
 */
export async function findReconciliationCandidates(client) {
  logger.info('[Reconciliation] Scanning for potential transaction matches');

  try {
    // 1. Fetch unmatched bank debit transactions (last 90 days)
    const bankRes = await client.query(`
      SELECT 
        t.identifier, t.vendor, t.date, t.name, t.price, t.account_number, t.category,
        vc.id as bank_credential_id
      FROM transactions t
      LEFT JOIN vendor_credentials vc ON t.account_number = vc.bank_account_number AND t.transaction_type = 'bank'
      WHERE t.transaction_type = 'bank'
        AND t.price < 0
        AND t.date >= CURRENT_DATE - INTERVAL '90 days'
        AND NOT EXISTS (
          SELECT 1 FROM transaction_reconciliations tr
          WHERE tr.bank_identifier = t.identifier AND tr.bank_vendor = t.vendor
        )
      ORDER BY t.date DESC
    `);

    // 2. Fetch unmatched credit card debit transactions (last 90 days)
    const ccRes = await client.query(`
      SELECT 
        t.identifier, t.vendor, t.date, t.name, t.price, t.account_number, t.category,
        co.credential_id as cc_credential_id, co.linked_bank_account_id
      FROM transactions t
      LEFT JOIN card_ownership co ON t.vendor = co.vendor AND RIGHT(t.account_number, 4) = RIGHT(co.account_number, 4)
      WHERE t.transaction_type = 'credit_card'
        AND t.price < 0
        AND t.date >= CURRENT_DATE - INTERVAL '90 days'
        AND NOT EXISTS (
          SELECT 1 FROM transaction_reconciliations tr
          WHERE tr.cc_identifier = t.identifier AND tr.cc_vendor = t.vendor
        )
      ORDER BY t.date DESC
    `);

    const bankTxns = bankRes.rows;
    const ccTxns = ccRes.rows;

    logger.info({ bankCount: bankTxns.length, ccCount: ccTxns.length }, '[Reconciliation] Loaded unmatched transaction sets');

    if (bankTxns.length === 0 || ccTxns.length === 0) {
      logger.info('[Reconciliation] No unmatched transactions to reconcile');
      return { candidatesFound: 0 };
    }

    const proposedMatches = [];

    // 3. Match logic (fuzzy date, exact amount)
    for (const bank of bankTxns) {
      const bankDate = new Date(bank.date);
      const bankAbsPrice = Math.abs(bank.price);

      // Find all cc transactions with the same amount (with minor float tolerance)
      const matchingCCs = ccTxns.filter(cc => Math.abs(Math.abs(cc.price) - bankAbsPrice) < 0.01);

      for (const cc of matchingCCs) {
        const ccDate = new Date(cc.date);
        
        // Calculate date difference in days
        const diffDays = Math.abs(ccDate.getTime() - bankDate.getTime()) / (1000 * 60 * 60 * 24);

        if (diffDays <= 4) {
          // Calculate confidence score
          let confidence = 0.5; // Base confidence for same price & close date
          
          // Heuristic: check linked bank accounts
          const isLinked = cc.linked_bank_account_id !== null && 
                            cc.linked_bank_account_id === bank.bank_credential_id;

          // Heuristic: generic debit name indicators in bank
          const genericDebit = isGenericDebit(bank.name);

          if (isLinked && diffDays <= 1) {
            confidence = 1.0; // High confidence: linked account + very close date
          } else if (isLinked && diffDays <= 2) {
            confidence = 0.9;
          } else if (isLinked && diffDays <= 4) {
            confidence = 0.8;
          } else if (genericDebit && diffDays <= 1) {
            confidence = 0.8; // Medium-High confidence: generic debit name + close date
          } else if (genericDebit && diffDays <= 2) {
            confidence = 0.7;
          } else if (genericDebit && diffDays <= 4) {
            confidence = 0.6;
          } else if (diffDays <= 1) {
            confidence = 0.6;
          } else if (diffDays <= 2) {
            confidence = 0.5;
          } else {
            confidence = 0.4;
          }

          proposedMatches.push({
            bank,
            cc,
            confidence,
            diffDays
          });
        }
      }
    }

    // 4. Resolve 1:1 constraints to avoid conflicts
    // Sort proposed matches by confidence DESC, date difference ASC
    proposedMatches.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.diffDays - b.diffDays;
    });

    const usedBankIds = new Set();
    const usedCCIds = new Set();
    let insertedCount = 0;

    for (const match of proposedMatches) {
      const bankKey = `${match.bank.identifier}|${match.bank.vendor}`;
      const ccKey = `${match.cc.identifier}|${match.cc.vendor}`;

      if (usedBankIds.has(bankKey) || usedCCIds.has(ccKey)) {
        continue; // Maintain 1:1 matching
      }

      usedBankIds.add(bankKey);
      usedCCIds.add(ccKey);

      // Save candidate to database
      await client.query(`
        INSERT INTO transaction_reconciliations (
          bank_identifier, bank_vendor, cc_identifier, cc_vendor, confidence, status
        ) VALUES ($1, $2, $3, $4, $5, 'pending')
        ON CONFLICT (bank_identifier, bank_vendor) 
        DO UPDATE SET confidence = EXCLUDED.confidence
        WHERE transaction_reconciliations.status = 'pending'
      `, [
        match.bank.identifier,
        match.bank.vendor,
        match.cc.identifier,
        match.cc.vendor,
        match.confidence
      ]);

      insertedCount++;
    }

    logger.info({ proposed: proposedMatches.length, inserted: insertedCount }, '[Reconciliation] Finished candidate search');
    return { candidatesFound: insertedCount };

  } catch (err) {
    logger.error({ error: err.message, stack: err.stack }, '[Reconciliation] Error scanning candidates');
    throw err;
  }
}

/**
 * Propagates the credit card merchant name to a bank transaction when the bank
 * transaction has a generic debit name. Preserves the original bank name in `original_name`.
 *
 * @param {object} client - Database client
 * @param {object} reconciliation - Reconciliation record with bank_identifier, bank_vendor, cc_identifier, cc_vendor
 */
export async function propagateMerchantName(client, reconciliation) {
  const { bank_identifier, bank_vendor, cc_identifier, cc_vendor } = reconciliation;

  // Fetch the cc transaction name
  const ccRes = await client.query(
    `SELECT name FROM transactions WHERE identifier = $1 AND vendor = $2 LIMIT 1`,
    [cc_identifier, cc_vendor]
  );

  if (ccRes.rows.length === 0) {
    logger.warn({ cc_identifier, cc_vendor }, '[Reconciliation] CC transaction not found for name propagation');
    return;
  }

  const ccName = ccRes.rows[0].name;

  // Fetch the bank transaction name
  const bankRes = await client.query(
    `SELECT name FROM transactions WHERE identifier = $1 AND vendor = $2 LIMIT 1`,
    [bank_identifier, bank_vendor]
  );

  if (bankRes.rows.length === 0) {
    logger.warn({ bank_identifier, bank_vendor }, '[Reconciliation] Bank transaction not found for name propagation');
    return;
  }

  const bankName = bankRes.rows[0].name;

  // Only propagate if bank name is generic
  if (!isGenericDebit(bankName)) {
    logger.info({ bank_identifier, bankName }, '[Reconciliation] Bank name is not generic, skipping propagation');
    return;
  }

  // Update bank transaction: preserve original name, set cc merchant name
  await client.query(
    `UPDATE transactions SET original_name = name, name = $1 WHERE identifier = $2 AND vendor = $3`,
    [ccName, bank_identifier, bank_vendor]
  );

  logger.info({ bank_identifier, bank_vendor, ccName }, '[Reconciliation] Propagated merchant name to bank transaction');
}

/**
 * Attempts to auto-reconcile a debit card transaction with a matching bank transaction.
 * Looks for bank transactions on the same linked bank account with matching amount (±0.01)
 * and date (±1 day). If exactly one match is found, creates an approved reconciliation entry.
 *
 * @param {object} client - Database client
 * @param {object} debitTxn - Debit transaction { identifier, vendor, date, name, price, account_number }
 * @returns {{ reconciled: boolean }}
 */
export async function autoReconcileDebitTransaction(client, debitTxn) {
  const { identifier, vendor, date, name, price, account_number } = debitTxn;

  logger.info({ identifier, vendor }, '[Reconciliation] Attempting auto-reconcile for debit transaction');

  try {
    // Find the linked bank account for this debit card
    const linkRes = await client.query(
      `SELECT co.linked_bank_account_id, vc.bank_account_number
       FROM card_ownership co
       JOIN vendor_credentials vc ON co.linked_bank_account_id = vc.id
       WHERE co.vendor = $1 AND RIGHT(co.account_number, 4) = RIGHT($2, 4)
       LIMIT 1`,
      [vendor, account_number]
    );

    if (linkRes.rows.length === 0) {
      logger.info({ vendor, account_number }, '[Reconciliation] No linked bank account found for debit card');
      return { reconciled: false };
    }

    const bankAccountNumber = linkRes.rows[0].bank_account_number;
    const absPrice = Math.abs(price);

    // Search for matching bank transactions: same account, amount ±0.01, date ±1 day, not already reconciled
    const matchRes = await client.query(
      `SELECT t.identifier, t.vendor, t.date, t.name, t.price
       FROM transactions t
       WHERE t.transaction_type = 'bank'
         AND t.account_number = $1
         AND ABS(ABS(t.price) - $2) < 0.01
         AND ABS(t.date - $3::date) <= 1
         AND NOT EXISTS (
           SELECT 1 FROM transaction_reconciliations tr
           WHERE tr.bank_identifier = t.identifier AND tr.bank_vendor = t.vendor
         )`,
      [bankAccountNumber, absPrice, date]
    );

    if (matchRes.rows.length !== 1) {
      logger.info(
        { identifier, matchCount: matchRes.rows.length },
        '[Reconciliation] Auto-reconcile: no unique match found'
      );
      return { reconciled: false };
    }

    const bankMatch = matchRes.rows[0];

    // Insert approved reconciliation
    await client.query(
      `INSERT INTO transaction_reconciliations (
        bank_identifier, bank_vendor, cc_identifier, cc_vendor, confidence, status
      ) VALUES ($1, $2, $3, $4, $5, 'approved')`,
      [bankMatch.identifier, bankMatch.vendor, identifier, vendor, 0.95]
    );

    logger.info(
      { bank_identifier: bankMatch.identifier, cc_identifier: identifier },
      '[Reconciliation] Auto-reconciled debit transaction'
    );

    // Propagate merchant name
    await propagateMerchantName(client, {
      bank_identifier: bankMatch.identifier,
      bank_vendor: bankMatch.vendor,
      cc_identifier: identifier,
      cc_vendor: vendor
    });

    return { reconciled: true };

  } catch (err) {
    logger.error({ error: err.message, stack: err.stack }, '[Reconciliation] Error in auto-reconcile');
    throw err;
  }
}
