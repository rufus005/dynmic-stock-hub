import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { Branch, SalesEntry, StockItem, ProductionRecord, TransferRecord, DynamicCategory, CATEGORIES } from '@/lib/types';
import * as store from '@/lib/store';
import { db, PRODUCTS_PATH, PRODUCTION_HISTORY_PATH, TRANSFER_HISTORY_PATH, CATEGORIES_PATH, TAGS_PATH } from '@/lib/firebase';
import { ref, onValue, set, push, remove } from 'firebase/database';

interface DataContextType {
  branches: Branch[];
  productionHistory: ProductionRecord[];
  transferHistory: TransferRecord[];
  categories: DynamicCategory[];
  availableTags: { id: string; name: string }[];
  addBranch: (name: string) => void;
  updateBranchName: (id: string, name: string) => void;
  removeBranch: (id: string) => void;
  addDateEntry: (branchId: string, date: string, options?: { source?: string }) => void;
  deleteDateEntry: (branchId: string, date: string) => void;
  updateDateStock: (branchId: string, date: string, stock: StockItem[]) => void;
  addStockItem: (branchId: string, date: string, item: Omit<StockItem, 'id'>) => void;
  updateStockItem: (branchId: string, date: string, stockId: string, updates: Partial<StockItem>) => void;
  deleteStockItem: (branchId: string, date: string, stockId: string) => void;
  addSale: (branchId: string, date: string, sale: Omit<SalesEntry, 'id' | 'branchId' | 'collection'>) => void;
  updateSale: (branchId: string, date: string, saleId: string, updates: Partial<SalesEntry>) => void;
  deleteSale: (branchId: string, date: string, saleId: string) => void;
  receiveStock: (branchId: string, date: string, item: Omit<StockItem, 'id'>, fromName?: string) => void;
  transferStock: (fromBranchId: string, toBranchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number) => void;
  externalTransfer: (branchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number, externalName?: string) => void;
  updateTransferRecord: (id: string, updates: Partial<TransferRecord>) => void;
  deleteTransferRecord: (id: string) => void;
  updateProductionRecord: (id: string, updates: Partial<ProductionRecord>) => void;
  deleteProductionRecord: (id: string) => void;
  addCategory: (cat: Omit<DynamicCategory, 'id'>) => void;
  updateCategory: (id: string, updates: Partial<DynamicCategory>) => void;
  deleteCategory: (id: string) => void;
  addTag: (name: string) => void;
  updateTag: (id: string, name: string) => void;
  deleteTag: (id: string) => void;
  refresh: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [productionHistory, setProductionHistory] = useState<ProductionRecord[]>([]);
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>([]);
  const [categories, setCategories] = useState<DynamicCategory[]>([]);
  const [availableTags, setAvailableTags] = useState<{ id: string; name: string }[]>([]);
  const initializedRef = useRef(false);
  const categoriesSeededRef = useRef(false);

