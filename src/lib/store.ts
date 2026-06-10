import { Branch, SalesEntry, StockItem, DateEntry, createDefaultStock, ProductionRecord, TransferRecord } from './types';
import { db, firebaseConfig, PRODUCTS_PATH, PRODUCTION_HISTORY_PATH, TRANSFER_HISTORY_PATH } from './firebase';
import { ref, push, get } from 'firebase/database';
import {
  assertNonNegativeQuantity,
  assertValidBranch,
  assertValidDateEntry,
  createFirebaseBackup,
  safeSetPath,
  safeSoftDeletePath,
  safeUpdatePaths,
} from './firebaseProtection';

function migrateDoubleDeckorColor(stock: StockItem[]): StockItem[] {
  return stock.map(item => {
    if (item.category === 'DOUBLE DECKOR' && item.color === 'Coffee-Brown') {
      return { ...item, color: 'Coffee Beige' };
    }
    return item;
  });
}

function deduplicateStock(stock: StockItem[]): StockItem[] {
  const map = new Map<string, StockItem>();
  for (const item of stock) {
    const key = `${item.category}|${item.shelfSize || ''}|${item.color}`;
    const existing = map.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
}

const STORAGE_KEY = 'dynamic_app_data';

let cachedBranches: Branch[] = [];
let initialized = false;
let branchIndexById = new Map<string, number>();
let dateEntryIndexByBranchDate = new Map<string, number>();
let stockIndexByBranchDateStockId = new Map<string, number>();
let saleIndexByBranchDateSaleId = new Map<string, number>();
let nextBranchIndex = 0;
let nextDateEntryIndexByBranchId = new Map<string, number>();
let nextStockIndexByBranchDate = new Map<string, number>();
let nextSaleIndexByBranchDate = new Map<string, number>();
let pendingBackupPromises: Promise<void>[] = [];

type FirebaseRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  date?: string;
  deleted?: boolean;
  dateEntries?: unknown;
  stock?: unknown;
  sales?: unknown;
  product?: string;
  color?: string;
};

function isFirebaseRecord(value: unknown): value is FirebaseRecord {
  return !!value && typeof value === 'object';
}

function isActiveFirebaseRecord(value: unknown): value is FirebaseRecord {
  return isFirebaseRecord(value) && value.deleted !== true;
}

// Never call set() on `/products`; it can overwrite all branch data.
function productPath(...segments: (string | number)[]): string {
  return [PRODUCTS_PATH, ...segments].join('/');
}

function getBranchIndex(branches: Branch[], branchId: string): number {
  return branches.findIndex(b => b.id === branchId);
}

function getDateEntryIndex(branch: Branch, date: string): number {
  return branch.dateEntries.findIndex(d => d.date === date);
}

function getStockIndex(entry: DateEntry, stockId: string): number {
  return entry.stock.findIndex(s => s.id === stockId);
}

function getMatchingStockIndex(entry: DateEntry, product: string, color: string, shelfSize: string): number {
  return entry.stock.findIndex(s =>
    s.category === product && s.color === color && (s.shelfSize || '') === shelfSize);
}

function branchDateKey(branchId: string, date: string): string {
  return `${branchId}|${date}`;
}

function branchDateStockKey(branchId: string, date: string, stockId: string): string {
  return `${branchDateKey(branchId, date)}|${stockId}`;
}

function branchDateSaleKey(branchId: string, date: string, saleId: string): string {
  return `${branchDateKey(branchId, date)}|${saleId}`;
}

function getFirebaseBranchIndex(branches: Branch[], branchId: string): number {
  return branchIndexById.get(branchId) ?? getBranchIndex(branches, branchId);
}

function getFirebaseDateEntryIndex(branchId: string, date: string, fallbackIndex: number): number {
  return dateEntryIndexByBranchDate.get(branchDateKey(branchId, date)) ?? fallbackIndex;
}

function getFirebaseStockIndex(branchId: string, date: string, stockId: string, fallbackIndex: number): number {
  return stockIndexByBranchDateStockId.get(branchDateStockKey(branchId, date, stockId)) ?? fallbackIndex;
}

function getFirebaseSaleIndex(branchId: string, date: string, saleId: string, fallbackIndex: number): number {
  return saleIndexByBranchDateSaleId.get(branchDateSaleKey(branchId, date, saleId)) ?? fallbackIndex;
}

function getNextDateEntryIndex(branchId: string, branch: Branch): number {
  const nextIndex = nextDateEntryIndexByBranchId.get(branchId);
  if (typeof nextIndex === 'number') return nextIndex;
  const indexes = branch.dateEntries
    .map(entry => dateEntryIndexByBranchDate.get(branchDateKey(branchId, entry.date)))
    .filter((idx): idx is number => typeof idx === 'number');
  return indexes.length > 0 ? Math.max(...indexes) + 1 : branch.dateEntries.length;
}

function getNextStockIndex(branchId: string, date: string, entry: DateEntry): number {
  const key = branchDateKey(branchId, date);
  const nextIndex = nextStockIndexByBranchDate.get(key);
  if (typeof nextIndex === 'number') return nextIndex;
  const indexes = entry.stock
    .map(item => stockIndexByBranchDateStockId.get(branchDateStockKey(branchId, date, item.id)))
    .filter((idx): idx is number => typeof idx === 'number');
  return indexes.length > 0 ? Math.max(...indexes) + 1 : entry.stock.length;
}

function getNextSaleIndex(branchId: string, date: string, entry: DateEntry): number {
  const key = branchDateKey(branchId, date);
  const nextIndex = nextSaleIndexByBranchDate.get(key);
  if (typeof nextIndex === 'number') return nextIndex;
  const indexes = entry.sales
    .map(sale => saleIndexByBranchDateSaleId.get(branchDateSaleKey(branchId, date, sale.id)))
    .filter((idx): idx is number => typeof idx === 'number');
  return indexes.length > 0 ? Math.max(...indexes) + 1 : entry.sales.length;
}

function rememberBranchIndex(branchId: string, branchIndex: number) {
  branchIndexById.set(branchId, branchIndex);
  nextBranchIndex = Math.max(nextBranchIndex, branchIndex + 1);
}

function rememberDateEntryIndex(branchId: string, date: string, entryIndex: number) {
  dateEntryIndexByBranchDate.set(branchDateKey(branchId, date), entryIndex);
  rememberNextDateEntryIndex(branchId, entryIndex + 1);
}

function rememberNextDateEntryIndex(branchId: string, entryIndex: number) {
  nextDateEntryIndexByBranchId.set(branchId, Math.max(nextDateEntryIndexByBranchId.get(branchId) ?? 0, entryIndex));
}

function rememberStockIndex(branchId: string, date: string, stockId: string, stockIndex: number) {
  stockIndexByBranchDateStockId.set(branchDateStockKey(branchId, date, stockId), stockIndex);
  rememberNextStockIndex(branchId, date, stockIndex + 1);
}

function rememberNextStockIndex(branchId: string, date: string, stockIndex: number) {
  const key = branchDateKey(branchId, date);
  nextStockIndexByBranchDate.set(key, Math.max(nextStockIndexByBranchDate.get(key) ?? 0, stockIndex));
}

function rememberSaleIndex(branchId: string, date: string, saleId: string, saleIndex: number) {
  saleIndexByBranchDateSaleId.set(branchDateSaleKey(branchId, date, saleId), saleIndex);
  rememberNextSaleIndex(branchId, date, saleIndex + 1);
}

function rememberNextSaleIndex(branchId: string, date: string, saleIndex: number) {
  const key = branchDateKey(branchId, date);
  nextSaleIndexByBranchDate.set(key, Math.max(nextSaleIndexByBranchDate.get(key) ?? 0, saleIndex));
}

function writeProductChild(pathSegments: (string | number)[], value: unknown, options?: Parameters<typeof safeSetPath>[2]) {
  const path = productPath(...pathSegments);
  console.log('[Firebase child write]', { path });
  safeSetPath(path, value, { action: 'set', entity: 'products-child', ...options })
    .then(() => console.log('[Firebase child write result]', { path, result: 'success' }))
    .catch(err => console.error('[Firebase child write result]', { path, result: 'error', error: err }));
}

