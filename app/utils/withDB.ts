import { getDB } from "../pages/api/db";
import logger from './logger.js';
import { VaultLockedError } from "../pages/api/utils/encryption";

/* eslint-disable @typescript-eslint/no-explicit-any -- Loose typing intentional: handler is consumed by both production Next API routes and tests passing partial mocks */

type DBClient = {
    query: (...args: any[]) => Promise<any>;
    release: () => void;
};

type HandlerFn = (req: any, res: any, client: DBClient) => Promise<unknown> | unknown;

export function withDB(handler: HandlerFn) {
    return async function wrappedHandler(req: any, res: any) {
        const client = await getDB();
        try {
            await handler(req, res, client);
        } catch (error: any) {
            if (error instanceof VaultLockedError) {
                if (!res.headersSent) {
                    return res.status(401).json({ error: error.message, type: 'VAULT_LOCKED' });
                }
                return;
            }
            logger.error({ error: error.message, stack: error.stack }, "API handler error");
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal Server Error" });
            }
        } finally {
            client.release();
        }
    };
}
