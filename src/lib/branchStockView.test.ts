import { describe, expect, it } from 'vitest';
import { getBranchStockSnapshot } from './branchStockView';
import { Branch } from './types';

const branch: Branch = {
  id: 'branch-kr',
  name: 'KR PURAM',
  dateEntries: [
    {
      date: '2026-06-14',
      stock: [
        { id: 'old-stock', category: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 10 },
      ],
      sales: [
        {
          id: 'sale-1',
          date: '2026-06-14',
          customerNumber: '9999999999',
          driverName: 'Driver',
          paymentMode: 'Cash',
          product: 'JUMBO',
          color: 'Ivory',
          shelfSize: '5',
          quantity: 1,
          price: 100,
          driverCharge: 10,
          collection: 90,
          branchId: 'branch-kr',
        },
      ],
    },
    {
      date: '2026-06-15',
      stock: [
        { id: 'today-stock', category: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 8 },
        { id: 'today-stock-2', category: 'PREMIUM', color: 'Grey', shelfSize: '3', quantity: 4 },
      ],
      sales: [],
    },
  ],
};

describe('getBranchStockSnapshot', () => {
  it('uses today stock when today entry is available and exposes stock fields only', () => {
    const snapshot = getBranchStockSnapshot(branch, '2026-06-15');

    expect(snapshot?.date).toBe('2026-06-15');
    expect(snapshot?.totalStock).toBe(12);
    expect(snapshot?.rows).toEqual([
      { id: 'today-stock', product: 'JUMBO', color: 'Ivory', size: '5', currentStock: 8 },
      { id: 'today-stock-2', product: 'PREMIUM', color: 'Grey', size: '3', currentStock: 4 },
    ]);
    expect(snapshot?.rows[0]).not.toHaveProperty('customerNumber');
    expect(snapshot?.rows[0]).not.toHaveProperty('collection');
    expect(snapshot?.rows[0]).not.toHaveProperty('purchasePrice');
  });

  it('falls back to latest available date when today entry is missing', () => {
    const snapshot = getBranchStockSnapshot(branch, '2026-06-16');

    expect(snapshot?.date).toBe('2026-06-15');
    expect(snapshot?.rows[0].currentStock).toBe(8);
  });

  it('returns null when the branch has no date entries', () => {
    expect(getBranchStockSnapshot({ id: 'empty', name: 'Empty', dateEntries: [] }, '2026-06-15')).toBeNull();
  });
});
