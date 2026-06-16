import logger from './logger.js';

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
          const nameLower = (bank.name || '').toLowerCase();
          const isGenericDebit = nameLower.includes('דביט') || 
                                 nameLower.includes('debit') || 
                                 nameLower.includes('חיוב כרטיס') || 
                                 nameLower.includes('משיכה') ||
                                 nameLower.includes('עסקה') ||
                                 nameLower.includes('חיוב מיידי') ||
                                 nameLower.includes('כרטיסי אשראי') ||
                                 nameLower.includes('ויזה') ||
                                 nameLower.includes('ישראכרט') ||
                                 nameLower.includes('דירקט');

          if (isLinked && diffDays <= 1) {
            confidence = 1.0; // High confidence: linked account + very close date
          } else if (isLinked && diffDays <= 2) {
            confidence = 0.9;
          } else if (isLinked && diffDays <= 4) {
            confidence = 0.8;
          } else if (isGenericDebit && diffDays <= 1) {
            confidence = 0.8; // Medium-High confidence: generic debit name + close date
          } else if (isGenericDebit && diffDays <= 2) {
            confidence = 0.7;
          } else if (isGenericDebit && diffDays <= 4) {
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
