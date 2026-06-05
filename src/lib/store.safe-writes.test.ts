import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch } from './types';

const firebaseCalls = vi.hoisted(() => ({
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  push: vi.fn(() => ({ path: 'mock-push-path', key: 'mock-push-key' })),
  ref: vi.fn((_db: unknown, path?: string) => ({ path: path || '' })),
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/database', () => ({
  getDatabase: vi.fn(() => ({})),
  ref: firebaseCalls.ref,
  set: firebaseCalls.set,
  update: firebaseCalls.update,
  remove: firebaseCalls.remove,
  push: firebaseCalls.push,
}));

function initialBranches(): Branch[] {
  return [
    {
      id: 'branch-1',
      name: 'Branch One',
      dateEntries: [
        {
          date: '2026-06-01',
          stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 10 }],
          sales: [],
        },
      ],
    },
    {
      id: 'branch-2',
      name: 'Branch Two',
      dateEntries: [
        {
          date: '2026-06-01',
          stock: [{ id: 'stock-2', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 99 }],
          sales: [],
        },
      ],
    },
  ];
}

describe('store Firebase product writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes sales, stock, dates, and transfers only to exact products child paths', async () => {
    const store = await import('./store');
    let branches = store.initCache(initialBranches());

    branches = store.addSale('branch-1', '2026-06-01', {
      date: '2026-06-01',
      customerNumber: 'C-1',
      driverName: 'Driver',
      product: 'JUMBO',
      color: 'Ivory',
      shelfSize: '5',
      quantity: 1,
      price: 100,
      driverCharge: 10,
    });
    const saleId = branches[0].dateEntries[0].sales[0].id;

    store.updateSale('branch-1', '2026-06-01', saleId, { quantity: 2, price: 200 });
    store.addDateEntry('branch-1', '2026-06-02');
    store.addStockItem('branch-1', '2026-06-02', {
      category: 'JUMBO',
      shelfSize: '5',
      color: 'Ivory',
      quantity: 3,
    });
    branches = store.transferStock('branch-1', 'branch-2', '2026-06-01', 'JUMBO', 'Ivory', '5', 1);

    const setPaths = firebaseCalls.set.mock.calls.map(([refArg]) => refArg.path);
    expect(setPaths).not.toContain('products');
    expect(setPaths).toContain('products/0/dateEntries/1');

    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/sales/0');
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).toContain('products/1/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products');

    expect(branches.find(branch => branch.id === 'branch-2')?.dateEntries[0].stock[0].quantity).toBe(100);
  });

  it('keeps Firebase numeric indexes when products arrays contain deleted-child holes', async () => {
    vi.resetModules();
    const store = await import('./store');

    store.initCache([
      null,
      {
        id: 'branch-2',
        name: 'Branch Two',
        dateEntries: [
          null,
          {
            date: '2026-06-03',
            stock: [null, { id: 'stock-2', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 5 }],
            sales: [null],
          },
        ],
      },
    ]);
    vi.clearAllMocks();

    store.addSale('branch-2', '2026-06-03', {
      date: '2026-06-03',
      customerNumber: 'C-2',
      driverName: 'Driver',
      product: 'JUMBO',
      color: 'Ivory',
      shelfSize: '5',
      quantity: 1,
      price: 100,
      driverCharge: 10,
    });

    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/1/dateEntries/1/sales/1');
    expect(updateKeys).toContain('products/1/dateEntries/1/stock/1');
    expect(updateKeys).not.toContain('products');
  });

  it('uses parent date entry date when a sale has no own date', async () => {
    const store = await import('./store');
    const sales = store.getAllSales([
      {
        id: 'branch-1',
        name: 'Branch One',
        dateEntries: [
          {
            date: '2026-05-28',
            stock: [],
            sales: [
              {
                id: 'sale-1',
                date: '',
                customerNumber: 'C-1',
                driverName: 'Driver',
                product: 'JUMBO',
                color: 'Ivory',
                shelfSize: '5',
                quantity: 1,
                price: 100,
                driverCharge: 10,
                collection: 90,
                branchId: 'branch-1',
              },
            ],
          },
        ],
      },
    ]);

    expect(sales[0].date).toBe('2026-05-28');
    expect(sales[0].branchName).toBe('Branch One');
  });

  it('calculates current stock from the latest dated entry instead of array order', async () => {
    const store = await import('./store');
    const branch = {
      id: 'branch-1',
      name: 'Branch One',
      dateEntries: [
        {
          date: '2026-05-28',
          stock: [{ id: 'old-stock', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 500 }],
          sales: [],
        },
        {
          date: '2026-06-03',
          stock: [{ id: 'new-stock', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 296 }],
          sales: [],
        },
      ],
    };

    expect(store.getLatestDateEntry(branch)?.date).toBe('2026-06-03');
    expect(store.getBranchTotalStock(branch)).toBe(296);
    expect(store.getOverallStock([branch]).get('JUMBO')?.get('5')?.get('Ivory')).toBe(296);
  });

  it('creates one automatic daily entry from previous closing stock and skips duplicates', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache([
      {
        id: 'branch-1',
        name: 'Branch One',
        dateEntries: [
          {
            date: '2026-06-04',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 42 }],
            sales: [{ id: 'sale-1', date: '2026-06-04', customerNumber: 'C-1', driverName: 'Driver', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 1, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
          },
        ],
      },
    ]);
    vi.clearAllMocks();

    let branches = store.addDateEntry('branch-1', '2026-06-05', { source: 'auto' });
    const createdEntry = branches[0].dateEntries.find(entry => entry.date === '2026-06-05');
    expect(createdEntry?.stock[0].quantity).toBe(42);
    expect(createdEntry?.sales).toEqual([]);
    expect(firebaseCalls.set.mock.calls.map(([refArg]) => refArg.path)).toContain('products/0/dateEntries/1');

    vi.clearAllMocks();
    branches = store.addDateEntry('branch-1', '2026-06-05', { source: 'auto' });
    expect(branches[0].dateEntries.filter(entry => entry.date === '2026-06-05')).toHaveLength(1);
    expect(firebaseCalls.set).not.toHaveBeenCalled();
  });

  it('recalculates future branch stock when a backdated sale is added, edited, and deleted', async () => {
    vi.resetModules();
    const store = await import('./store');
    let branches = store.initCache([
      {
        id: 'branch-1',
        name: 'Branch One',
        dateEntries: [
          {
            date: '2026-06-04',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 295 }],
            sales: [],
          },
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-2', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 296 }],
            sales: [{ id: 'sale-jun-5', date: '2026-06-05', customerNumber: 'C-2', driverName: 'Driver', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 1, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
          },
        ],
      },
    ]);
    vi.clearAllMocks();

    branches = store.addSale('branch-1', '2026-06-04', {
      date: '2026-06-04',
      customerNumber: 'C-1',
      driverName: 'Driver',
      product: 'JUMBO',
      color: 'Ivory',
      shelfSize: '5',
      quantity: 1,
      price: 100,
      driverCharge: 10,
    });
    const saleId = branches[0].dateEntries.find(entry => entry.date === '2026-06-04')!.sales[0].id;
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-04')!.stock[0].quantity).toBe(294);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(293);
    expect(firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates))).toContain('products/0/dateEntries/1');

    branches = store.updateSale('branch-1', '2026-06-04', saleId, { quantity: 2, price: 200 });
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-04')!.stock[0].quantity).toBe(293);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(292);

    branches = store.deleteSale('branch-1', '2026-06-04', saleId);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-04')!.stock[0].quantity).toBe(295);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(294);
  });

  it('recalculates future stock for stock edits, production receives, and transfers', async () => {
    vi.resetModules();
    const store = await import('./store');
    let branches = store.initCache([
      {
        id: 'branch-1',
        name: 'Branch One',
        dateEntries: [
          {
            date: '2026-06-04',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 295 }],
            sales: [],
          },
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-2', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 296 }],
            sales: [],
          },
        ],
      },
      {
        id: 'branch-2',
        name: 'Branch Two',
        dateEntries: [
          {
            date: '2026-06-04',
            stock: [{ id: 'stock-3', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 0 }],
            sales: [],
          },
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-4', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 1 }],
            sales: [],
          },
        ],
      },
    ]);

    branches = store.updateDateStock('branch-1', '2026-06-04', [
      { id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 300 },
    ]);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(300);

    branches = store.addStockItem('branch-1', '2026-06-04', {
      category: 'JUMBO',
      shelfSize: '5',
      color: 'Ivory',
      quantity: 5,
    });
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(305);

    branches = store.transferStock('branch-1', 'branch-2', '2026-06-04', 'JUMBO', 'Ivory', '5', 10);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(295);
    expect(branches[1].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(10);
  });
});
