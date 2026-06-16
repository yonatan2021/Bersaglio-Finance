import { getDB } from "../pages/api/db";
import logger from './logger.js';
import { VaultLockedError } from "../pages/api/utils/encryption";

/* eslint-disable @typescript-eslint/no-explicit-any -- Loose typing intentional: handler is consumed by both production Next API routes and tests passing partial mocks */

interface QueryResult {
    sql: string;
    params?: unknown[];
}

interface CreateApiHandlerOptions {
    query: (req: any, client: any) => Promise<QueryResult> | QueryResult;
    validate?: (req: any) => string | undefined | Promise<string | undefined>;
    transform?: (result: any, req: any) => unknown | Promise<unknown>;
}

export function createApiHandler({ query, validate, transform }: CreateApiHandlerOptions) {
    return async function handler(req: any, res: any) {
        const client = await getDB();

        try {
            if (validate) {
                const validationError = await validate(req);
                if (validationError) {
                    return res.status(400).json({ error: validationError });
                }
            }

            const { sql, params = [] } = await query(req, client);
            const result = await client.query(sql, params);
            const data = transform ? await transform(result, req) : result.rows;

            if (req.method === 'GET' && res.setHeader) {
                res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
            }
            res.status(200).json(data);
        } catch (error: any) {
            if (error instanceof VaultLockedError) {
                return res.status(401).json({
                    error: error.message,
                    type: 'VAULT_LOCKED'
                });
            }
            logger.error({ error: error.message, stack: error.stack }, "Error executing query");
            res.status(500).json({ error: "Internal Server Error" });
        } finally {
            client.release();
        }
    };
}
