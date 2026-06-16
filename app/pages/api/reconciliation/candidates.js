import { getDB } from "../db.js";
import logger from '../../../utils/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { status = 'pending' } = req.query;

  if (!['pending', 'approved'].includes(status)) {
    return res.status(400).json({ error: "Invalid status query parameter. Must be 'pending' or 'approved'" });
  }

  const client = await getDB();

  try {
    const result = await client.query(`
      SELECT 
        tr.id,
        tr.confidence,
        tr.status,
        -- Bank Transaction Details
        bt.identifier as bank_identifier,
        bt.vendor as bank_vendor,
        bt.date as bank_date,
        bt.name as bank_name,
        bt.price as bank_price,
        bt.account_number as bank_account_number,
        -- Credit Card Transaction Details
        ct.identifier as cc_identifier,
        ct.vendor as cc_vendor,
        ct.date as cc_date,
        ct.name as cc_name,
        ct.price as cc_price,
        ct.category as cc_category,
        ct.account_number as cc_account_number
      FROM transaction_reconciliations tr
      JOIN transactions bt ON tr.bank_identifier = bt.identifier AND tr.bank_vendor = bt.vendor
      JOIN transactions ct ON tr.cc_identifier = ct.identifier AND tr.cc_vendor = ct.vendor
      WHERE tr.status = $1
      ORDER BY 
        CASE WHEN $1 = 'pending' THEN tr.confidence ELSE 0 END DESC,
        bt.date DESC
    `, [status]);

    const formatted = result.rows.map(row => ({
      id: row.id,
      confidence: parseFloat(row.confidence),
      status: row.status,
      bankTransaction: {
        identifier: row.bank_identifier,
        vendor: row.bank_vendor,
        date: row.bank_date,
        name: row.bank_name,
        price: parseFloat(row.bank_price),
        account_number: row.bank_account_number
      },
      ccTransaction: {
        identifier: row.cc_identifier,
        vendor: row.cc_vendor,
        date: row.cc_date,
        name: row.cc_name,
        price: parseFloat(row.cc_price),
        category: row.cc_category,
        account_number: row.cc_account_number
      }
    }));

    return res.status(200).json(formatted);

  } catch (err) {
    logger.error({ error: err.message, stack: err.stack }, "Error in candidates API");
    return res.status(500).json({ error: "Failed to fetch reconciliation data" });
  } finally {
    client.release();
  }
}