async function writeProductChildren(updates: Record<string, unknown>, options: Parameters<typeof safeUpdatePaths>[1] | string = 'products child update') {
  const backups = pendingBackupPromises;
  pendingBackupPromises = [];
  const backupBarrier = backups.length > 0 ? Promise.all(backups).then(() => undefined) : Promise.resolve();
  const writeOptions = typeof options === 'string'
    ? { action: 'update' as const, entity: 'products-child', reason: options }
    : { action: 'update' as const, entity: 'products-child', ...options };
  const updatePaths = Object.keys(updates);
  console.log('[Firebase stock write pending]', {
    databaseURL: firebaseConfig.databaseURL,
    updatePaths,
    oldStockValue: 'oldStock' in writeOptions ? writeOptions.oldStock : undefined,
    newStockValue: 'newStock' in writeOptions ? writeOptions.newStock : undefined,
  });
  try {
    await backupBarrier;
    await safeUpdatePaths(updates, writeOptions);
    console.log('[Firebase stock write success]', {
      databaseURL: firebaseConfig.databaseURL,
      updatePaths,
    });
  } catch (err) {
    console.error('[Firebase stock write failure]', {
      databaseURL: firebaseConfig.databaseURL,
      updatePaths,
      error: err,
    });
    throw err;
  }
}

function updateProductChildren(updates: Record<string, unknown>, options: Parameters<typeof safeUpdatePaths>[1] | string = 'products child update') {
  writeProductChildren(updates, options).catch(err => console.error('Firebase backup/write failed:', err));
}

function softDeleteProductChild(pathSegments: (string | number)[], reason = 'products child soft delete', options?: Omit<Parameters<typeof safeSoftDeletePath>[1], 'entity' | 'reason'>) {
  const path = productPath(...pathSegments);
  safeSoftDeletePath(path, { entity: 'products-child', reason, ...options })
    .catch(err => console.error('Firebase soft delete failed:', err));
}

function backupBranchBeforeRecalculation(branchIndex: number, branch: Branch, reason: string) {
  pendingBackupPromises.push(createFirebaseBackup(productPath(branchIndex), branch, reason));
}

function stockKey(item: Pick<StockItem, 'category' | 'color'> & { shelfSize?: string }): string {
  return `${item.category}|${item.shelfSize || ''}|${item.color}`;
}

function stockMap(stock: StockItem[]): Map<string, StockItem> {
  return new Map(stock.map(item => [stockKey(item), item]));
}

function sortDateEntriesAscending(branch: Branch) {
  branch.dateEntries.sort((a, b) => a.date.localeCompare(b.date));
}

function getSoldQuantityByStockKey(entry: DateEntry): Map<string, number> {
  const sold = new Map<string, number>();
  entry.sales.forEach(sale => {
    const key = `${sale.product}|${sale.shelfSize || ''}|${sale.color}`;
    sold.set(key, (sold.get(key) || 0) + sale.quantity);
  });
  return sold;
}

function cloneClosingStockWithSalesApplied(openingStock: StockItem[], entry: DateEntry): StockItem[] {
  const closingStock = openingStock.map(item => ({ ...item }));
  const closingMap = stockMap(closingStock);
  const soldByKey = getSoldQuantityByStockKey(entry);

  soldByKey.forEach((soldQty, key) => {
    const item = closingMap.get(key);
    if (item) item.quantity = Math.max(0, item.quantity - soldQty);
  });

  return closingStock;
}

function isManualStockAnchor(entry: DateEntry): boolean {
  return Boolean(entry.manualStockEditedAt);
}

const MANUAL_STOCK_EDIT_REASON = 'manual-stock-edit';

function stockQuantityByKey(stock: StockItem[], key: string): number {
  return stockMap(stock).get(key)?.quantity || 0;
}

function totalStockQuantity(stock: StockItem[]): number {
  return stock.reduce((sum, item) => sum + item.quantity, 0);
}

function totalSalesQuantity(entry: DateEntry): number {
  return entry.sales.reduce((sum, sale) => sum + sale.quantity, 0);
}

function stockMismatchCount(left: StockItem[], right: StockItem[]): number {
  const keys = new Set([...left.map(stockKey), ...right.map(stockKey)]);
  let mismatches = 0;
  keys.forEach(key => {
    if (stockQuantityByKey(left, key) !== stockQuantityByKey(right, key)) mismatches += 1;
  });
  return mismatches;
}

function nonZeroStockRows(stock: StockItem[]) {
  return stock
    .filter(item => item.quantity > 0)
    .map(item => ({
      category: item.category,
      shelfSize: item.shelfSize || '',
      color: item.color,
      quantity: item.quantity,
    }));
}

function stockAuditSnapshot(stock: StockItem[]) {
  const rows = stock
    .map(item => ({
      category: item.category,
      shelfSize: item.shelfSize || '',
      color: item.color,
      quantity: item.quantity,
    }))
    .sort((a, b) => `${a.category}|${a.shelfSize}|${a.color}`.localeCompare(`${b.category}|${b.shelfSize}|${b.color}`));
  return {
    total: rows.reduce((sum, item) => sum + item.quantity, 0),
    rows,
  };
}

function sameStockSnapshot(left: StockItem[], right: StockItem[]) {
  const leftSnapshot = stockAuditSnapshot(left);
  const rightSnapshot = stockAuditSnapshot(right);
  if (leftSnapshot.total !== rightSnapshot.total || leftSnapshot.rows.length !== rightSnapshot.rows.length) return false;
  return leftSnapshot.rows.every((item, index) => {
    const other = rightSnapshot.rows[index];
    return item.category === other.category
      && item.shelfSize === other.shelfSize
      && item.color === other.color
      && item.quantity === other.quantity;
  });
}

function stockWriteAudit(
  branch: Branch,
  date: string,
  oldStock: StockItem[],
  newStock: StockItem[],
  stockChangeReason: string,
  reason = stockChangeReason
) {
  return {
    reason,
    branch: branch.name,
    date,
    oldStock: stockAuditSnapshot(oldStock),
    newStock: stockAuditSnapshot(newStock),
    approvedStockAction: true,
    stockChangeReason,
  };
}

function recalculateFutureDateEntries(
  branches: Branch[],
  branch: Branch,
  branchId: string,
  changedDate: string,
  afterStock: StockItem[],
  firebaseUpdates: Record<string, unknown>
) {
  sortDateEntriesAscending(branch);
  const changedIndex = branch.dateEntries.findIndex(entry => entry.date === changedDate);
  if (changedIndex === -1) return;

  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const affectedPaths: string[] = [];
  let previousClosingStock = afterStock.map(item => ({ ...item }));

  for (let i = changedIndex + 1; i < branch.dateEntries.length; i++) {
    const entry = branch.dateEntries[i];
    if (isManualStockAnchor(entry)) {
      previousClosingStock = entry.stock.map(item => ({ ...item }));
      console.warn('[Stock recalculation preserved manual stock]', {
        branchId,
        date: entry.date,
        manualStockEditedAt: entry.manualStockEditedAt,
        preservedStock: totalStockQuantity(entry.stock),
        reason: 'manual stock edit is source of truth',
      });
      continue;
    }
    const openingStock = previousClosingStock.map(item => ({ ...item }));
    const previousSnapshot = entry.stock.map(item => ({ ...item }));
    const closingStock = cloneClosingStockWithSalesApplied(openingStock, entry);
    const soldByKey = getSoldQuantityByStockKey(entry);

    entry.stock = closingStock;
    entry.stock.forEach((item, stockIndex) => rememberStockIndex(branchId, entry.date, item.id, stockIndex));

    const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, entry.date, i);
    const path = productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex);
    firebaseUpdates[path] = entry;
    affectedPaths.push(path);

    console.log('[Daily stock ledger recalculation]', {
      branchId,
      date: entry.date,
      openingStock: totalStockQuantity(openingStock),
      receivedStock: 0,
      transferIn: 0,
      transferOut: 0,
      soldQty: Array.from(soldByKey.values()).reduce((sum, qty) => sum + qty, 0),
      closingStock: totalStockQuantity(closingStock),
      recalculatedStock: totalStockQuantity(closingStock),
      previousSnapshotStock: totalStockQuantity(previousSnapshot),
      stockKeys: Array.from(new Set([...openingStock.map(stockKey), ...soldByKey.keys()])).map(key => ({
        key,
        openingStock: stockQuantityByKey(openingStock, key),
        soldQty: soldByKey.get(key) || 0,
        closingStock: stockQuantityByKey(closingStock, key),
      })),
    });

    previousClosingStock = closingStock;
  }

  console.log('[Stock ledger recalculation verification]', {
    branchId,
    changedDate,
    changedDateIndex: changedIndex,
    affectedFutureEntriesCount: affectedPaths.length,
    affectedPaths,
  });
}

