import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch } from './types';

const firebaseCalls = vi.hoisted(() => ({
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  get: vi.fn(() => Promise.resolve({ val: () => null })),
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
  get: firebaseCalls.get,
  remove: firebaseCalls.remove,
  push: firebaseCalls.push,
}));

function flushFirebaseQueue() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsUndefined);
  return Object.values(value as Record<string, unknown>).some(containsUndefined);
}

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

  it('blocks full products root writes, deletes, empty updates, and negative stock', async () => {
    const protection = await import('./firebaseProtection');

    await expect(protection.safeSetPath('products', [], { action: 'set', entity: 'products' }))
      .rejects.toThrow('Blocked unsafe Firebase write path');
    await expect(protection.safeSetPath('/products', [], { action: 'set', entity: 'products' }))
      .rejects.toThrow('Blocked unsafe Firebase write path');
    await expect(protection.safeUpdatePaths({ products: [] }, { action: 'update', entity: 'products' }))
      .rejects.toThrow('Blocked unsafe Firebase write path');
    await expect(protection.safeSoftDeletePath('products', { entity: 'products' }))
      .rejects.toThrow('Blocked unsafe Firebase write path');
    await expect(protection.safeUpdatePaths({}, { action: 'update', entity: 'products-child' }))
      .rejects.toThrow('Firebase update has no child paths');
    await expect(protection.safeSetPath(
      'products/0/dateEntries/0/stock/0',
      { id: 'stock-1', quantity: -1 },
      { action: 'set', entity: 'products-child' }
    )).rejects.toThrow('Blocked negative stock quantity');

    expect(firebaseCalls.set).not.toHaveBeenCalled();
    expect(firebaseCalls.update).not.toHaveBeenCalled();
    expect(firebaseCalls.remove).not.toHaveBeenCalled();
  });

  it('blocks unapproved product stock writes and audits approved stock actions', async () => {
    const protection = await import('./firebaseProtection');
    const oldStock = {
      total: 10,
      rows: [{ category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 10 }],
    };
    const newStock = {
      total: 9,
      rows: [{ category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 9 }],
    };

    await expect(protection.safeSetPath(
      'products/0/dateEntries/0/stock/0',
      { id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 9 },
      { action: 'set', entity: 'products-child', reason: 'page load' }
    )).rejects.toThrow('Blocked unapproved automatic stock write');
    expect(firebaseCalls.set).not.toHaveBeenCalled();

    await protection.safeSetPath(
      'products/0/dateEntries/0/stock/0',
      { id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 9 },
      {
        action: 'set',
        entity: 'products-child',
        reason: 'add sale',
        branch: 'Branch One',
        date: '2026-06-01',
        oldStock,
        newStock,
        approvedStockAction: true,
        stockChangeReason: 'add-sale',
      }
    );

    expect(firebaseCalls.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'products/0/dateEntries/0/stock/0' }),
      expect.objectContaining({ quantity: 9 })
    );
    expect(firebaseCalls.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'mock-push-path' }),
      expect.objectContaining({
        action: 'set',
        branch: 'Branch One',
        date: '2026-06-01',
        oldStock,
        newStock,
        stockChangeReason: 'add-sale',
      })
    );
  });

  it('allows valid admin Save Stock exact child paths with manual-stock-edit audit data', async () => {
    const protection = await import('./firebaseProtection');
    const oldStock = {
      total: 100,
      rows: [{ category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 100 }],
    };
    const newStock = {
      total: 150,
      rows: [{ category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 150 }],
    };

    await protection.safeUpdatePaths(
      {
        'products/0/dateEntries/0/stock/0': { id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 150 },
        'products/0/dateEntries/0/manualStockEditedAt': '2026-06-10T12:00:00.000Z',
        'products/0/dateEntries/0/manualStockEditReason': 'manual-stock-edit',
      },
      {
        action: 'update',
        entity: 'products-child',
        reason: 'manual-stock-edit',
        branch: 'Branch One',
        date: '2026-06-01',
        oldStock,
        newStock,
        approvedStockAction: true,
        stockChangeReason: 'manual-stock-edit',
      }
    );

    expect(firebaseCalls.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: '' }),
      expect.objectContaining({
        'products/0/dateEntries/0/stock/0': expect.objectContaining({ quantity: 150 }),
        'products/0/dateEntries/0/manualStockEditReason': 'manual-stock-edit',
      })
    );
    expect(firebaseCalls.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'products' }),
      expect.anything()
    );
  });

  it('blocks approved stock writes when old/new audit data is missing', async () => {
    const protection = await import('./firebaseProtection');

    await expect(protection.safeUpdatePaths(
      {
        'products/0/dateEntries/0/stock/0': { id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 150 },
      },
      {
        action: 'update',
        entity: 'products-child',
        reason: 'manual-stock-edit',
        branch: 'Branch One',
        date: '2026-06-01',
        approvedStockAction: true,
        stockChangeReason: 'manual-stock-edit',
      }
    )).rejects.toThrow('Blocked stock write without old/new audit data');

    expect(firebaseCalls.update).not.toHaveBeenCalled();
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
    await flushFirebaseQueue();

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
    await flushFirebaseQueue();

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
    await flushFirebaseQueue();
    expect(firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates))).toContain('products/0/dateEntries/1');

    branches = store.updateSale('branch-1', '2026-06-04', saleId, { quantity: 2, price: 200 });
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-04')!.stock[0].quantity).toBe(293);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(292);

    branches = store.deleteSale('branch-1', '2026-06-04', saleId);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-04')!.stock[0].quantity).toBe(295);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(294);
  });

  it('preserves manual stock edits as source of truth during older-date recalculation', async () => {
    vi.resetModules();
    const store = await import('./store');
    let branches = store.initCache([
      {
        id: 'branch-1',
        name: 'Branch One',
        dateEntries: [
          {
            date: '2026-06-04',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 100 }],
            sales: [],
          },
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-2', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 500 }],
            sales: [],
            manualStockEditedAt: '2026-06-05T08:00:00.000Z',
            manualStockEditReason: 'manual stock edit',
          },
          {
            date: '2026-06-06',
            stock: [{ id: 'stock-3', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 499 }],
            sales: [{ id: 'sale-2', date: '2026-06-06', customerNumber: 'C-2', driverName: 'Driver', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 1, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
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
      quantity: 10,
      price: 100,
      driverCharge: 10,
    });

    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-04')!.stock[0].quantity).toBe(90);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!.stock[0].quantity).toBe(500);
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-06')!.stock[0].quantity).toBe(499);

    await flushFirebaseQueue();
    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/sales/0');
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products/0/dateEntries/1');
    expect(updateKeys).toContain('products/0/dateEntries/2');

    const auditRows = store.getStockAuditRows(branches[0]);
    expect(auditRows.find(row => row.date === '2026-06-05')?.status).toBe('manual-base');
    expect(auditRows.find(row => row.date === '2026-06-06')?.status).toBe('ok');
  });

  it('saves manual stock edits with a manual anchor reason and audits future dates from that stock', async () => {
    vi.resetModules();
    const store = await import('./store');
    let branches = store.initCache([
      {
        id: 'branch-1',
        name: 'KR PURAM',
        dateEntries: [
          {
            date: '2026-06-04',
            stock: [{ id: 'stock-1', category: 'DOUBLE DECKOR', shelfSize: '5', color: 'Coffee Beige', quantity: 78 }],
            sales: [],
          },
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-2', category: 'DOUBLE DECKOR', shelfSize: '5', color: 'Coffee Beige', quantity: 78 }],
            sales: [],
          },
          {
            date: '2026-06-06',
            stock: [{ id: 'stock-3', category: 'DOUBLE DECKOR', shelfSize: '5', color: 'Coffee Beige', quantity: 108 }],
            sales: [{ id: 'sale-1', date: '2026-06-06', customerNumber: 'C-1', driverName: 'Driver', product: 'DOUBLE DECKOR', color: 'Coffee Beige', shelfSize: '5', quantity: 2, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
          },
        ],
      },
    ]);
    vi.clearAllMocks();

    branches = store.updateDateStock('branch-1', '2026-06-05', [
      { id: 'stock-2', category: 'DOUBLE DECKOR', shelfSize: '5', color: 'Coffee Beige', quantity: 110 },
    ]);

    const anchor = branches[0].dateEntries.find(entry => entry.date === '2026-06-05')!;
    expect(anchor.manualStockEditedAt).toEqual(expect.any(String));
    expect(anchor.manualStockEditReason).toBe('manual-stock-edit');
    expect(branches[0].dateEntries.find(entry => entry.date === '2026-06-06')!.stock[0].quantity).toBe(108);

    await flushFirebaseQueue();
    const updateCalls = firebaseCalls.update.mock.calls.map(([, updates]) => updates as Record<string, unknown>);
    const updateKeys = updateCalls.flatMap(updates => Object.keys(updates));
    // Should have exact child paths for stock and metadata
    expect(updateKeys).toContain('products/0/dateEntries/1/stock/0');
    expect(updateKeys).toContain('products/0/dateEntries/1/manualStockEditedAt');
    expect(updateKeys).toContain('products/0/dateEntries/1/manualStockEditReason');
    // May have future date entry recalculation
    expect(updateKeys).toContain('products/0/dateEntries/2');
    expect(updateKeys).not.toContain('products');
    expect(updateCalls.some(updates => {
      const metadataReason = updates['products/0/dateEntries/1/manualStockEditReason'];
      return metadataReason === 'manual-stock-edit';
    })).toBe(true);

    const auditRows = store.getStockAuditRows(branches[0]);
    expect(auditRows.find(row => row.date === '2026-06-05')?.status).toBe('manual-base');
    expect(auditRows.find(row => row.date === '2026-06-05')?.expectedStock).toBe(110);
    expect(auditRows.find(row => row.date === '2026-06-06')?.status).toBe('ok');
    expect(auditRows.find(row => row.date === '2026-06-06')?.expectedStock).toBe(108);
  });

  it('accepts stored stock as a manual anchor without recalculating older dates', async () => {
    vi.resetModules();
    const store = await import('./store');
    let branches = store.initCache([
      {
        id: 'branch-1',
        name: 'KR PURAM',
        dateEntries: [
          {
            date: '2026-06-04',
            stock: [{ id: 'stock-1', category: 'DOUBLE DECKOR', shelfSize: '5', color: 'Coffee Beige', quantity: 78 }],
            sales: [],
          },
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-2', category: 'DOUBLE DECKOR', shelfSize: '5', color: 'Coffee Beige', quantity: 110 }],
            sales: [],
          },
          {
            date: '2026-06-06',
            stock: [{ id: 'stock-3', category: 'DOUBLE DECKOR', shelfSize: '5', color: 'Coffee Beige', quantity: 108 }],
            sales: [{ id: 'sale-1', date: '2026-06-06', customerNumber: 'C-1', driverName: 'Driver', product: 'DOUBLE DECKOR', color: 'Coffee Beige', shelfSize: '5', quantity: 2, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
          },
        ],
      },
    ]);
    expect(store.getStockAuditRows(branches[0]).filter(row => row.status === 'mismatch').map(row => row.date)).toEqual(['2026-06-05', '2026-06-06']);
    vi.clearAllMocks();

    branches = store.acceptStoredStockAsCorrect('branch-1', '2026-06-05');

    const auditRows = store.getStockAuditRows(branches[0]);
    expect(auditRows.find(row => row.date === '2026-06-04')?.status).toBe('initial-base');
    expect(auditRows.find(row => row.date === '2026-06-04')?.storedStock).toBe(78);
    expect(auditRows.find(row => row.date === '2026-06-05')?.status).toBe('manual-base');
    expect(auditRows.find(row => row.date === '2026-06-05')?.expectedStock).toBe(110);
    expect(auditRows.find(row => row.date === '2026-06-06')?.status).toBe('ok');
    expect(auditRows.find(row => row.date === '2026-06-06')?.expectedStock).toBe(108);

    await flushFirebaseQueue();
    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/1/manualStockEditedAt');
    expect(updateKeys).toContain('products/0/dateEntries/1/manualStockEditReason');
    expect(updateKeys).toContain('products/0/dateEntries/2');
    expect(updateKeys).not.toContain('products/0/dateEntries/0');
    expect(updateKeys).not.toContain('products');
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

  it('saves manual stock edits with exact child paths and persists metadata across refetch', async () => {
    vi.resetModules();
    const store = await import('./store');
    let branches = store.initCache([
      {
        id: 'branch-1',
        name: 'Test Branch',
        dateEntries: [
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 100 }],
            sales: [],
          },
        ],
      },
    ]);
    vi.clearAllMocks();

    // Simulate admin manual stock edit
    const newStock = [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 150 }];
    branches = store.updateDateStock('branch-1', '2026-06-05', newStock);

    const updatedEntry = branches[0].dateEntries[0];
    expect(updatedEntry.stock[0].quantity).toBe(150);
    expect(updatedEntry.manualStockEditedAt).toBeDefined();
    expect(updatedEntry.manualStockEditReason).toBe('manual-stock-edit');

    await flushFirebaseQueue();

    // Verify exact child paths were written
    const updateCalls = firebaseCalls.update.mock.calls.map(([, updates]) => updates as Record<string, unknown>);
    const updateKeys = updateCalls.flatMap(updates => Object.keys(updates));

    // Should include stock child path
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    // Should include metadata paths
    expect(updateKeys).toContain('products/0/dateEntries/0/manualStockEditedAt');
    expect(updateKeys).toContain('products/0/dateEntries/0/manualStockEditReason');
    // Should NOT include full entry path or products root
    expect(updateKeys.filter(k => k === 'products/0/dateEntries/0' || k === 'products')).toHaveLength(0);

    // Simulate Firebase refetch with persisted data
    const refetchedBranches = store.updateCache([
      {
        id: 'branch-1',
        name: 'Test Branch',
        dateEntries: [
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 150 }],
            sales: [],
            manualStockEditedAt: updatedEntry.manualStockEditedAt,
            manualStockEditReason: 'manual-stock-edit',
          },
        ],
      },
    ]);

    // Verify persisted data is correctly loaded
    const refetchedEntry = refetchedBranches[0].dateEntries[0];
    expect(refetchedEntry.stock[0].quantity).toBe(150);
    expect(refetchedEntry.manualStockEditedAt).toBe(updatedEntry.manualStockEditedAt);
    expect(refetchedEntry.manualStockEditReason).toBe('manual-stock-edit');
  });

  it('awaits manual stock Firebase write and returns only the refetched products snapshot', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache([
      {
        id: 'branch-1',
        name: 'Test Branch',
        dateEntries: [
          {
            date: '2026-06-05',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 100 }],
            sales: [],
          },
        ],
      },
    ]);
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Test Branch',
          dateEntries: [
            {
              date: '2026-06-05',
              stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 150 }],
              sales: [],
              manualStockEditedAt: '2026-06-10T12:00:00.000Z',
              manualStockEditReason: 'manual-stock-edit',
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.updateDateStockAndRefetch('branch-1', '2026-06-05', [
      { id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 150 },
    ]);

    expect(firebaseCalls.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: '' }),
      expect.objectContaining({
        'products/0/dateEntries/0/stock/0': expect.objectContaining({ quantity: 150 }),
        'products/0/dateEntries/0/manualStockEditReason': 'manual-stock-edit',
      })
    );
    expect(firebaseCalls.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'products' }));
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(150);
    expect(store.getBranches()[0].dateEntries[0].stock[0].quantity).toBe(150);
  });

  it('sanitizes undefined values in Save Stock backup payload before Firebase writes', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache([
      {
        id: 'branch-1',
        name: 'Test Branch',
        dateEntries: [
          {
            date: '2026-06-05',
            stock: [
              {
                id: 'stock-1',
                category: 'JUMBO',
                shelfSize: undefined,
                color: 'Ivory',
                quantity: 100,
                tags: [undefined, 'fast-moving'],
              } as unknown as Branch['dateEntries'][number]['stock'][number],
            ],
            sales: [
              {
                id: 'sale-1',
                date: '2026-06-05',
                customerNumber: undefined,
                driverName: 'Driver',
                product: 'JUMBO',
                color: 'Ivory',
                shelfSize: undefined,
                quantity: 1,
                price: 100,
                driverCharge: 10,
                collection: 90,
                branchId: 'branch-1',
              } as unknown as Branch['dateEntries'][number]['sales'][number],
            ],
            manualStockEditedAt: undefined,
          } as unknown as Branch['dateEntries'][number],
        ],
      },
    ]);
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Test Branch',
          dateEntries: [
            {
              date: '2026-06-05',
              stock: [{ id: 'stock-1', category: 'JUMBO', color: 'Ivory', quantity: 150, tags: [null, 'fast-moving'] }],
              sales: [],
              manualStockEditedAt: '2026-06-10T12:00:00.000Z',
              manualStockEditReason: 'manual-stock-edit',
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.updateDateStockAndRefetch('branch-1', '2026-06-05', [
      {
        id: 'stock-1',
        category: 'JUMBO',
        shelfSize: undefined,
        color: 'Ivory',
        quantity: 150,
        tags: [undefined, 'fast-moving'],
      } as unknown as Branch['dateEntries'][number]['stock'][number],
    ]);

    const setPayloads = firebaseCalls.set.mock.calls.map(([, value]) => value);
    const updatePayloads = firebaseCalls.update.mock.calls.map(([, value]) => value);
    expect(setPayloads.some(value => (value as { sourcePath?: unknown })?.sourcePath === 'products/0')).toBe(true);
    expect([...setPayloads, ...updatePayloads].some(containsUndefined)).toBe(false);
    expect(updatePayloads.some(value => {
      const updates = value as Record<string, unknown>;
      const stock = updates['products/0/dateEntries/0/stock/0'] as { shelfSize?: unknown; tags?: unknown[] };
      return stock && !('shelfSize' in stock) && Array.isArray(stock.tags) && stock.tags[0] === null;
    })).toBe(true);
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(150);
  });

  it('sanitizes undefined, NaN, and invalid values before Firebase writes', async () => {
    const protection = await import('./firebaseProtection');

    await protection.safeSetPath(
      'production_history/mock-production-id',
      {
        id: 'mock-production-id',
        product: 'JUMBO',
        quantity: Number.NaN,
        missing: undefined,
        invalidCallback: () => undefined,
        tags: [undefined, Number.NaN, 'received'],
      },
      { action: 'set', entity: 'production-history', reason: 'test sanitize' }
    );

    const payload = firebaseCalls.set.mock.calls.find(([refArg]) => refArg.path === 'production_history/mock-production-id')?.[1] as {
      quantity?: number;
      missing?: unknown;
      invalidCallback?: unknown;
      tags?: unknown[];
    };
    expect(payload.quantity).toBe(0);
    expect(payload.tags).toEqual([null, 0, 'received']);
    expect('missing' in payload).toBe(false);
    expect('invalidCallback' in payload).toBe(false);
    expect(containsUndefined(payload)).toBe(false);
  });

  it('blocks invalid Firebase paths before write', async () => {
    const protection = await import('./firebaseProtection');

    await expect(protection.safeSetPath(
      'products/0/dateEntries/0/stock/bad.key',
      { id: 'stock-1', quantity: 1 },
      {
        action: 'set',
        entity: 'products-child',
        reason: 'manual-stock-edit',
        approvedStockAction: true,
        stockChangeReason: 'manual-stock-edit',
        oldStock: { total: 0, rows: [] },
        newStock: { total: 1, rows: [{ category: '', shelfSize: '', color: '', quantity: 1 }] },
      }
    )).rejects.toThrow('Invalid Firebase write path');

    expect(firebaseCalls.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'products/0/dateEntries/0/stock/bad.key' }),
      expect.anything()
    );
  });

  it('awaits add sale write and returns only the refetched products snapshot', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache(initialBranches());
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Branch One',
          dateEntries: [
            {
              date: '2026-06-01',
              stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 9 }],
              sales: [{ id: 'sale-1', date: '2026-06-01', customerNumber: 'C-1', driverName: 'Driver', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 1, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.addSaleAndRefetch('branch-1', '2026-06-01', {
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

    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/sales/0');
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products');
    expect(firebaseCalls.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'products' }));
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(9);
  });

  it('awaits edit sale write and returns only the refetched products snapshot', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache([
      {
        id: 'branch-1',
        name: 'Branch One',
        dateEntries: [
          {
            date: '2026-06-01',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 9 }],
            sales: [{ id: 'sale-1', date: '2026-06-01', customerNumber: 'C-1', driverName: 'Driver', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 1, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
          },
        ],
      },
    ]);
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Branch One',
          dateEntries: [
            {
              date: '2026-06-01',
              stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 7 }],
              sales: [{ id: 'sale-1', date: '2026-06-01', customerNumber: 'C-1', driverName: 'Driver', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 3, price: 300, driverCharge: 10, collection: 290, branchId: 'branch-1' }],
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.updateSaleAndRefetch('branch-1', '2026-06-01', 'sale-1', { quantity: 3, price: 300 });

    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/sales/0');
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products');
    expect(firebaseCalls.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'products' }));
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(7);
  });

  it('awaits delete sale soft-write and returns only the refetched products snapshot', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache([
      {
        id: 'branch-1',
        name: 'Branch One',
        dateEntries: [
          {
            date: '2026-06-01',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 9 }],
            sales: [{ id: 'sale-1', date: '2026-06-01', customerNumber: 'C-1', driverName: 'Driver', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 1, price: 100, driverCharge: 10, collection: 90, branchId: 'branch-1' }],
          },
        ],
      },
    ]);
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Branch One',
          dateEntries: [
            {
              date: '2026-06-01',
              stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 10 }],
              sales: [{ id: 'sale-1', deleted: true }],
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.deleteSaleAndRefetch('branch-1', '2026-06-01', 'sale-1');

    const updateCalls = firebaseCalls.update.mock.calls.map(([, updates]) => updates as Record<string, unknown>);
    const updateKeys = updateCalls.flatMap(updates => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/sales/0');
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products');
    expect(updateCalls.some(updates => (updates['products/0/dateEntries/0/sales/0'] as { deleted?: boolean })?.deleted === true)).toBe(true);
    expect(firebaseCalls.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'products' }));
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(10);
  });

  it('awaits receive production write and returns only the refetched products snapshot', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache(initialBranches());
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Branch One',
          dateEntries: [
            {
              date: '2026-06-01',
              stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 15 }],
              sales: [],
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.addStockItemAndRefetch('branch-1', '2026-06-01', {
      category: 'JUMBO',
      shelfSize: '5',
      color: 'Ivory',
      quantity: 5,
    });

    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products');
    expect(firebaseCalls.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'products' }));
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(15);
  });

  it('awaits transfer stock write and returns only the refetched products snapshot', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache(initialBranches());
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Branch One',
          dateEntries: [
            {
              date: '2026-06-01',
              stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 8 }],
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
              stock: [{ id: 'stock-2', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 101 }],
              sales: [],
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.transferStockAndRefetch('branch-1', 'branch-2', '2026-06-01', 'JUMBO', 'Ivory', '5', 2);

    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).toContain('products/1/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products');
    expect(firebaseCalls.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'products' }));
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(8);
    expect(branches[1].dateEntries[0].stock[0].quantity).toBe(101);
  });

  it('awaits external transfer write and returns only the refetched products snapshot', async () => {
    vi.resetModules();
    const store = await import('./store');
    store.initCache(initialBranches());
    firebaseCalls.get.mockResolvedValueOnce({
      val: () => [
        {
          id: 'branch-1',
          name: 'Branch One',
          dateEntries: [
            {
              date: '2026-06-01',
              stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 6 }],
              sales: [],
            },
          ],
        },
      ],
    });
    vi.clearAllMocks();

    const branches = await store.externalTransferAndRefetch('branch-1', '2026-06-01', 'JUMBO', 'Ivory', '5', 4);

    const updateKeys = firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates));
    expect(updateKeys).toContain('products/0/dateEntries/0/stock/0');
    expect(updateKeys).not.toContain('products');
    expect(firebaseCalls.get).toHaveBeenCalledWith(expect.objectContaining({ path: 'products' }));
    expect(branches[0].dateEntries[0].stock[0].quantity).toBe(6);
  });

  it('writes production and transfer history through sanitized exact child paths', async () => {
    vi.resetModules();
    const store = await import('./store');

    await store.logProductionReceive({
      date: '2026-06-10',
      branchId: 'branch-1',
      branchName: 'Branch One',
      product: 'JUMBO',
      color: 'Ivory',
      shelfSize: undefined as unknown as string,
      quantity: 3,
      fromName: undefined,
    });
    await store.logTransfer({
      date: '2026-06-10',
      fromBranchId: 'branch-1',
      fromBranchName: 'Branch One',
      toBranchId: 'branch-2',
      toBranchName: 'Branch Two',
      product: 'JUMBO',
      color: 'Ivory',
      shelfSize: undefined as unknown as string,
      quantity: 1,
      type: 'internal',
    });

    const setCalls = firebaseCalls.set.mock.calls.map(([refArg, value]) => ({ path: refArg.path, value }));
    const productionWrite = setCalls.find(call => call.path === 'production_history/mock-push-key');
    const transferWrite = setCalls.find(call => call.path === 'transfer_history/mock-push-key');

    expect(productionWrite?.value).toEqual(expect.objectContaining({ id: 'mock-push-key', quantity: 3 }));
    expect(transferWrite?.value).toEqual(expect.objectContaining({ id: 'mock-push-key', quantity: 1 }));
    expect(containsUndefined(productionWrite?.value)).toBe(false);
    expect(containsUndefined(transferWrite?.value)).toBe(false);
    expect(firebaseCalls.update.mock.calls.flatMap(([, updates]) => Object.keys(updates))).not.toContain('products');
  });
});
