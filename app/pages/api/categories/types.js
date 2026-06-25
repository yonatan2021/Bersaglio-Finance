import { getDB } from "../db";
import logger from '../../../utils/logger.js';

const VALID_TYPES = ['income', 'expense', 'transfer'];

/**
 * Category Types API
 *
 * GET /api/categories/types - List all category types with transaction counts
 * PATCH /api/categories/types - Upsert category type assignments
 */
export default async function handler(req, res) {
    const client = await getDB();

    try {
        if (req.method === 'GET') {
            const result = await client.query(`
                SELECT ct.category, ct.type, COALESCE(tc.count, 0) as count
                FROM category_types ct
                LEFT JOIN (
                    SELECT category, COUNT(*) as count
                    FROM transactions
                    WHERE category IS NOT NULL AND category != ''
                    GROUP BY category
                ) tc ON ct.category = tc.category
                ORDER BY count DESC
            `);

            return res.status(200).json(result.rows.map(row => ({
                category: row.category,
                type: row.type,
                count: parseInt(row.count, 10) || 0
            })));

        } else if (req.method === 'PATCH') {
            const { categories } = req.body || {};

            if (!Array.isArray(categories) || categories.length === 0) {
                return res.status(400).json({ error: "categories array is required and must not be empty" });
            }

            for (const item of categories) {
                if (!item.category || typeof item.category !== 'string' || item.category.trim() === '') {
                    return res.status(400).json({ error: "Each item must have a non-empty category string" });
                }
                if (!VALID_TYPES.includes(item.type)) {
                    return res.status(400).json({
                        error: `Invalid type "${item.type}" for category "${item.category}". Must be one of: ${VALID_TYPES.join(', ')}`
                    });
                }
            }

            await client.query('BEGIN');

            const results = [];
            for (const { category, type } of categories) {
                const result = await client.query(
                    `INSERT INTO category_types (category, type)
                     VALUES ($1, $2)
                     ON CONFLICT (category) DO UPDATE SET type = $2, updated_at = CURRENT_TIMESTAMP
                     RETURNING category, type`,
                    [category.trim(), type]
                );
                results.push(result.rows[0]);
            }

            await client.query('COMMIT');

            return res.status(200).json({
                success: true,
                updated: results
            });

        } else {
            res.setHeader('Allow', ['GET', 'PATCH']);
            return res.status(405).json({ error: `Method ${req.method} not allowed` });
        }
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error({ error: error.message, stack: error.stack }, "Error in category types API");
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
}
