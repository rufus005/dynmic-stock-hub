import { db, AUDIT_LOGS_PATH, BACKUPS_PATH, PRODUCTS_PATH } from './firebase';
import { ref, set, push, update } from 'firebase/database';

type AuditAction = 'set' | 'update' | 'soft-delete' | 'backup';

type StockAuditRow = {
  category: string;
  shelfSize: string;
  color: string;
  quantity: number;
};

type StockAuditSnapshot = {
  total: number;
  rows: StockAuditRow[];
};

type WriteOptions = {
  action: AuditAction;
  entity: string;
  reason?: string;
  branch?: string;
  date?: string;
  oldStock?: StockAuditSnapshot;
  newStock?: StockAuditSnapshot;
  approvedStockAction?: boolean;
  stockChangeReason?: string;
};

const APPROVED_STOCK_CHANGE_REASONS = new Set([
  'add-sale',
  'edit-sale',
  'delete-sale',
  'receive-production',
  'transfer-stock',
  'external-transfer',
  'manual-stock-edit',
  'manual-date-create',
  'auto-date-carry-forward',
  'local-storage-migration',
]);

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function isProductsRootPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === PRODUCTS_PATH;
}

function isDangerousProductsWritePath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === PRODUCTS_PATH || normalized === `/${PRODUCTS_PATH}`;
}

function assertSafePath(path: string) {
  const normalized = normalizePath(path);
  if (!normalized) throw new Error('Firebase write path is empty');
  if (isDangerousProductsWritePath(normalized)) {
    throw new Error(`Blocked unsafe Firebase write path: ${path}`);
  }
}

function assertSafeMultiPathUpdate(updates: Record<string, unknown>) {
  const paths = Object.keys(updates);
  if (paths.length === 0) throw new Error('Firebase update has no child paths');
  for (const path of paths) assertSafePath(path);
}

function assertNoNegativeStock(value: unknown, context = 'value') {
  if (!value || typeof value !== 'object') return;
  if ('quantity' in value && typeof (value as { quantity?: unknown }).quantity === 'number' && (value as { quantity: number }).quantity < 0) {
    throw new Error(`Blocked negative stock quantity at ${context}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNegativeStock(item, `${context}[${index}]`));
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    assertNoNegativeStock(child, `${context}.${key}`);
  });
}

function hasStockPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasStockPayload);
  if ('stock' in value && Array.isArray((value as { stock?: unknown }).stock)) return true;
  if ('quantity' in value && typeof (value as { quantity?: unknown }).quantity === 'number') return true;
  return Object.values(value as Record<string, unknown>).some(hasStockPayload);
}

function isProductsStockWrite(path: string, value: unknown): boolean {
  const normalized = normalizePath(path);
  if (!normalized.startsWith(`${PRODUCTS_PATH}/`)) return false;
  return /\/dateEntries\/[^/]+\/stock(\/|$)/.test(normalized) || hasStockPayload(value);
}

function normalizeStockRows(snapshot?: StockAuditSnapshot): StockAuditRow[] {
  return [...(snapshot?.rows || [])].sort((a, b) =>
    `${a.category}|${a.shelfSize}|${a.color}`.localeCompare(`${b.category}|${b.shelfSize}|${b.color}`)
  );
}

function isSameStockSnapshot(oldStock?: StockAuditSnapshot, newStock?: StockAuditSnapshot): boolean {
  if (!oldStock || !newStock) return false;
  if (oldStock.total !== newStock.total) return false;
  const oldRows = normalizeStockRows(oldStock);
  const newRows = normalizeStockRows(newStock);
  if (oldRows.length !== newRows.length) return false;
  return oldRows.every((oldRow, index) => {
    const newRow = newRows[index];
    return oldRow.category === newRow.category
      && oldRow.shelfSize === newRow.shelfSize
      && oldRow.color === newRow.color
      && oldRow.quantity === newRow.quantity;
  });
}

function assertApprovedStockWrite(entries: [string, unknown][], options: WriteOptions) {
  const stockPaths = entries
    .filter(([path, value]) => isProductsStockWrite(path, value))
    .map(([path]) => normalizePath(path));
  if (stockPaths.length === 0) return;

  const reason = options.stockChangeReason || options.reason || '';
  if (!options.approvedStockAction || !APPROVED_STOCK_CHANGE_REASONS.has(reason)) {
    throw new Error(`Blocked unapproved automatic stock write: ${stockPaths.join(', ')}`);
  }

  if (!options.oldStock || !options.newStock) {
    throw new Error(`Blocked stock write without old/new audit data: ${stockPaths.join(', ')}`);
  }

  if (reason === 'auto-date-carry-forward' && !isSameStockSnapshot(options.oldStock, options.newStock)) {
    throw new Error(`Blocked automatic date stock change without exact carry-forward: ${stockPaths.join(', ')}`);
  }
}

function auditPayload(options: WriteOptions, paths: string[]) {
  return {
    ...options,
    paths,
    createdAt: new Date().toISOString(),
  };
}

async function writeAuditLog(options: WriteOptions, paths: string[]) {
  const auditRef = push(ref(db, AUDIT_LOGS_PATH));
  await set(auditRef, {
    id: auditRef.key,
    ...auditPayload(options, paths),
  });
}

export async function safeSetPath(path: string, value: unknown, options: WriteOptions) {
  const normalized = normalizePath(path);
  assertSafePath(normalized);
  assertNoNegativeStock(value, normalized);
  assertApprovedStockWrite([[normalized, value]], options);
  await set(ref(db, normalized), value);
  await writeAuditLog(options, [normalized]);
}

export async function safeUpdatePaths(updates: Record<string, unknown>, options: WriteOptions) {
  assertSafeMultiPathUpdate(updates);
  Object.entries(updates).forEach(([path, value]) => assertNoNegativeStock(value, path));
  assertApprovedStockWrite(Object.entries(updates), options);
  await update(ref(db), updates);
  await writeAuditLog(options, Object.keys(updates).map(normalizePath));
}

export async function safeSoftDeletePath(path: string, options: Omit<WriteOptions, 'action'>) {
  const normalized = normalizePath(path);
  assertSafePath(normalized);
  await update(ref(db, normalized), {
    deleted: true,
    deletedAt: new Date().toISOString(),
  });
  await writeAuditLog({ ...options, action: 'soft-delete' }, [normalized]);
}

export async function createFirebaseBackup(path: string, value: unknown, reason: string) {
  const normalized = normalizePath(path);
  if (isProductsRootPath(normalized)) {
    throw new Error('Refusing to backup full /products root; backup a scoped child path');
  }
  const today = new Date().toISOString().slice(0, 10);
  const backupRef = push(ref(db, `${BACKUPS_PATH}/${today}`));
  const backupValue = {
    id: backupRef.key,
    sourcePath: normalized,
    reason,
    createdAt: new Date().toISOString(),
    data: value,
  };
  await set(backupRef, backupValue);
  await writeAuditLog({ action: 'backup', entity: 'backup', reason }, [`${BACKUPS_PATH}/${today}/${backupRef.key}`]);
}

export function assertValidBranch(branch: unknown, branchId: string) {
  if (!branch) throw new Error(`Invalid branch: ${branchId}`);
}

export function assertValidDateEntry(entry: unknown, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  if (!entry) throw new Error(`Invalid date entry: ${date}`);
}

export function assertNonNegativeQuantity(quantity: number, label: string) {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`Invalid ${label}: ${quantity}`);
  }
}
