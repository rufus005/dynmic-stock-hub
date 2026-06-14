import { describe, expect, it } from 'vitest';
import { Branch } from './types';
import { getAllSales } from './store';
import { getBranchSalesSummary } from './branchSalesSummary';

const sale = (id: string, date: string, branchId = 'branch-1') => ({
  id,
  date,
  customerNumber: `C-${id}`,
  driverName: 'Driver',
  product: 'JUMBO',
  color: 'Ivory',
  shelfSize: '5',
  quantity: 1,
  price: 100,
  driverCharge: 10,
  collection: 90,
  branchId,
});

function branchWithSales(): Branch {
  return {
    id: 'branch-1',
    name: 'Branch One',
    dateEntries: [
      {
        date: '2026-06-14',
        stock: [],
        sales: [sale('today-1', '2026-06-14'), sale('today-2', '2026-06-14')],
      },
      {
        date: '2026-06-01',
        stock: [],
        sales: [sale('month-old', '2026-06-01')],
      },
      {
        date: '2026-05-31',
        stock: [],
        sales: [sale('previous-month', '2026-05-31')],
      },
    ],
  };
}

describe('branch sales summary counts', () => {
  it('counts only today sales for the branch', () => {
    const summary = getBranchSalesSummary(branchWithSales(), new Date('2026-06-14T10:00:00'));

    expect(summary.dailySalesCount).toBe(2);
    expect(summary.monthlySalesCount).toBe(3);
  });

  it('automatically shows 0 daily count tomorrow without resetting old sales', () => {
    const branch = branchWithSales();
    const summary = getBranchSalesSummary(branch, new Date('2026-06-15T10:00:00'));

    expect(summary.dailySalesCount).toBe(0);
    expect(summary.monthlySalesCount).toBe(3);
    expect(branch.dateEntries.flatMap(entry => entry.sales)).toHaveLength(4);
  });

  it('automatically shows 0 monthly count next month until new month sales are added', () => {
    const summary = getBranchSalesSummary(branchWithSales(), new Date('2026-07-01T10:00:00'));

    expect(summary.dailySalesCount).toBe(0);
    expect(summary.monthlySalesCount).toBe(0);
  });

  it('does not hide old sales from report aggregation', () => {
    const branch = branchWithSales();
    const allSales = getAllSales([branch]);

    expect(allSales.map(s => s.id)).toEqual(['today-1', 'today-2', 'month-old', 'previous-month']);
  });
});
