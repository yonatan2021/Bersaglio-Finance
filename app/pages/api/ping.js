import { withDB } from "../../utils/withDB";

export default withDB(async (req, res, client) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  await client.query('SELECT 1');
  res.status(200).json({ status: 'ok' });
});
