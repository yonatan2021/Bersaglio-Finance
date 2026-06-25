import { createApiHandler } from "../../../utils/apiHandler";

const handler = createApiHandler({
    query: async () => ({
        sql: `
      SELECT t.category AS name, COUNT(*) AS count, ct.type
      FROM transactions t
      LEFT JOIN category_types ct ON t.category = ct.category
      WHERE t.category IS NOT NULL AND t.category != ''
      GROUP BY t.category, ct.type
      ORDER BY count DESC
    `
    }),
    transform: (result, req) => {
        if (req.query.withCounts === 'true') {
            return result.rows.map((row) => ({
                name: row.name,
                count: parseInt(row.count, 10) || 0,
                type: row.type || null,
            }));
        }
        return result.rows.map((row) => row.name);
    }
});

export default handler;
