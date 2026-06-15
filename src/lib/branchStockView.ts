import { getRecalculatedDateEntries } from './store';
import { Branch } from './types';

export type BranchStockViewRow = {
  id: string;
  product: string;
  color: string;
  size: string;
  currentStock: number;
};

export type BranchStockSnapshot = {
  date: string;
  rows: BranchStockViewRow[];
  totalStock: number;
};

export function getBranchStockSnapshot(branch: Branch, todayKey: string): BranchStockSnapshot | null {
  const entries = getRecalculatedDateEntries(branch);
  if (entries.length === 0) return null;

  const todayEntry = entries.find(entry => entry.date === todayKey);
  const stockEntry = todayEntry ?? entries.reduce((latest, entry) =>
    entry.date > latest.date ? entry : latest
  );

  const rows = stockEntry.stock
    .map(item => ({
      id: item.id,
      product: item.category,
      color: item.color,
      size: item.shelfSize || '-',
      currentStock: item.quantity,
    }))
    .sort((a, b) =>
      a.product.localeCompare(b.product, 'en-IN', { sensitivity: 'base' })
      || Number(b.size) - Number(a.size)
      || a.size.localeCompare(b.size, 'en-IN', { numeric: true })
      || a.color.localeCompare(b.color, 'en-IN', { sensitivity: 'base' })
    );

  return {
    date: stockEntry.date,
    rows,
    totalStock: rows.reduce((sum, row) => sum + row.currentStock, 0),
  };
}