  // Real-time Firebase listener for branches
  useEffect(() => {
    const productsRef = ref(db, PRODUCTS_PATH);
    const unsubscribe = onValue(productsRef, (snapshot) => {
      const data = snapshot.val();
      let result: Branch[];
      if (!initializedRef.current) {
        result = store.initCache(data);
        initializedRef.current = true;
      } else {
        result = store.updateCache(data);
      }
      const rawProductsSnapshotCount = Array.isArray(data)
        ? data.filter(Boolean).length
        : data
          ? Object.keys(data).length
          : 0;
      const dateEntriesCount = result.reduce((sum, branch) => sum + branch.dateEntries.length, 0);
      const salesCount = result.reduce(
        (sum, branch) => sum + branch.dateEntries.reduce((entrySum, entry) => entrySum + entry.sales.length, 0),
        0
      );
      console.log('[Firebase products verification]', {
        rawProductsSnapshotCount,
        branchCount: result.length,
        dateEntriesCount,
        salesCount,
      });
      console.log('[Date entry refresh verification]', {
        refetchedEntriesCount: dateEntriesCount,
        updatedStateCount: dateEntriesCount,
      });
      setBranches(result);
    }, (error) => {
      console.error('Firebase read failed:', error);
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener for production history
  useEffect(() => {
    const prodRef = ref(db, PRODUCTION_HISTORY_PATH);
    const unsubscribe = onValue(prodRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setProductionHistory([]); return; }
      const records: ProductionRecord[] = Object.values(data);
      setProductionHistory(records);
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener for transfer history
  useEffect(() => {
    const transRef = ref(db, TRANSFER_HISTORY_PATH);
    const unsubscribe = onValue(transRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setTransferHistory([]); return; }
      const records: TransferRecord[] = Object.values(data);
      setTransferHistory(records);
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener for categories
  useEffect(() => {
    const catRef = ref(db, CATEGORIES_PATH);
    const unsubscribe = onValue(catRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        // Seed from hardcoded CATEGORIES if empty
        if (!categoriesSeededRef.current) {
          categoriesSeededRef.current = true;
          const seedCats: DynamicCategory[] = Object.entries(CATEGORIES).map(([name, config]) => ({
            id: crypto.randomUUID(),
            name,
            shelfSizes: [...config.shelfSizes],
            colors: [...config.colors],
          }));
          set(ref(db, CATEGORIES_PATH), seedCats.reduce((acc, c) => {
            acc[c.id] = c;
            return acc;
          }, {} as Record<string, DynamicCategory>));
          setCategories(seedCats);
        }
        return;
      }
      const cats: DynamicCategory[] = Object.values(data);
      setCategories(cats);
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener for tags
  useEffect(() => {
    const tagsRef = ref(db, TAGS_PATH);
    const unsubscribe = onValue(tagsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setAvailableTags([]); return; }
      const tags: { id: string; name: string }[] = Object.entries(data).map(([id, val]: [string, any]) => ({
        id,
        name: typeof val === 'string' ? val : val.name || '',
      }));
      setAvailableTags(tags);
    });
    return () => unsubscribe();
  }, []);

  const refresh = useCallback(() => setBranches(store.getBranches()), []);

  const addBranch = useCallback((name: string) => setBranches(store.addBranch(name)), []);
  const updateBranchName = useCallback((id: string, name: string) => setBranches(store.updateBranch(id, { name })), []);
  const removeBranch = useCallback((id: string) => setBranches(store.deleteBranch(id)), []);

  const addDateEntry = useCallback((branchId: string, date: string, options?: { source?: string }) => {
    const updatedBranches = store.addDateEntry(branchId, date, options);
    const updatedBranch = updatedBranches.find(branch => branch.id === branchId);
    const updatedStateCount = updatedBranch?.dateEntries.length || 0;
    console.log('[Add date entry state refresh]', {
      selectedDate: date,
      branchId,
      source: options?.source || 'manual',
      updatedStateCount,
    });
    setBranches(updatedBranches);
  }, []);
  const deleteDateEntry = useCallback((branchId: string, date: string) => setBranches(store.deleteDateEntry(branchId, date)), []);

  const updateDateStock = useCallback((branchId: string, date: string, stock: StockItem[]) => setBranches(store.updateDateStock(branchId, date, stock)), []);
  const addStockItemFn = useCallback((branchId: string, date: string, item: Omit<StockItem, 'id'>) => setBranches(store.addStockItem(branchId, date, item)), []);
  const updateStockItemFn = useCallback((branchId: string, date: string, stockId: string, updates: Partial<StockItem>) => setBranches(store.updateStockItem(branchId, date, stockId, updates)), []);
  const deleteStockItemFn = useCallback((branchId: string, date: string, stockId: string) => setBranches(store.deleteStockItem(branchId, date, stockId)), []);

  const addSaleFn = useCallback((branchId: string, date: string, sale: Omit<SalesEntry, 'id' | 'branchId' | 'collection'>) => setBranches(store.addSale(branchId, date, sale)), []);
  const updateSaleFn = useCallback((branchId: string, date: string, saleId: string, updates: Partial<SalesEntry>) => setBranches(store.updateSale(branchId, date, saleId, updates)), []);
  const deleteSaleFn = useCallback((branchId: string, date: string, saleId: string) => setBranches(store.deleteSale(branchId, date, saleId)), []);

  const receiveStockFn = useCallback((branchId: string, date: string, item: Omit<StockItem, 'id'>, fromName?: string) => {
    setBranches(store.addStockItem(branchId, date, item));
    const branch = store.getBranches().find(b => b.id === branchId);
    store.logProductionReceive({
      date,
      branchId,
      branchName: branch?.name || '',
      product: item.category,
      color: item.color,
      shelfSize: item.shelfSize || '',
      quantity: item.quantity,
      fromName: fromName || '',
    });
  }, []);

  const transferStockFn = useCallback((fromBranchId: string, toBranchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number) => {
    setBranches(store.transferStock(fromBranchId, toBranchId, date, product, color, shelfSize, quantity));
    const allBranches = store.getBranches();
    const fromBranch = allBranches.find(b => b.id === fromBranchId);
    const toBranch = allBranches.find(b => b.id === toBranchId);
    store.logTransfer({
      date,
      type: 'internal',
      fromBranchId,
      fromBranchName: fromBranch?.name || '',
      toBranchId,
      toBranchName: toBranch?.name || '',
      product,
      color,
      shelfSize,
      quantity,
    });
  }, []);

  const externalTransferFn = useCallback((branchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number, externalName?: string) => {
    setBranches(store.externalTransfer(branchId, date, product, color, shelfSize, quantity));
    const branch = store.getBranches().find(b => b.id === branchId);
    store.logTransfer({
      date,
      type: 'external',
      fromBranchId: branchId,
      fromBranchName: branch?.name || '',
      product,
      color,
      shelfSize,
      quantity,
      externalName: externalName || '',
    });
  }, []);

  const updateTransferRecordFn = useCallback((id: string, updates: Partial<TransferRecord>) => {
    store.updateTransferRecord(id, updates);
  }, []);

  const deleteTransferRecordFn = useCallback((id: string) => {
    store.deleteTransferRecord(id);
  }, []);

  const updateProductionRecordFn = useCallback((id: string, updates: Partial<ProductionRecord>) => {
    store.updateProductionRecord(id, updates);
  }, []);

  const deleteProductionRecordFn = useCallback((id: string) => {
    store.deleteProductionRecord(id);
  }, []);

  // Categories CRUD
  const addCategoryFn = useCallback((cat: Omit<DynamicCategory, 'id'>) => {
    const id = crypto.randomUUID();
    const newCat = { ...cat, id };
    set(ref(db, `${CATEGORIES_PATH}/${id}`), newCat);
  }, []);

  const updateCategoryFn = useCallback((id: string, updates: Partial<DynamicCategory>) => {
    const catRef = ref(db, `${CATEGORIES_PATH}/${id}`);
    const current = categories.find(c => c.id === id);
    if (current) {
      set(catRef, { ...current, ...updates });
    }
  }, [categories]);

  const deleteCategoryFn = useCallback((id: string) => {
    remove(ref(db, `${CATEGORIES_PATH}/${id}`));
  }, []);

  // Tags CRUD
  const addTagFn = useCallback((name: string) => {
    const newRef = push(ref(db, TAGS_PATH));
    set(newRef, { id: newRef.key, name });
  }, []);

  const updateTagFn = useCallback((id: string, name: string) => {
    set(ref(db, `${TAGS_PATH}/${id}`), { id, name });
  }, []);

  const deleteTagFn = useCallback((id: string) => {
    remove(ref(db, `${TAGS_PATH}/${id}`));
  }, []);

  return (
    <DataContext.Provider
      value={{
        branches,
        productionHistory,
        transferHistory,
        categories,
        availableTags,
        addBranch,
        updateBranchName,
        removeBranch,
        addDateEntry,
        deleteDateEntry,
        updateDateStock,
        addStockItem: addStockItemFn,
        updateStockItem: updateStockItemFn,
        deleteStockItem: deleteStockItemFn,
        addSale: addSaleFn,
        updateSale: updateSaleFn,
        deleteSale: deleteSaleFn,
        receiveStock: receiveStockFn,
        transferStock: transferStockFn,
        externalTransfer: externalTransferFn,
        updateTransferRecord: updateTransferRecordFn,
        deleteTransferRecord: deleteTransferRecordFn,
        updateProductionRecord: updateProductionRecordFn,
        deleteProductionRecord: deleteProductionRecordFn,
        addCategory: addCategoryFn,
        updateCategory: updateCategoryFn,
        deleteCategory: deleteCategoryFn,
        addTag: addTagFn,
        updateTag: updateTagFn,
        deleteTag: deleteTagFn,
        refresh,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used within a DataProvider');
  }
  return ctx;
}
