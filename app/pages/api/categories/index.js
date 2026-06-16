import { createApiHandler } from "../../../utils/apiHandler";

const handler = createApiHandler({
    query: async () => ({
        sql: `
      SELECT category AS name, COUNT(*) AS count
      FROM transactions
      WHERE category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY count DESC
    `
    }),
    transform: (result, req) => {
        if (req.query.withCounts === 'true') {
            return result.rows.map((row) => ({
                name: row.name,
                count: parseInt(row.count, 10) || 0,
            }));
        }
        return result.rows.map((row) => row.name);
    }
});

export default handler;