function migrateFromLocalStorage(): Branch[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return null;
    const migrated = data.map((b: unknown) => {
      if (!isFirebaseRecord(b) || !b.id || !b.name) return null;
      if (Array.isArray(b.dateEntries)) return b as Branch;
      const dateEntries: DateEntry[] = [];
      const today = new Date().toISOString().split('T')[0];
      const oldStock = Array.isArray(b.stock) ? b.stock : [];
      const oldSales = Array.isArray(b.sales) ? b.sales : [];
      const stockWithIds = oldStock
        .filter(isFirebaseRecord)
        .map((s) => ({ ...s, id: s.id || crypto.randomUUID() })) as StockItem[];
      if (stockWithIds.length > 0 || oldSales.length > 0) {
        dateEntries.push({ date: today, stock: stockWithIds, sales: oldSales as SalesEntry[] });
      }
      return { id: b.id, name: b.name, dateEntries } as Branch;
    }).filter(Boolean) as Branch[];
    return migrated.length > 0 ? migrated : null;
  } catch {
    return null;
  }
}

function sanitizeBranches(data: unknown): Branch[] {
  branchIndexById = new Map<string, number>();
  dateEntryIndexByBranchDate = new Map<string, number>();
  stockIndexByBranchDateStockId = new Map<string, number>();
  saleIndexByBranchDateSaleId = new Map<string, number>();
  nextBranchIndex = 0;
  nextDateEntryIndexByBranchId = new Map<string, number>();
  nextStockIndexByBranchDate = new Map<string, number>();
  nextSaleIndexByBranchDate = new Map<string, number>();
  if (!Array.isArray(data)) return [];
  nextBranchIndex = data.length;
  return data.map((b: unknown, branchIndex) => {
    if (!isActiveFirebaseRecord(b) || !b.id || !b.name) return null;
    rememberBranchIndex(b.id, branchIndex);
    const dateEntries = Array.isArray(b.dateEntries) ? b.dateEntries.map((d: unknown, entryIndex) => {
      if (!isActiveFirebaseRecord(d)) return null;
      rememberDateEntryIndex(b.id, d.date || '', entryIndex);
      rememberNextDateEntryIndex(b.id, entryIndex + 1);
      const rawStock = Array.isArray(d.stock) ? d.stock : [];
      const rawSales = Array.isArray(d.sales) ? d.sales : [];
      rememberNextStockIndex(b.id, d.date || '', rawStock.length);
      rememberNextSaleIndex(b.id, d.date || '', rawSales.length);
      const stock = deduplicateStock(migrateDoubleDeckorColor(rawStock.filter(isActiveFirebaseRecord) as StockItem[]));
      stock.forEach((item) => {
        if (item.id) {
          rememberStockIndex(
            b.id,
            d.date || '',
            item.id,
            rawStock.findIndex((rawItem) => isFirebaseRecord(rawItem) && rawItem.id === item.id)
          );
        }
      });
      const sales = rawSales.filter(isActiveFirebaseRecord).map((s, compactSaleIndex) => {
        const sale = s.product === 'DOUBLE DECKOR' && s.color === 'Coffee-Brown' ? { ...s, color: 'Coffee Beige' } : s;
        if (sale.id) {
          rememberSaleIndex(
            b.id,
            d.date || '',
            sale.id,
            rawSales.findIndex((rawSale) => isFirebaseRecord(rawSale) && rawSale.id === sale.id) ?? compactSaleIndex
          );
        }
        return sale as SalesEntry;
      });
      return {
        date: d.date || '',
        stock,
        sales,
        manualStockEditedAt: typeof d.manualStockEditedAt === 'string' ? d.manualStockEditedAt : undefined,
        manualStockEditReason: typeof d.manualStockEditReason === 'string' ? d.manualStockEditReason : undefined,
      };
    }).filter(Boolean) as DateEntry[] : [];
    for (const entry of dateEntries) {
      for (const item of entry.stock) {
        if ((item.category === 'PREMIUM' || item.category === 'DOUBLE DECKOR') && !item.shelfSize) {
          item.shelfSize = '5';
        }
      }
    }
    return { id: b.id, name: b.name, dateEntries } as Branch;
  }).filter(Boolean) as Branch[];
}

export function initCache(data: unknown): Branch[] {
  const branches = sanitizeBranches(data);
  if (branches.length === 0 && !initialized) {
    const migrated = migrateFromLocalStorage();
    if (migrated) {
      cachedBranches = migrated;
      console.warn('[Blocked automatic stock write]', {
        reason: 'localStorage migration is read-only until manually reviewed',
        affectedBranches: migrated.map(branch => branch.name),
      });
      initialized = true;
      return migrated;
    }
  }
  cachedBranches = branches;
  initialized = true;
  return branches;
}

export function updateCache(data: unknown): Branch[] {
  cachedBranches = sanitizeBranches(data);
  return cachedBranches;
}

export async function refetchProductsFromFirebase(reason = 'manual refresh'): Promise<Branch[]> {
  console.log('[Firebase products refetch pending]', {
    databaseURL: firebaseConfig.databaseURL,
    path: PRODUCTS_PATH,
    reason,
  });
  const snapshot = await get(ref(db, PRODUCTS_PATH));
  const branches = updateCache(snapshot.val());
  const dashboardTotalAfterRefetch = branches.reduce((total, branch) => {
    const latest = getLatestDateEntry(branch);
    return total + (latest?.stock.reduce((sum, item) => sum + item.quantity, 0) || 0);
  }, 0);
  console.log('[Firebase products refetch result]', {
    databaseURL: firebaseConfig.databaseURL,
    path: PRODUCTS_PATH,
    reason,
    branchCount: branches.length,
    dashboardTotalAfterRefetch,
    branches: branches.map(branch => ({
      id: branch.id,
      name: branch.name,
      latestDate: getLatestDateEntry(branch)?.date || null,
      latestStockTotal: getLatestDateEntry(branch)?.stock.reduce((sum, item) => sum + item.quantity, 0) || 0,
    })),
  });
  return branches;
}

export function getBranches(): Branch[] {
  return cachedBranches;
}

export function saveBranches(branches: Branch[]) {
  cachedBranches = branches;
}

export function addBranch(name: string): Branch[] {
  const branches = [...cachedBranches];
  const newBranch = { id: crypto.randomUUID(), name, dateEntries: [] };
  const branchIndex = nextBranchIndex || branches.length;
  branches.push(newBranch);
  cachedBranches = branches;
  rememberBranchIndex(newBranch.id, branchIndex);
  writeProductChild([branchIndex], newBranch);
  return branches;
}

export function updateBranch(id: string, updates: Partial<Branch>): Branch[] {
  const branches = [...cachedBranches];
  const idx = branches.findIndex(b => b.id === id);
  if (idx !== -1) {
    branches[idx] = { ...branches[idx], ...updates };
    const firebaseBranchIndex = getFirebaseBranchIndex(branches, id);
    const childUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
      acc[productPath(firebaseBranchIndex, key)] = value;
      return acc;
    }, {} as Record<string, unknown>);
    updateProductChildren(childUpdates, 'branch update');
  }
  cachedBranches = branches;
  return branches;
}

