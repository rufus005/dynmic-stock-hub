export interface StockItem {
  id: string;
  category: string;
  shelfSize?: string;
  color: string;
  quantity: number;
  tags?: string[];
}

export interface SalesEntry {
  id: string;
  date: string;
  customerNumber: string;
  driverName: string;
  paymentMode?: 'Cash' | 'UPI' | 'Online';
  product: string;
  color: string;
  shelfSize: string;
  quantity: number;
  price: number;
  driverCharge: number;
  collection: number;
  branchId: string;
}

export interface DateEntry {
  date: string; // YYYY-MM-DD
  stock: StockItem[];
  sales: SalesEntry[];
}

export interface Branch {
  id: string;
  name: string;
  dateEntries: DateEntry[];
}

export interface DynamicCategory {
  id: string;
  name: string;
  shelfSizes: string[];
  colors: string[];
}

export const CATEGORIES = {
  JUMBO: {
    shelfSizes: ['5', '4', '3', '2'],
    colors: ['Coffee-Brown', 'Ivory', 'Coffee-White', 'Grey-White', 'Grey'],
  },
  PREMIUM: {
    shelfSizes: ['5', '4', '3', '2'],
    colors: ['Full-Brown', 'Beige', 'Coffee-White', 'Grey-White'],
  },
  'DOUBLE DECKOR': {
    shelfSizes: ['5', '4', '3', '2'],
    colors: ['Full Brown', 'Coffee Beige', 'Gray-White', 'Beige'],
  },
} as const;

export type CategoryName = keyof typeof CATEGORIES;

export interface ProductionRecord {
  id: string;
  date: string;
  branchId: string;
  branchName: string;
  product: string;
  color: string;
  shelfSize: string;
  quantity: number;
  fromName?: string;
}

export interface TransferRecord {
  id: string;
  date: string;
  type: 'internal' | 'external';
  fromBranchId: string;
  fromBranchName: string;
  toBranchId?: string;
  toBranchName?: string;
  product: string;
  color: string;
  shelfSize: string;
  quantity: number;
  externalName?: string;
}

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  role: 'admin' | 'branch';
  branchId: string | null;
}

export function createDefaultStock(): StockItem[] {
  const stock: StockItem[] = [];
  for (const [category, config] of Object.entries(CATEGORIES)) {
    for (const size of config.shelfSizes) {
      for (const color of config.colors) {
        stock.push({ id: crypto.randomUUID(), category, shelfSize: size, color, quantity: 0 });
      }
    }
  }
  return stock;
}
