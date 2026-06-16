import { getDB } from "../db.js";
import { findReconciliationCandidates } from "../../../utils/reconciliation.js";
import logger from '../../../utils/logger.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const client = await getDB();

  try {
    const result = await findReconciliationCandidates(client);
    
    logger.info(result, "[Reconciliation] Manual scan completed");
    return res.status(200).json({ 
      success: true, 
      candidatesFound: result.candidatesFound 
    });

  } catch (err) {
    logger.error({ error: err.message, stack: err.stack }, "Error in manual reconciliation scan API");
    return res.status(500).json({ error: "Failed to run reconciliation scan" });
  } finally {
    client.release();
  }
}
