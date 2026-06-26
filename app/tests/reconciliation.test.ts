import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDB } from '../pages/api/db';
import { findReconciliationCandidates } from '../utils/reconciliation';
import candidatesHandler from '../pages/api/reconciliation/candidates';
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

describe('Transaction Reconciliation Engine and APIs', () => {
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
      method: 'GET',
      query: {},
      body: {}
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Reconciliation Engine', () => {
    it('should query for unmatched bank and credit card transactions', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // bank transactions
        .mockResolvedValueOnce({ rows: [] }); // credit card transactions

      const result = await findReconciliationCandidates(mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(result.candidatesFound).toBe(0);

      // Verify queries look for unmatched transactions
      const bankQuery = mockClient.query.mock.calls[0][0];
      const ccQuery = mockClient.query.mock.calls[1][0];

      expect(bankQuery).toContain("t.transaction_type = 'bank'");
      expect(ccQuery).toContain("t.transaction_type = 'credit_card'");
    });

    it('should match transactions with same amount and close dates', async () => {
      // Mock bank txn (generic debit)
      const mockBankRows = [
        {
          identifier: 'bank_1',
          vendor: 'hapoalim',
          date: '2026-06-12',
          name: 'חיוב דביט',
          price: -150.0,
          account_number: '123456',
          bank_credential_id: 10
        }
      ];

      // Mock credit card txn (merchant details)
      const mockCCRows = [
        {
          identifier: 'cc_1',
          vendor: 'max',
          date: '2026-06-12',
          name: 'שופרסל',
          price: -150.0,
          account_number: '9876',
          linked_bank_account_id: 10,
          cc_credential_id: 20
        }
      ];

      mockClient.query
        .mockResolvedValueOnce({ rows: mockBankRows })
        .mockResolvedValueOnce({ rows: mockCCRows })
        .mockResolvedValueOnce({ rows: [] }); // insert candidate result

      const result = await findReconciliationCandidates(mockClient);

      // The engine should find a match and propose it (insertedCount = 1)
      expect(result.candidatesFound).toBe(1);

      // Verify it inserts with High confidence (1.0) because accounts are linked and date is close
      const insertQuery = mockClient.query.mock.calls[2][0];
      const insertParams = mockClient.query.mock.calls[2][1];

      expect(insertQuery).toContain('INSERT INTO transaction_reconciliations');
      expect(insertParams[0]).toBe('bank_1');
      expect(insertParams[2]).toBe('cc_1');
      expect(insertParams[4]).toBe(1.0); // High confidence
    });
  });

  describe('Candidates API', () => {
    it('should return pending candidates', async () => {
      mockReq.query = { status: 'pending' };
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            confidence: 1.0,
            status: 'pending',
            bank_identifier: 'bank_1',
            bank_vendor: 'hapoalim',
            bank_date: '2026-06-12',
            bank_name: 'חיוב דביט',
            bank_price: -150.0,
            bank_account_number: '123',
            cc_identifier: 'cc_1',
            cc_vendor: 'max',
            cc_date: '2026-06-12',
            cc_name: 'שופרסל',
            cc_price: -150.0,
            cc_category: 'Groceries',
            cc_account_number: '987'
          }
        ]
      });

      await candidatesHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const data = mockRes.json.mock.calls[0][0];
      expect(data.length).toBe(1);
      expect(data[0].id).toBe(1);
      expect(data[0].bankTransaction.name).toBe('חיוב דביט');
      expect(data[0].ccTransaction.name).toBe('שופרסל');
      expect(data[0].confidence).toBe(1.0);
    });
  });

  describe('Action API', () => {
    it('should update candidates status on POST', async () => {
      mockReq.method = 'POST';
      mockReq.body = { id: 5, status: 'approved' };
      // UPDATE RETURNING * with full reconciliation fields
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: 5,
          status: 'approved',
          bank_identifier: 'bank_1',
          bank_vendor: 'hapoalim',
          cc_identifier: 'cc_1',
          cc_vendor: 'max'
        }]
      });
      // propagateMerchantName: fetch cc name
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'שופרסל' }] });
      // propagateMerchantName: fetch bank name (non-generic, so no update)
      mockClient.query.mockResolvedValueOnce({ rows: [{ name: 'רמי לוי' }] });

      await actionHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const data = mockRes.json.mock.calls[0][0];
      expect(data.success).toBe(true);
      expect(data.match.status).toBe('approved');

      // Verify update SQL
      const updateQuery = mockClient.query.mock.calls[0][0];
      const updateParams = mockClient.query.mock.calls[0][1];
      expect(updateQuery).toContain('UPDATE transaction_reconciliations');
      expect(updateParams[0]).toBe('approved');
      expect(updateParams[1]).toBe(5);
    });
  });
});