export function deleteBranch(id: string): Branch[] {
  const idx = getFirebaseBranchIndex(cachedBranches, id);
  const branches = cachedBranches.filter(b => b.id !== id);
  cachedBranches = branches;
  if (idx !== -1) softDeleteProductChild([idx], 'branch soft delete');
  return branches;
}

export function addDateEntry(branchId: string, date: string, options?: { source?: string }): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  if (branch.dateEntries.find(d => d.date === date)) {
    console.log('[Add date entry skipped]', {
      selectedDate: date,
      branchId,
      source: options?.source || 'manual',
      reason: 'Date entry already exists',
      updatedStateCount: branch.dateEntries.length,
    });
    return branches;
  }
  const previousEntries = branch.dateEntries
    .filter(d => d.date < date)
    .sort((a, b) => b.date.localeCompare(a.date));
  const previousEntry = previousEntries[0];
  if (options?.source === 'auto' && !previousEntry) {
    console.warn('[Blocked automatic date entry]', {
      selectedDate: date,
      branchId,
      reason: 'No previous closing stock exists to carry forward',
    });
    return branches;
  }
  const newStock = deduplicateStock(previousEntry
    ? structuredClone(previousEntry.stock)
    : createDefaultStock());
  if (options?.source === 'auto' && previousEntry && !sameStockSnapshot(previousEntry.stock, newStock)) {
    console.warn('[Blocked automatic date entry]', {
      selectedDate: date,
      branchId,
      openingStockDate: previousEntry.date,
      reason: 'Automatic carry-forward stock did not match previous closing stock exactly',
    });
    return branches;
  }
  const entryIndex = getNextDateEntryIndex(branchId, branch);
  const newEntry = { date, stock: newStock, sales: [] };
  branch.dateEntries.push(newEntry);
  rememberDateEntryIndex(branchId, date, entryIndex);
  newEntry.stock.forEach((item, stockIndex) => rememberStockIndex(branchId, date, item.id, stockIndex));
  const firebaseWritePath = productPath(firebaseBranchIndex, 'dateEntries', entryIndex);
  console.log('[Add date entry local update]', {
    selectedDate: date,
    branchId,
    source: options?.source || 'manual',
    openingStockDate: previousEntry?.date || null,
    openingStock: previousEntry ? totalStockQuantity(previousEntry.stock) : 0,
    closingStock: totalStockQuantity(newStock),
    salesQuantity: 0,
    recalculatedStock: totalStockQuantity(newStock),
    firebaseWritePath,
    updatedStateCount: branch.dateEntries.length,
  });
  if (options?.source === 'auto') {
    console.log('[Auto daily entry created path]', {
      todaysDate: date,
      branchId,
      autoCreatedPath: firebaseWritePath,
    });
  }
  writeProductChild(
    [firebaseBranchIndex, 'dateEntries', entryIndex],
    newEntry,
    stockWriteAudit(
      branch,
      date,
      previousEntry?.stock || [],
      newStock,
      options?.source === 'auto' ? 'auto-date-carry-forward' : 'manual-date-create',
      options?.source === 'auto' ? 'auto date carry-forward' : 'manual date create'
    )
  );
  cachedBranches = branches;
  return branches;
}

export function deleteDateEntry(branchId: string, date: string): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  branch.dateEntries = branch.dateEntries.filter(d => d.date !== date);
  cachedBranches = branches;
  if (entryIndex !== -1) {
    softDeleteProductChild(
      [firebaseBranchIndex, 'dateEntries', firebaseEntryIndex],
      'date entry soft delete',
      stockWriteAudit(branch, date, entry.stock, [], 'manual-stock-edit', 'date entry soft delete')
    );
  }
  return branches;
}

export function updateStockItem(branchId: string, date: string, stockId: string, updates: Partial<StockItem>): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;
  const idx = getStockIndex(entry, stockId);
  const firebaseUpdates: Record<string, unknown> = {};
  const beforeStock = entry.stock.map(item => ({ ...item }));
  if (idx !== -1) {
    entry.stock[idx] = { ...entry.stock[idx], ...updates };
    entry.manualStockEditedAt = new Date().toISOString();
    entry.manualStockEditReason = MANUAL_STOCK_EDIT_REASON;
    assertNonNegativeQuantity(entry.stock[idx].quantity, 'stock quantity');
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, stockId, idx);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[idx];
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'manualStockEditedAt')] = entry.manualStockEditedAt;
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'manualStockEditReason')] = entry.manualStockEditReason;
    backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before stock item recalculation');
    recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  }
  cachedBranches = branches;
  if (Object.keys(firebaseUpdates).length > 0) updateProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'manual-stock-edit', 'stock item update'));
  return branches;
}

export function addStockItem(branchId: string, date: string, item: Omit<StockItem, 'id'>): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  assertNonNegativeQuantity(item.quantity, 'stock item quantity');
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;
  const firebaseUpdates: Record<string, unknown> = {};
  const beforeStock = entry.stock.map(stockItem => ({ ...stockItem }));
  const existingIndex = entry.stock.findIndex(s => s.category === item.category && (s.shelfSize || '') === (item.shelfSize || '') && s.color === item.color);
  if (existingIndex !== -1) {
    entry.stock[existingIndex].quantity += item.quantity;
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[existingIndex].id, existingIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[existingIndex];
  } else {
    const stockIndex = getNextStockIndex(branchId, date, entry);
    const newItem = { ...item, id: crypto.randomUUID() };
    entry.stock.push(newItem);
    rememberStockIndex(branchId, date, newItem.id, stockIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', stockIndex)] = newItem;
  }
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before stock receive recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;
  updateProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'receive-production', 'stock item add/receive'));
  return branches;
}

export function deleteStockItem(branchId: string, date: string, stockId: string): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;
  const beforeStock = entry.stock.map(item => ({ ...item }));
  const stockIndex = getStockIndex(entry, stockId);
  const deletedStock = entry.stock[stockIndex];
  entry.stock = entry.stock.filter(s => s.id !== stockId);
  entry.manualStockEditedAt = new Date().toISOString();
  entry.manualStockEditReason = MANUAL_STOCK_EDIT_REASON;
  cachedBranches = branches;
  if (stockIndex !== -1) {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, stockId, stockIndex);
    updateProductChildren({
      [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)]: {
        ...deletedStock,
        deleted: true,
        deletedAt: new Date().toISOString(),
      },
      [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'manualStockEditedAt')]: entry.manualStockEditedAt,
      [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'manualStockEditReason')]: entry.manualStockEditReason,
    }, stockWriteAudit(branch, date, beforeStock, entry.stock, 'manual-stock-edit', 'stock item soft delete'));
  }
  return branches;
}

export function updateDateStock(branchId: string, date: string, stock: StockItem[]): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;
  stock.forEach(item => assertNonNegativeQuantity(item.quantity, 'date stock quantity'));

  const beforeStock = entry.stock.map(item => ({ ...item }));
  const oldStockTotal = totalStockQuantity(beforeStock);

  entry.stock = stock;
  entry.manualStockEditedAt = new Date().toISOString();
  entry.manualStockEditReason = MANUAL_STOCK_EDIT_REASON;

  const newStockTotal = totalStockQuantity(stock);

  // Write exact child paths for stock and metadata (no full entry write)
  const firebaseUpdates: Record<string, unknown> = {};

  // Write each stock item to its exact path
  stock.forEach((item, idx) => {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, item.id, idx);
    const stockPath = productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex);
    firebaseUpdates[stockPath] = item;
  });

  // Write manual metadata to exact child paths
  const metadataPath = productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex);
  firebaseUpdates[`${metadataPath}/manualStockEditedAt`] = entry.manualStockEditedAt;
  firebaseUpdates[`${metadataPath}/manualStockEditReason`] = entry.manualStockEditReason;

  console.log('[Manual stock edit - exact child path write]', {
    branchId,
    date,
    firebaseBranchIndex,
    firebaseEntryIndex,
    oldStockTotal,
    newStockTotal,
    stockItems: stock.length,
    manualStockEditedAt: entry.manualStockEditedAt,
    manualStockEditReason: entry.manualStockEditReason,
    updatePaths: Object.keys(firebaseUpdates),
    stockPaths: Object.keys(firebaseUpdates).filter(k => k.includes('/stock/')),
  });

  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before date stock manual edit recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;

  const auditEntry = stockWriteAudit(branch, date, beforeStock, entry.stock, 'manual-stock-edit', 'date stock update');
  console.log('[Manual stock edit - Firebase update payload]', {
    branchId,
    date,
    updatePathCount: Object.keys(firebaseUpdates).length,
    auditReason: auditEntry.reason,
    oldStockSnapshot: auditEntry.oldStock,
    newStockSnapshot: auditEntry.newStock,
  });

  updateProductChildren(firebaseUpdates, auditEntry);

  return branches;
}

