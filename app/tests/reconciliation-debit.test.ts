import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDB } from '../pages/api/db';
import {
  isGenericDebit,
  autoReconcileDebitTransaction,
  propagateMerchantName
} from '../utils/reconciliation';
import actionHandler from '../pages/api/reconciliation/action';

// Mock DB
vi.mock('../pages/api/db', () => ({
  getDB: vi.fn()
}));

// Mock logger
vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('Reconciliation — Debit Auto-Match & Merchant Name Propagation', () => {
  let mockClient: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn(),
      release: vi.fn()
    };

    (getDB as any).mockResolvedValue(mockClient);

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn()
    };

    mockReq = {
      method: 'POST',
      query: {},
      body: {}
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGenericDebit helper', () => {
    it('should detect Hebrew generic debit names', () => {
      expect(isGenericDebit('חיוב דביט')).toBe(true);
      expect(isGenericDebit('חיוב כרטיס')).toBe(true);
      expect(isGenericDebit('משיכה')).toBe(true);
      expect(isGenericDebit('עסקה')).toBe(true);
      expect(isGenericDebit('חיוב מיידי')).toBe(true);
      expect(isGenericDebit('כרטיסי אשראי')).toBe(true);
      expect(isGenericDebit('ויזה')).toBe(true);
      expect(isGenericDebit('ישראכרט')).toBe(true);
      expect(isGenericDebit('דירקט')).toBe(true);
    });

    it('should detect English generic debit names', () => {
      expect(isGenericDebit('Debit Card Transaction')).toBe(true);
      expect(isGenericDebit('DEBIT')).toBe(true);
    });

    it('should not flag real merchant names', () => {
      expect(isGenericDebit('שופרסל')).toBe(false);
      expect(isGenericDebit('רמי לוי')).toBe(false);
      expect(isGenericDebit('McDonald\'s')).toBe(false);
      expect(isGenericDebit('')).toBe(false);
      expect(isGenericDebit(null as any)).toBe(false);
    });
  });

  describe('autoReconcileDebitTransaction', () => {
    const debitTxn = {
      identifier: 'cc_100',
      vendor: 'max',
      date: '2026-06-15',
      name: 'שופרסל',
      price: -150.0,
      account_number: '1234'
    };

    it('should auto-reconcile when exactly one bank transaction matches', async () => {
      // 1. card_ownership lookup → linked bank account
      mockClient.query.mockResolvedValueOnce({
        rows: [{ linked_bank_account_id: 10, bank_account_number: '999888' }]
      });
      // 2. bank transaction search → exactly 1 match
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          identifier: 'bank_50',
          vendor: 'hapoalim',
          date: '2026-06-15',
          name: 'חיוב דביט',
          price: -150.0
        }]
      });
      // 3. INSERT reconciliation
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // 4. propagateMerchantName: fetch cc name
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'שופרסל' }] });
      // 5. propagateMerchantName: fetch bank name
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'חיוב דביט' }] });
      // 6. propagateMerchantName: UPDATE bank transaction
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const result = await autoReconcileDebitTransaction(mockClient, debitTxn);

      expect(result).toEqual({ reconciled: true });

      // Verify INSERT with approved status and 0.95 confidence
      const insertCall = mockClient.query.mock.calls[2];
      expect(insertCall[0]).toContain('INSERT INTO transaction_reconciliations');
      expect(insertCall[1]).toEqual(['bank_50', 'hapoalim', 'cc_100', 'max', 0.95]);
    });

    it('should return reconciled: false when no bank match found', async () => {
      // 1. card_ownership lookup
      mockClient.query.mockResolvedValueOnce({
        rows: [{ linked_bank_account_id: 10, bank_account_number: '999888' }]
      });
      // 2. bank transaction search → no matches
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const result = await autoReconcileDebitTransaction(mockClient, debitTxn);

      expect(result).toEqual({ reconciled: false });
      // Should NOT attempt to insert
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('should return reconciled: false when multiple bank matches (ambiguous)', async () => {
      // 1. card_ownership lookup
      mockClient.query.mockResolvedValueOnce({
        rows: [{ linked_bank_account_id: 10, bank_account_number: '999888' }]
      });
      // 2. bank transaction search → 2 matches (ambiguous)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { identifier: 'bank_50', vendor: 'hapoalim', date: '2026-06-15', name: 'חיוב דביט', price: -150.0 },
          { identifier: 'bank_51', vendor: 'hapoalim', date: '2026-06-14', name: 'חיוב דביט', price: -150.0 }
        ]
      });

      const result = await autoReconcileDebitTransaction(mockClient, debitTxn);

      expect(result).toEqual({ reconciled: false });
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('should return reconciled: false when no linked bank account exists', async () => {
      // 1. card_ownership lookup → no link
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const result = await autoReconcileDebitTransaction(mockClient, debitTxn);

      expect(result).toEqual({ reconciled: false });
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('propagateMerchantName', () => {
    const reconciliation = {
      bank_identifier: 'bank_50',
      bank_vendor: 'hapoalim',
      cc_identifier: 'cc_100',
      cc_vendor: 'max'
    };

    it('should update generic bank name with cc merchant name', async () => {
      // 1. Fetch cc transaction name
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'שופרסל' }] });
      // 2. Fetch bank transaction name (generic)
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'חיוב דביט' }] });
      // 3. UPDATE bank transaction
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await propagateMerchantName(mockClient, reconciliation);

      // Verify the UPDATE sets original_name = name and name = cc name
      const updateCall = mockClient.query.mock.calls[2];
      expect(updateCall[0]).toContain('UPDATE transactions');
      expect(updateCall[0]).toContain('original_name = name');
      expect(updateCall[1]).toEqual(['שופרסל', 'bank_50', 'hapoalim']);
    });

    it('should NOT overwrite non-generic bank name', async () => {
      // 1. Fetch cc transaction name
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'שופרסל' }] });
      // 2. Fetch bank transaction name (specific merchant name, not generic)
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'רמי לוי' }] });

      await propagateMerchantName(mockClient, reconciliation);

      // Should only call 2 queries — no UPDATE
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('should preserve original_name when propagating', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'אושר עד' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'עסקה 12345' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await propagateMerchantName(mockClient, reconciliation);

      const updateSQL = mockClient.query.mock.calls[2][0];
      // original_name = name preserves the old value before overwriting
      expect(updateSQL).toContain('original_name = name');
      expect(updateSQL).toContain('name = $1');
    });

    it('should handle missing cc transaction gracefully', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await propagateMerchantName(mockClient, reconciliation);

      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });

    it('should handle missing bank transaction gracefully', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'שופרסל' }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await propagateMerchantName(mockClient, reconciliation);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('Action API — propagation on manual approval', () => {
    it('should call propagateMerchantName when status is approved', async () => {
      mockReq.body = { id: 5, status: 'approved' };

      // UPDATE reconciliation RETURNING *
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 5,
          status: 'approved',
          bank_identifier: 'bank_50',
          bank_vendor: 'hapoalim',
          cc_identifier: 'cc_100',
          cc_vendor: 'max'
        }]
      });
      // propagateMerchantName: fetch cc name
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'שופרסל' }] });
      // propagateMerchantName: fetch bank name (generic)
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'חיוב דביט' }] });
      // propagateMerchantName: UPDATE bank transaction
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await actionHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);

      // Verify propagateMerchantName was called (4 total queries: 1 update + 3 propagation)
      expect(mockClient.query).toHaveBeenCalledTimes(4);

      // The third query should be the bank name fetch
      const bankFetchCall = mockClient.query.mock.calls[2];
      expect(bankFetchCall[1]).toEqual(['bank_50', 'hapoalim']);
    });

    it('should NOT call propagateMerchantName when status is rejected', async () => {
      mockReq.body = { id: 5, status: 'rejected' };

      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 5,
          status: 'rejected',
          bank_identifier: 'bank_50',
          bank_vendor: 'hapoalim',
          cc_identifier: 'cc_100',
          cc_vendor: 'max'
        }]
      });

      await actionHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      // Only 1 query — the UPDATE, no propagation
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });
});
