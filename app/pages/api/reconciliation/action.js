import { getDB } from "../db.js";
import logger from '../../../utils/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { id, status } = req.body;

  if (!id) {
    return res.status(400).json({ error: "Missing required field: id" });
  }

  if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: "Missing or invalid status. Must be 'approved', 'rejected', or 'pending'" });
  }

  const client = await getDB();

  try {
    const result = await client.query(`
      UPDATE transaction_reconciliations
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Reconciliation match entry with ID ${id} not found` });
    }

    logger.info({ id, status }, "[Reconciliation] Updated match entry status");
    return res.status(200).json({ success: true, match: result.rows[0] });

  } catch (err) {
    logger.error({ error: err.message, stack: err.stack }, "Error in action API");
    return res.status(500).json({ error: "Failed to update reconciliation status" });
  } finally {
    client.release();
  }
}