export async function updateDateStockAndRefetch(branchId: string, date: string, stock: StockItem[]): Promise<Branch[]> {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return refetchProductsFromFirebase('manual stock edit branch not found');
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return refetchProductsFromFirebase('manual stock edit date entry not found');
  stock.forEach(item => assertNonNegativeQuantity(item.quantity, 'date stock quantity'));

  const beforeStock = entry.stock.map(item => ({ ...item }));
  const oldStockTotal = totalStockQuantity(beforeStock);

  entry.stock = stock;
  entry.manualStockEditedAt = new Date().toISOString();
  entry.manualStockEditReason = MANUAL_STOCK_EDIT_REASON;

  const newStockTotal = totalStockQuantity(stock);
  const firebaseUpdates: Record<string, unknown> = {};

  stock.forEach((item, idx) => {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, item.id, idx);
    const stockPath = productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex);
    firebaseUpdates[stockPath] = item;
  });

  const metadataPath = productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex);
  firebaseUpdates[`${metadataPath}/manualStockEditedAt`] = entry.manualStockEditedAt;
  firebaseUpdates[`${metadataPath}/manualStockEditReason`] = entry.manualStockEditReason;

  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before date stock manual edit recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);

  const auditEntry = stockWriteAudit(branch, date, beforeStock, entry.stock, 'manual-stock-edit', 'date stock update');
  console.log('[Manual stock edit - Firebase authoritative save]', {
    databaseURL: firebaseConfig.databaseURL,
    branchId,
    date,
    firebaseBranchIndex,
    firebaseEntryIndex,
    oldStockValue: auditEntry.oldStock,
    newStockValue: auditEntry.newStock,
    oldStockTotal,
    newStockTotal,
    firebaseWritePaths: Object.keys(firebaseUpdates),
    stockPaths: Object.keys(firebaseUpdates).filter(k => k.includes('/stock/')),
  });

  await writeProductChildren(firebaseUpdates, auditEntry);
  return refetchProductsFromFirebase('manual stock edit saved');
}

export async function addStockItemAndRefetch(branchId: string, date: string, item: Omit<StockItem, 'id'>): Promise<Branch[]> {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return refetchProductsFromFirebase('receive production branch not found');
  assertNonNegativeQuantity(item.quantity, 'stock item quantity');
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return refetchProductsFromFirebase('receive production date entry not found');
  const firebaseUpdates: Record<string, unknown> = {};
  const beforeStock = entry.stock.map(stockItem => ({ ...stockItem }));
  const existingIndex = entry.stock.findIndex(s => s.category === item.category && (s.shelfSize || '') === (item.shelfSize || '') && s.color === item.color);
  if (existingIndex !== -1) {
    entry.stock[existingIndex].quantity += item.quantity;
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[existingIndex].id, existingIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[existingIndex];
  } else {
    const stockIndex = getNextStockIndex(branchId, date, entry);
    const newItem = { ...item, id: crypto.randomUUID() };
    entry.stock.push(newItem);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', stockIndex)] = newItem;
  }
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before stock receive recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  await writeProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'receive-production', 'stock item add/receive'));
  return refetchProductsFromFirebase('receive production saved');
}

export async function addSaleAndRefetch(branchId: string, date: string, sale: Omit<SalesEntry, 'id' | 'branchId' | 'collection'>): Promise<Branch[]> {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return refetchProductsFromFirebase('add sale branch not found');
  assertNonNegativeQuantity(sale.quantity, 'sale quantity');
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return refetchProductsFromFirebase('add sale date entry not found');
  const beforeStock = entry.stock.map(item => ({ ...item }));
  const newSale: SalesEntry = {
    ...sale,
    id: crypto.randomUUID(),
    branchId,
    collection: sale.price - sale.driverCharge,
  };
  const saleIndex = getNextSaleIndex(branchId, date, entry);
  entry.sales.push(newSale);
  const stockIndex = getMatchingStockIndex(entry, sale.product, sale.color, sale.shelfSize || '');
  const updates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'sales', saleIndex)]: newSale,
  };
  if (stockIndex !== -1) {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[stockIndex].id, stockIndex);
    entry.stock[stockIndex].quantity = Math.max(0, entry.stock[stockIndex].quantity - sale.quantity);
    updates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[stockIndex];
  }
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before add sale recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, updates);
  await writeProductChildren(updates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'add-sale', 'add sale'));
  return refetchProductsFromFirebase('add sale saved');
}

export async function updateSaleAndRefetch(branchId: string, date: string, saleId: string, updates: Partial<SalesEntry>): Promise<Branch[]> {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return refetchProductsFromFirebase('edit sale branch not found');
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return refetchProductsFromFirebase('edit sale date entry not found');
  const saleIdx = entry.sales.findIndex(s => s.id === saleId);
  if (saleIdx === -1) return refetchProductsFromFirebase('edit sale sale not found');
  const beforeStock = entry.stock.map(item => ({ ...item }));
  const oldSale = entry.sales[saleIdx];
  const oldStockIndex = getMatchingStockIndex(entry, oldSale.product, oldSale.color, oldSale.shelfSize || '');
  if (oldStockIndex !== -1) entry.stock[oldStockIndex].quantity += oldSale.quantity;
  const updatedSale = { ...oldSale, ...updates };
  assertNonNegativeQuantity(updatedSale.quantity, 'sale quantity');
  updatedSale.collection = updatedSale.price - updatedSale.driverCharge;
  entry.sales[saleIdx] = updatedSale;
  const newStockIndex = getMatchingStockIndex(entry, updatedSale.product, updatedSale.color, updatedSale.shelfSize || '');
  if (newStockIndex !== -1) entry.stock[newStockIndex].quantity = Math.max(0, entry.stock[newStockIndex].quantity - updatedSale.quantity);
  const firebaseSaleIndex = getFirebaseSaleIndex(branchId, date, saleId, saleIdx);
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'sales', firebaseSaleIndex)]: updatedSale,
  };
  if (oldStockIndex !== -1) {
    const firebaseOldStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[oldStockIndex].id, oldStockIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseOldStockIndex)] = entry.stock[oldStockIndex];
  }
  if (newStockIndex !== -1) {
    const firebaseNewStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[newStockIndex].id, newStockIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseNewStockIndex)] = entry.stock[newStockIndex];
  }
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before edit sale recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  await writeProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'edit-sale', 'edit sale'));
  return refetchProductsFromFirebase('edit sale saved');
}

export async function deleteSaleAndRefetch(branchId: string, date: string, saleId: string): Promise<Branch[]> {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return refetchProductsFromFirebase('delete sale branch not found');
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return refetchProductsFromFirebase('delete sale date entry not found');
  const saleIndex = entry.sales.findIndex(s => s.id === saleId);
  const sale = entry.sales[saleIndex];
  if (!sale) return refetchProductsFromFirebase('delete sale sale not found');
  const beforeStock = entry.stock.map(item => ({ ...item }));
  const stockIndex = getMatchingStockIndex(entry, sale.product, sale.color, sale.shelfSize || '');
  if (stockIndex !== -1) entry.stock[stockIndex].quantity += sale.quantity;
  entry.sales = entry.sales.filter(s => s.id !== saleId);
  const firebaseUpdates: Record<string, unknown> = {};
  if (stockIndex !== -1) {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[stockIndex].id, stockIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[stockIndex];
  }
  const firebaseSaleIndex = getFirebaseSaleIndex(branchId, date, saleId, saleIndex);
  firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'sales', firebaseSaleIndex)] = {
    ...sale,
    deleted: true,
    deletedAt: new Date().toISOString(),
  };
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before delete sale recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  await writeProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'delete-sale', 'soft delete sale'));
  return refetchProductsFromFirebase('delete sale saved');
}

