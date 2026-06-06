import { Branch, SalesEntry, StockItem, DateEntry, createDefaultStock, ProductionRecord, TransferRecord } from './types';
import { db, PRODUCTS_PATH, PRODUCTION_HISTORY_PATH, TRANSFER_HISTORY_PATH } from './firebase';
import { ref, push } from 'firebase/database';
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

function writeProductChild(pathSegments: (string | number)[], value: unknown) {
  const path = productPath(...pathSegments);
  console.log('[Firebase child write]', { path });
  safeSetPath(path, value, { action: 'set', entity: 'products-child' })
    .then(() => console.log('[Firebase child write result]', { path, result: 'success' }))
    .catch(err => console.error('[Firebase child write result]', { path, result: 'error', error: err }));
}

function updateProductChildren(updates: Record<string, unknown>, reason = 'products child update') {
  const backups = pendingBackupPromises;
  pendingBackupPromises = [];
  const backupBarrier = backups.length > 0 ? Promise.all(backups).then(() => undefined) : Promise.resolve();
  backupBarrier
    .then(() => safeUpdatePaths(updates, { action: 'update', entity: 'products-child', reason }))
    .catch(err => console.error('Firebase backup/write failed:', err));
}

function softDeleteProductChild(pathSegments: (string | number)[], reason = 'products child soft delete') {
  const path = productPath(...pathSegments);
  safeSoftDeletePath(path, { entity: 'products-child', reason })
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

function stockQuantityByKey(stock: StockItem[], key: string): number {
  return stockMap(stock).get(key)?.quantity || 0;
}

function totalStockQuantity(stock: StockItem[]): number {
  return stock.reduce((sum, item) => sum + item.quantity, 0);
}

function totalSalesQuantity(entry: DateEntry): number {
  return entry.sales.reduce((sum, sale) => sum + sale.quantity, 0);
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
      updateProductChildren(migrated.reduce((acc, branch, index) => {
        acc[productPath(index)] = branch;
        return acc;
      }, {} as Record<string, Branch>));
      localStorage.removeItem(STORAGE_KEY);
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
    writeProductChild([getFirebaseBranchIndex(branches, id)], branches[idx]);
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
  const newStock = deduplicateStock(previousEntry
    ? structuredClone(previousEntry.stock)
    : createDefaultStock());
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
  writeProductChild([firebaseBranchIndex, 'dateEntries', entryIndex], newEntry);
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
  assertValidDateEntry(branch.dateEntries[entryIndex], date);
  branch.dateEntries = branch.dateEntries.filter(d => d.date !== date);
  cachedBranches = branches;
  if (entryIndex !== -1) softDeleteProductChild([firebaseBranchIndex, 'dateEntries', firebaseEntryIndex], 'date entry soft delete');
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
  if (idx !== -1) {
    entry.stock[idx] = { ...entry.stock[idx], ...updates };
    assertNonNegativeQuantity(entry.stock[idx].quantity, 'stock quantity');
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, stockId, idx);
    firebaseUpdates[productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex)] = entry.stock[idx];
    backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before stock item recalculation');
    recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  }
  cachedBranches = branches;
  if (Object.keys(firebaseUpdates).length > 0) updateProductChildren(firebaseUpdates, 'stock item update');
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
  updateProductChildren(firebaseUpdates, 'stock item add/receive');
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
  const stockIndex = getStockIndex(entry, stockId);
  entry.stock = entry.stock.filter(s => s.id !== stockId);
  cachedBranches = branches;
  if (stockIndex !== -1) {
    const firebaseStockIndex = getFirebaseStockIndex(branchId, date, stockId, stockIndex);
    softDeleteProductChild([firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', firebaseStockIndex], 'stock item soft delete');
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
  entry.stock = stock;
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex)]: entry,
  };
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before date stock recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;
  updateProductChildren(firebaseUpdates, 'date stock update');
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
  updateProductChildren(updates, 'add sale');
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
  updateProductChildren(firebaseUpdates, 'edit sale');
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
  if (Object.keys(firebaseUpdates).length > 0) updateProductChildren(firebaseUpdates, 'soft delete sale');
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
  updateProductChildren(firebaseUpdates, 'transfer stock');
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
  item.quantity -= quantity;
  const firebaseUpdates: Record<string, unknown> = {
    [productPath(firebaseBranchIndex, 'dateEntries', firebaseEntryIndex, 'stock', getFirebaseStockIndex(branchId, date, item.id, stockIndex))]: item,
  };
  backupBranchBeforeRecalculation(firebaseBranchIndex, branch, 'before external transfer recalculation');
  recalculateFutureDateEntries(branches, branch, branchId, date, entry.stock, firebaseUpdates);
  cachedBranches = branches;
  updateProductChildren(firebaseUpdates, 'external transfer');
  return branches;
}

// History logging
export function logProductionReceive(record: Omit<ProductionRecord, 'id'>) {
  const newRef = push(ref(db, PRODUCTION_HISTORY_PATH));
  safeSetPath(`${PRODUCTION_HISTORY_PATH}/${newRef.key}`, { ...record, id: newRef.key }, { action: 'set', entity: 'production-history' });
}

export function logTransfer(record: Omit<TransferRecord, 'id'>) {
  const newRef = push(ref(db, TRANSFER_HISTORY_PATH));
  safeSetPath(`${TRANSFER_HISTORY_PATH}/${newRef.key}`, { ...record, id: newRef.key }, { action: 'set', entity: 'transfer-history' });
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
