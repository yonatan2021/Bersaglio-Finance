import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

import { getDB } from '../pages/api/db';
import { withDB } from '../utils/withDB';
import { VaultLockedError } from '../pages/api/utils/encryption';

describe('withDB', () => {
    let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    let mockRes: {
        status: ReturnType<typeof vi.fn>;
        json: ReturnType<typeof vi.fn>;
        setHeader: ReturnType<typeof vi.fn>;
        headersSent: boolean;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = { query: vi.fn(), release: vi.fn() };
        (getDB as any).mockResolvedValue(mockClient);
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn(),
            headersSent: false,
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes the client to the handler', async () => {
        const handler = vi.fn(async (_req: any, res: any, _client: any) => {
            res.status(200).json({ ok: true });
        });
        const wrapped = withDB(handler);

        await wrapped({ method: 'GET' } as any, mockRes as any);

        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'GET' }),
            mockRes,
            mockClient
        );
        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('releases the client on success', async () => {
        const handler = async (_req: any, res: any) => {
            res.status(200).json({ ok: true });
        };
        await withDB(handler)({} as any, mockRes as any);
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('releases the client on error', async () => {
        const handler = async () => {
            throw new Error('boom');
        };
        await withDB(handler)({} as any, mockRes as any);
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the handler throws', async () => {
        const handler = async () => {
            throw new Error('boom');
        };
        await withDB(handler)({} as any, mockRes as any);
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
    });

    it('returns 401 with VAULT_LOCKED type for VaultLockedError', async () => {
        const vaultError = new VaultLockedError();
        const handler = async () => {
            throw vaultError;
        };
        await withDB(handler)({} as any, mockRes as any);
        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
            error: vaultError.message,
            type: 'VAULT_LOCKED'
        });
    });

    it('does not send another response when headers are already sent', async () => {
        const handler = async (_req: any, res: any) => {
            res.headersSent = true;
            throw new Error('boom after stream started');
        };
        await withDB(handler)({} as any, mockRes as any);
        expect(mockRes.status).not.toHaveBeenCalled();
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
});