export function acceptStoredStockAsCorrect(branchId: string, date: string): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;

  const beforeStock = entry.stock.map(item => ({ ...item }));
  entry.manualStockEditedAt = new Date().toISOString();
  entry.manualStockEditReason = MANUAL_STOCK_EDIT_REASON;
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'manualStockEditedAt')]: entry.manualStockEditedAt,
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'manualStockEditReason')]: entry.manualStockEditReason,
  };
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before accepted stored stock recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;
  updateProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, MANUAL_STOCK_EDIT_REASON, 'accept stored stock as correct'));
  return branches;
}

export function addSale(branchId: string, date: string, sale: Omit<SalesEntry, 'id' | 'branchId' | 'collection'>): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  assertNonNegativeQuantity(sale.quantity, 'sale quantity');
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;
  const beforeStock = entry.stock.map(item => ({ ...item }));
  const newSale: SalesEntry = {
    ...sale,
    id: crypto.randomUUID(),
    branchId,
    collection: sale.price - sale.driverCharge,
  };
  const saleIndex = getNextSaleIndex(branchId, date, entry);
  entry.sales.push(newSale);
  rememberSaleIndex(branchId, date, newSale.id, saleIndex);
  const stockIndex = getMatchingStockIndex(entry, sale.product, sale.color, sale.shelfSize || '');
  const updates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'sales', saleIndex)]: newSale,
  };
  if (stockIndex !== -1) {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[stockIndex].id, stockIndex);
    entry.stock[stockIndex].quantity = Math.max(0, entry.stock[stockIndex].quantity - sale.quantity);
    updates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[stockIndex];
  }
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before add sale recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, updates);
  cachedBranches = branches;
  updateProductChildren(updates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'add-sale', 'add sale'));
  return branches;
}

export function updateSale(branchId: string, date: string, saleId: string, updates: Partial<SalesEntry>): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;
  const saleIdx = entry.sales.findIndex(s => s.id === saleId);
  if (saleIdx === -1) return branches;
  const beforeStock = entry.stock.map(item => ({ ...item }));
  const oldSale = entry.sales[saleIdx];
  const oldStockIndex = getMatchingStockIndex(entry, oldSale.product, oldSale.color, oldSale.shelfSize || '');
  if (oldStockIndex !== -1) entry.stock[oldStockIndex].quantity += oldSale.quantity;
  const updatedSale = { ...oldSale, ...updates };
  assertNonNegativeQuantity(updatedSale.quantity, 'sale quantity');
  updatedSale.collection = updatedSale.price - updatedSale.driverCharge;
  entry.sales[saleIdx] = updatedSale;
  const newStockIndex = getMatchingStockIndex(entry, updatedSale.product, updatedSale.color, updatedSale.shelfSize || '');
  if (newStockIndex !== -1) entry.stock[newStockIndex].quantity = Math.max(0, entry.stock[newStockIndex].quantity - updatedSale.quantity);
  const firebaseSaleIndex = getFirebaseSaleIndex(branchId, date, saleId, saleIdx);
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'sales', firebaseSaleIndex)]: updatedSale,
  };
  if (oldStockIndex !== -1) {
    const firebaseOldStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[oldStockIndex].id, oldStockIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseOldStockIndex)] = entry.stock[oldStockIndex];
  }
  if (newStockIndex !== -1) {
    const firebaseNewStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[newStockIndex].id, newStockIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseNewStockIndex)] = entry.stock[newStockIndex];
  }
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before edit sale recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;
  updateProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'edit-sale', 'edit sale'));
  return branches;
}

export function deleteSale(branchId: string, date: string, saleId: string): Branch[] {
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  if (!branch) return branches;
  const entryIndex = getDateEntryIndex(branch, date);
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  if (!entry) return branches;
  const saleIndex = entry.sales.findIndex(s => s.id === saleId);
  const sale = entry.sales[saleIndex];
  if (!sale) return branches;
  const beforeStock = entry.stock.map(item => ({ ...item }));
  const stockIndex = getMatchingStockIndex(entry, sale.product, sale.color, sale.shelfSize || '');
  if (stockIndex !== -1) entry.stock[stockIndex].quantity += sale.quantity;
  entry.sales = entry.sales.filter(s => s.id !== saleId);
  const firebaseUpdates: Record<string, unknown> = {};
  if (stockIndex !== -1) {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, entry.stock[stockIndex].id, stockIndex);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[stockIndex];
  }
  const firebaseSaleIndex = getFirebaseSaleIndex(branchId, date, saleId, saleIndex);
  firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'sales', firebaseSaleIndex)] = {
    ...sale,
    deleted: true,
    deletedAt: new Date().toISOString(),
  };
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before delete sale recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;
  if (Object.keys(firebaseUpdates).length > 0) updateProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'delete-sale', 'soft delete sale'));
  return branches;
}

export function transferStock(
  fromBranchId: string, toBranchId: string, date: string,
  product: string, color: string, shelfSize: string, quantity: number
): Branch[] {
  assertNonNegativeQuantity(quantity, 'transfer quantity');
  const branches = structuredClone(cachedBranches);
  const fromBranchIndex = getBranchIndex(branches, fromBranchId);
  const firebaseFromBranchIndex = getFirebaseBranchIndex(branches, fromBranchId);
  const fromBranch = branches[fromBranchIndex];
  assertValidBranch(fromBranch, fromBranchId);
  const fromEntryIndex = fromBranch ? getDateEntryIndex(fromBranch, date) : -1;
  const firebaseFromEntryIndex = getFirebaseDateEntryIndex(fromBranchId, date, fromEntryIndex);
  const fromEntry = fromBranch?.dateEntries[fromEntryIndex];
  const fromStockIndex = fromEntry ? getMatchingStockIndex(fromEntry, product, color, shelfSize) : -1;
  const fromItem = fromEntry && fromStockIndex !== -1 ? fromEntry.stock[fromStockIndex] : null;
  if (!fromItem || fromItem.quantity < quantity) return cachedBranches;
  const toBranchIndex = getBranchIndex(branches, toBranchId);
  const firebaseToBranchIndex = getFirebaseBranchIndex(branches, toBranchId);
  const toBranch = branches[toBranchIndex];
  assertValidBranch(toBranch, toBranchId);
  if (!toBranch) return cachedBranches;
  const fromBeforeStock = fromEntry.stock.map(item => ({ ...item }));
  fromItem.quantity -= quantity;

  let toEntryIndex = getDateEntryIndex(toBranch, date);
  let toEntry = toBranch.dateEntries[toEntryIndex];
  let firebaseToEntryIndex = getFirebaseDateEntryIndex(toBranchId, date, toEntryIndex);
  if (!toEntry) {
    toEntryIndex = toBranch.dateEntries.length;
    firebaseToEntryIndex = getNextDateEntryIndex(toBranchId, toBranch);
    toEntry = { date, stock: [], sales: [] };
    toBranch.dateEntries.push(toEntry);
    rememberDateEntryIndex(toBranchId, date, firebaseToEntryIndex);
  }
  const toBeforeStock = toEntry.stock.map(item => ({ ...item }));
  const toStockIndex = getMatchingStockIndex(toEntry, product, color, shelfSize);
  const firebaseFromStockIndex = getFirebaseStockIndex(fromBranchId, date, fromItem.id, fromStockIndex);
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseFromBranchIndex, 'dateEntries', firebaseFromEntryIndex, 'stock', firebaseFromStockIndex)]: fromItem,
  };
  if (toStockIndex !== -1) {
    const firebaseToStockIndex = getFirebaseStockIndex(toBranchId, date, toEntry.stock[toStockIndex].id, toStockIndex);
    toEntry.stock[toStockIndex].quantity += quantity;
    firebaseUpdates[productPath(firebaseToBranchIndex, 'dateEntries', firebaseToEntryIndex, 'stock', firebaseToStockIndex)] = toEntry.stock[toStockIndex];
  } else {
    const newStockIndex = getNextStockIndex(toBranchId, date, toEntry);
    const newStock = { id: crypto.randomUUID(), category: product, shelfSize, color, quantity };
    toEntry.stock.push(newStock);
    rememberStockIndex(toBranchId, date, newStock.id, newStockIndex);
    firebaseUpdates[productPath(firebaseToBranchIndex, 'dateEntries', firebaseToEntryIndex)] = toEntry;
  }
  backupBranchBeforeRecalculation(firebaseFromBranchIndex, fromBranch, 'before outgoing transfer recalculation');
  backupBranchBeforeRecalculation(firebaseToBranchIndex, toBranch, 'before incoming transfer recalculation');
  recalculateFutureDateEntries(branches, fromBranch, fromBranchId, date, fromEntry.stock, firebaseUpdates);
  recalculateFutureDateEntries(branches, toBranch, toBranchId, date, toEntry.stock, firebaseUpdates);
  cachedBranches = branches;
  updateProductChildren(firebaseUpdates, {
    reason: 'transfer stock',
    branch: `${fromBranch.name} -> ${toBranch.name}`,
    date,
    oldStock: stockAuditSnapshot([...fromBeforeStock, ...toBeforeStock]),
    newStock: stockAuditSnapshot([...fromEntry.stock, ...toEntry.stock]),
    approvedStockAction: true,
    stockChangeReason: 'transfer-stock',
  });
  return branches;
}

export function externalTransfer(
  branchId: string, date: string,
  product: string, color: string, shelfSize: string, quantity: number
): Branch[] {
  assertNonNegativeQuantity(quantity, 'external transfer quantity');
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  const entryIndex = branch ? getDateEntryIndex(branch, date) : -1;
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch?.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  const stockIndex = entry ? getMatchingStockIndex(entry, product, color, shelfSize) : -1;
  const item = entry && stockIndex !== -1 ? entry.stock[stockIndex] : null;
  if (!item || item.quantity < quantity) return cachedBranches;
  const beforeStock = entry.stock.map(stockItem => ({ ...stockItem }));
  item.quantity -= quantity;
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', getFirebaseStockIndex(branchId, date, item.id, stockIndex))]: item,
  };
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before external transfer recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;
  updateProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'external-transfer', 'external transfer'));
  return branches;
}

export async function transferStockAndRefetch(
  fromBranchId: string, toBranchId: string, date: string,
  product: string, color: string, shelfSize: string, quantity: number
): Promise<Branch[]> {
  assertNonNegativeQuantity(quantity, 'transfer quantity');
  const branches = structuredClone(cachedBranches);
  const fromBranchIndex = getBranchIndex(branches, fromBranchId);
  const firebaseFromBranchIndex = getFirebaseBranchIndex(branches, fromBranchId);
  const fromBranch = branches[fromBranchIndex];
  assertValidBranch(fromBranch, fromBranchId);
  const fromEntryIndex = fromBranch ? getDateEntryIndex(fromBranch, date) : -1;
  const firebaseFromEntryIndex = getFirebaseDateEntryIndex(fromBranchId, date, fromEntryIndex);
  const fromEntry = fromBranch?.dateEntries[fromEntryIndex];
  const fromStockIndex = fromEntry ? getMatchingStockIndex(fromEntry, product, color, shelfSize) : -1;
  const fromItem = fromEntry && fromStockIndex !== -1 ? fromEntry.stock[fromStockIndex] : null;
  if (!fromItem || fromItem.quantity < quantity) return refetchProductsFromFirebase('transfer stock source unavailable');
  const toBranchIndex = getBranchIndex(branches, toBranchId);
  const firebaseToBranchIndex = getFirebaseBranchIndex(branches, toBranchId);
  const toBranch = branches[toBranchIndex];
  assertValidBranch(toBranch, toBranchId);
  if (!toBranch) return refetchProductsFromFirebase('transfer stock destination unavailable');
  const fromBeforeStock = fromEntry.stock.map(item => ({ ...item }));
  fromItem.quantity -= quantity;

  let toEntryIndex = getDateEntryIndex(toBranch, date);
  let toEntry = toBranch.dateEntries[toEntryIndex];
  let firebaseToEntryIndex = getFirebaseDateEntryIndex(toBranchId, date, toEntryIndex);
  if (!toEntry) {
    toEntryIndex = toBranch.dateEntries.length;
    firebaseToEntryIndex = getNextDateEntryIndex(toBranchId, toBranch);
    toEntry = { date, stock: [], sales: [] };
    toBranch.dateEntries.push(toEntry);
  }
  const toBeforeStock = toEntry.stock.map(item => ({ ...item }));
  const toStockIndex = getMatchingStockIndex(toEntry, product, color, shelfSize);
  const firebaseFromStockIndex = getFirebaseStockIndex(fromBranchId, date, fromItem.id, fromStockIndex);
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseFromBranchIndex, 'dateEntries', firebaseFromEntryIndex, 'stock', firebaseFromStockIndex)]: fromItem,
  };
  if (toStockIndex !== -1) {
    const firebaseToStockIndex = getFirebaseStockIndex(toBranchId, date, toEntry.stock[toStockIndex].id, toStockIndex);
    toEntry.stock[toStockIndex].quantity += quantity;
    firebaseUpdates[productPath(firebaseToBranchIndex, 'dateEntries', firebaseToEntryIndex, 'stock', firebaseToStockIndex)] = toEntry.stock[toStockIndex];
  } else {
    const newStockIndex = getNextStockIndex(toBranchId, date, toEntry);
    const newStock = { id: crypto.randomUUID(), category: product, shelfSize, color, quantity };
    toEntry.stock.push(newStock);
    firebaseUpdates[productPath(firebaseToBranchIndex, 'dateEntries', firebaseToEntryIndex, 'stock', newStockIndex)] = newStock;
    if (toEntry.stock.length === 1) {
      firebaseUpdates[productPath(firebaseToBranchIndex, 'dateEntries', firebaseToEntryIndex, 'date')] = toEntry.date;
      firebaseUpdates[productPath(firebaseToBranchIndex, 'dateEntries', firebaseToEntryIndex, 'sales')] = toEntry.sales;
    }
  }
  backupBranchBeforeRecalculation(firebaseFromBranchIndex, fromBranch, 'before outgoing transfer recalculation');
  backupBranchBeforeRecalculation(firebaseToBranchIndex, toBranch, 'before incoming transfer recalculation');
  recalculateFutureDateEntries(branches, fromBranch, fromBranchId, date, fromEntry.stock, firebaseUpdates);
  recalculateFutureDateEntries(branches, toBranch, toBranchId, date, toEntry.stock, firebaseUpdates);
  await writeProductChildren(firebaseUpdates, {
    reason: 'transfer stock',
    branch: `${fromBranch.name} -> ${toBranch.name}`,
    date,
    oldStock: stockAuditSnapshot([...fromBeforeStock, ...toBeforeStock]),
    newStock: stockAuditSnapshot([...fromEntry.stock, ...toEntry.stock]),
    approvedStockAction: true,
    stockChangeReason: 'transfer-stock',
  });
  return refetchProductsFromFirebase('transfer stock saved');
}

export async function externalTransferAndRefetch(
  branchId: string, date: string,
  product: string, color: string, shelfSize: string, quantity: number
): Promise<Branch[]> {
  assertNonNegativeQuantity(quantity, 'external transfer quantity');
  const branches = structuredClone(cachedBranches);
  const branchIndex = getBranchIndex(branches, branchId);
  const firebaseBranchIndex = getFirebaseBranchIndex(branches, branchId);
  const branch = branches[branchIndex];
  assertValidBranch(branch, branchId);
  const entryIndex = branch ? getDateEntryIndex(branch, date) : -1;
  const firebaseEntryIndex = getFirebaseDateEntryIndex(branchId, date, entryIndex);
  const entry = branch?.dateEntries[entryIndex];
  assertValidDateEntry(entry, date);
  const stockIndex = entry ? getMatchingStockIndex(entry, product, color, shelfSize) : -1;
  const item = entry && stockIndex !== -1 ? entry.stock[stockIndex] : null;
  if (!item || item.quantity < quantity) return refetchProductsFromFirebase('external transfer source unavailable');
  const beforeStock = entry.stock.map(stockItem => ({ ...stockItem }));
  item.quantity -= quantity;
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', getFirebaseStockIndex(branchId, date, item.id, stockIndex))]: item,
  };
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before external transfer recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  await writeProductChildren(firebaseUpdates, stockWriteAudit(branch, date, beforeStock, entry.stock, 'external-transfer', 'external transfer'));
  return refetchProductsFromFirebase('external transfer saved');
}

// History logging
export function logProductionReceive(record: Omit<ProductionRecord, 'id'>) {
  const newRef = push(ref(db, PRODUCTION_HISTORY_PATH));
  return safeSetPath(`${PRODUCTION_HISTORY_PATH}/${newRef.key}`, { ...record, id: newRef.key }, { action: 'set', entity: 'production-history' });
}

export function logTransfer(record: Omit<TransferRecord, 'id'>) {
  const newRef = push(ref(db, TRANSFER_HISTORY_PATH));
  return safeSetPath(`${TRANSFER_HISTORY_PATH}/${newRef.key}`, { ...record, id: newRef.key }, { action: 'set', entity: 'transfer-history' });
}

export function updateTransferRecord(id: string, updates: Partial<TransferRecord>) {
  const childUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
    acc[`${TRANSFER_HISTORY_PATH}/${id}/${key}`] = value;
    return acc;
  }, {} as Record<string, unknown>);
  safeUpdatePaths(childUpdates, { action: 'update', entity: 'transfer-history' })
    .catch(err => console.error('Failed to update transfer record:', err));
}

export function deleteTransferRecord(id: string) {
  safeSoftDeletePath(`${TRANSFER_HISTORY_PATH}/${id}`, { entity: 'transfer-history', reason: 'transfer history soft delete' })
    .catch(err => console.error('Failed to delete transfer record:', err));
}

export function updateProductionRecord(id: string, updates: Partial<ProductionRecord>) {
  const childUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
    acc[`${PRODUCTION_HISTORY_PATH}/${id}/${key}`] = value;
    return acc;
  }, {} as Record<string, unknown>);
  safeUpdatePaths(childUpdates, { action: 'update', entity: 'production-history' })
    .catch(err => console.error('Failed to update production record:', err));
}

export function deleteProductionRecord(id: string) {
  safeSoftDeletePath(`${PRODUCTION_HISTORY_PATH}/${id}`, { entity: 'production-history', reason: 'production history soft delete' })
    .catch(err => console.error('Failed to delete production record:', err));
}

// Aggregation helpers
export function getAllSales(branches: Branch[]): (SalesEntry & { branchName: string })[] {
  const sales: (SalesEntry & { branchName: string })[] = [];
  for (const branch of branches) {
    for (const entry of branch.dateEntries) {
      for (const sale of entry.sales) {
        sales.push({ ...sale, date: sale.date || entry.date, branchName: branch.name });
      }
    }
  }
  return sales;
}

export type StockAuditResult = {
  branchId: string;
  branchName: string;
  date: string;
  status: 'ok' | 'mismatch' | 'manual-base' | 'initial-base';
  expectedStock: number;
  storedStock: number;
  mismatchCount: number;
  reason: string;
};

export function getStockAuditRows(branch: Branch): StockAuditResult[] {
  const entries = structuredClone(branch.dateEntries).sort((a, b) => a.date.localeCompare(b.date));
  const rows: StockAuditResult[] = [];
  let expectedPreviousClosingStock: StockItem[] | null = null;

  for (const entry of entries) {
    const storedStock = entry.stock;
    if (!expectedPreviousClosingStock) {
      rows.push({
        branchId: branch.id,
        branchName: branch.name,
        date: entry.date,
        status: 'initial-base',
        expectedStock: totalStockQuantity(storedStock),
        storedStock: totalStockQuantity(storedStock),
        mismatchCount: 0,
        reason: 'First date is treated as stored source of truth',
      });
      expectedPreviousClosingStock = storedStock.map(item => ({ ...item }));
      continue;
    }

    if (isManualStockAnchor(entry)) {
      rows.push({
        branchId: branch.id,
        branchName: branch.name,
        date: entry.date,
        status: 'manual-base',
        expectedStock: totalStockQuantity(storedStock),
        storedStock: totalStockQuantity(storedStock),
        mismatchCount: 0,
        reason: 'Manual stock edit is source of truth',
      });
      expectedPreviousClosingStock = storedStock.map(item => ({ ...item }));
      continue;
    }

    const expectedStock = cloneClosingStockWithSalesApplied(expectedPreviousClosingStock, entry);
    const mismatches = stockMismatchCount(expectedStock, storedStock);
    const status = mismatches > 0 ? 'mismatch' : 'ok';
    rows.push({
      branchId: branch.id,
      branchName: branch.name,
      date: entry.date,
      status,
      expectedStock: totalStockQuantity(expectedStock),
      storedStock: totalStockQuantity(storedStock),
      mismatchCount: mismatches,
      reason: status === 'ok' ? 'Stored stock matches calculated closing stock' : 'Stored stock differs from expected closing stock',
    });
    expectedPreviousClosingStock = expectedStock;
  }

  return rows;
}

export function getRecalculatedDateEntries(branch: Branch): DateEntry[] {
  const entries = structuredClone(branch.dateEntries).sort((a, b) => a.date.localeCompare(b.date));
  if (entries.length === 0) return [];

  const shouldAuditBranch = branch.name.toUpperCase().includes('JP');
  for (const entry of entries) {
    const rawSnapshotStock = totalStockQuantity(entry.stock);
    const shouldLogEntry = shouldAuditBranch || rawSnapshotStock <= 5;
    if (shouldLogEntry) {
      console.log('[Stock ledger read audit]', {
        branchId: branch.id,
        branchName: branch.name,
        date: entry.date,
        rawFirebaseStock: rawSnapshotStock,
        salesQuantity: totalSalesQuantity(entry),
        closingStock: rawSnapshotStock,
        recalculatedStock: rawSnapshotStock,
        mode: 'stored-closing-snapshot',
        nonZeroStockRows: nonZeroStockRows(entry.stock),
      });
    }
  }

  return entries;
}

export function getLatestDateEntry(branch: Branch): DateEntry | null {
  const dateEntries = getRecalculatedDateEntries(branch);
  if (dateEntries.length === 0) return null;
  return dateEntries.reduce((latest, entry) =>
    entry.date > latest.date ? entry : latest
  );
}

export function getOverallStock(branches: Branch[]): Map<string, Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, Map<string, number>>>();
  for (const branch of branches) {
    const latestEntry = getLatestDateEntry(branch);
    if (!latestEntry) continue;
    for (const item of latestEntry.stock) {
      if (!result.has(item.category)) result.set(item.category, new Map());
      const catMap = result.get(item.category)!;
      const key = item.shelfSize || 'all';
      if (!catMap.has(key)) catMap.set(key, new Map());
      const sizeMap = catMap.get(key)!;
      sizeMap.set(item.color, (sizeMap.get(item.color) || 0) + item.quantity);
    }
  }
  return result;
}

export function getBranchTotalStock(branch: Branch): number {
  const latestEntry = getLatestDateEntry(branch);
  if (!latestEntry) return 0;
  let total = 0;
  for (const item of latestEntry.stock) total += item.quantity;
  return total;
}

export function getBranchTotalSales(branch: Branch): number {
  let total = 0;
  for (const entry of branch.dateEntries) total += entry.sales.length;
  return total;
}
