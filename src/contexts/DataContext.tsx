import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { Branch, SalesEntry, StockItem, ProductionRecord, TransferRecord, DynamicCategory, CATEGORIES } from '@/lib/types';
import * as store from '@/lib/store';
import { db, PRODUCTS_PATH, PRODUCTION_HISTORY_PATH, TRANSFER_HISTORY_PATH, CATEGORIES_PATH, TAGS_PATH, PRODUCT_PRICING_PATH, DAILY_EMAIL_REPORT_SETTINGS_PATH } from '@/lib/firebase';
import { ref, onValue, push } from 'firebase/database';
import { safeSetPath, safeSoftDeletePath, safeUpdatePaths } from '@/lib/firebaseProtection';
import { ProductPricing, createSeedPricing, createSalePurchasePriceSnapshot } from '@/lib/pricing';

interface DataContextType {
  branches: Branch[];
  productionHistory: ProductionRecord[];
  transferHistory: TransferRecord[];
  categories: DynamicCategory[];
  availableTags: { id: string; name: string }[];
  productPricing: ProductPricing[];
  dailyEmailRecipients: string[];
  updateDailyEmailRecipients: (recipients: string[]) => Promise<void>;
  addBranch: (name: string) => void;
  updateBranchName: (id: string, name: string) => void;
  removeBranch: (id: string) => void;
  addDateEntry: (branchId: string, date: string, options?: { source?: string }) => void;
  deleteDateEntry: (branchId: string, date: string) => void;
  updateDateStock: (branchId: string, date: string, stock: StockItem[]) => Promise<Branch[]>;
  acceptStoredStockAsCorrect: (branchId: string, date: string) => Branch[];
  addStockItem: (branchId: string, date: string, item: Omit<StockItem, 'id'>) => Promise<Branch[]>;
  updateStockItem: (branchId: string, date: string, stockId: string, updates: Partial<StockItem>) => void;
  deleteStockItem: (branchId: string, date: string, stockId: string) => void;
  addSale: (branchId: string, date: string, sale: Omit<SalesEntry, 'id' | 'branchId' | 'collection'>) => Promise<Branch[]>;
  updateSale: (branchId: string, date: string, saleId: string, updates: Partial<SalesEntry>) => Promise<Branch[]>;
  deleteSale: (branchId: string, date: string, saleId: string) => Promise<Branch[]>;
  receiveStock: (branchId: string, date: string, item: Omit<StockItem, 'id'>, fromName?: string) => Promise<Branch[]>;
  transferStock: (fromBranchId: string, toBranchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number) => Promise<Branch[]>;
  externalTransfer: (branchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number, externalName?: string) => Promise<Branch[]>;
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
  addProductPricing: (price: Omit<ProductPricing, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>) => void;
  updateProductPricing: (id: string, updates: Partial<Pick<ProductPricing, 'product' | 'color' | 'size' | 'purchasePrice' | 'isActive'>>) => void;
  disableProductPricing: (id: string) => void;
  refresh: () => Promise<void>;
}

function isVisibleSnapshotValue(value: unknown): boolean {
  if (!value) return false;
  if (typeof value !== 'object') return true;
  return (value as { deleted?: boolean }).deleted !== true;
}

function sortProductPricing(a: ProductPricing, b: ProductPricing): number {
  const aNumber = Number(a.id);
  const bNumber = Number(b.id);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
  return a.product.localeCompare(b.product) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size) || a.id.localeCompare(b.id);
}

const DataContext = createContext<DataContextType | null>(null);

const DEFAULT_DAILY_EMAIL_RECIPIENTS = ['rufus090420@gmail.com'];

export function DataProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [productionHistory, setProductionHistory] = useState<ProductionRecord[]>([]);
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>([]);
  const [categories, setCategories] = useState<DynamicCategory[]>([]);
  const [availableTags, setAvailableTags] = useState<{ id: string; name: string }[]>([]);
  const [productPricing, setProductPricing] = useState<ProductPricing[]>([]);
  const [dailyEmailRecipients, setDailyEmailRecipients] = useState<string[]>(DEFAULT_DAILY_EMAIL_RECIPIENTS);
  const initializedRef = useRef(false);
  const categoriesSeededRef = useRef(false);
  const pricingSeededRef = useRef(false);

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
      const manualStockEditCount = result.reduce(
        (sum, branch) => sum + branch.dateEntries.filter(entry => Boolean(entry.manualStockEditedAt)).length,
        0
      );
      console.log('[Firebase products verification - refetch results]', {
        rawProductsSnapshotCount,
        branchCount: result.length,
        dateEntriesCount,
        salesCount,
        manualStockEditCount,
        branches: result.map(b => ({ id: b.id, name: b.name, dateEntriesWithManualEdit: b.dateEntries.filter(e => e.manualStockEditedAt).map(e => ({ date: e.date, editedAt: e.manualStockEditedAt, reason: e.manualStockEditReason, stock: e.stock.length })) })),
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

  // Real-time listener for dynamic product pricing. Seeds once only when /product_pricing is absent.
  useEffect(() => {
    const pricingRef = ref(db, PRODUCT_PRICING_PATH);
    const unsubscribe = onValue(pricingRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        if (!pricingSeededRef.current) {
          pricingSeededRef.current = true;
          const seedPrices = createSeedPricing();
          safeUpdatePaths(
            seedPrices.reduce((acc, price) => {
              acc[`${PRODUCT_PRICING_PATH}/${price.id}`] = price;
              return acc;
            }, {} as Record<string, ProductPricing>),
            { action: 'update', entity: 'product_pricing', reason: 'seed default product pricing' }
          );
          setProductPricing(seedPrices);
        }
        return;
      }
      const prices = Object.values(data as Record<string, unknown>) as ProductPricing[];
      setProductPricing(prices.sort(sortProductPricing));
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener for production history
  useEffect(() => {
    const prodRef = ref(db, PRODUCTION_HISTORY_PATH);
    const unsubscribe = onValue(prodRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) { setProductionHistory([]); return; }
      const records = Object.values(data as Record<string, unknown>)
        .filter(isVisibleSnapshotValue) as ProductionRecord[];
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
      const records = Object.values(data as Record<string, unknown>)
        .filter(isVisibleSnapshotValue) as TransferRecord[];
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
          safeUpdatePaths(
            seedCats.reduce((acc, c) => {
              acc[`${CATEGORIES_PATH}/${c.id}`] = c;
              return acc;
            }, {} as Record<string, DynamicCategory>),
            { action: 'update', entity: 'categories', reason: 'seed default categories' }
          );
          setCategories(seedCats);
        }
        return;
      }
      const cats = Object.values(data as Record<string, unknown>)
        .filter(isVisibleSnapshotValue) as DynamicCategory[];
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
      const tags: { id: string; name: string }[] = Object.entries(data as Record<string, unknown>)
        .filter(([, val]) => isVisibleSnapshotValue(val))
        .map(([id, val]) => ({
          id,
          name: typeof val === 'string' ? val : String((val as { name?: unknown }).name || ''),
        }));
      setAvailableTags(tags);
    });
    return () => unsubscribe();
  }, []);

  // Real-time listener for daily email report settings. The Resend API key is never stored here.
  useEffect(() => {
    const settingsRef = ref(db, DAILY_EMAIL_REPORT_SETTINGS_PATH);
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      const data = snapshot.val();
      const recipients = Array.isArray(data?.recipients)
        ? data.recipients.filter((email: unknown): email is string => typeof email === 'string' && email.includes('@'))
        : DEFAULT_DAILY_EMAIL_RECIPIENTS;
      setDailyEmailRecipients(recipients.length > 0 ? recipients : DEFAULT_DAILY_EMAIL_RECIPIENTS);
    });
    return () => unsubscribe();
  }, []);

  const updateDailyEmailRecipients = useCallback(async (recipients: string[]) => {
    const cleanedRecipients = Array.from(new Set(recipients.map(email => email.trim()).filter(Boolean)));
    await safeSetPath(
      DAILY_EMAIL_REPORT_SETTINGS_PATH,
      {
        recipients: cleanedRecipients.length > 0 ? cleanedRecipients : DEFAULT_DAILY_EMAIL_RECIPIENTS,
        updatedAt: new Date().toISOString(),
      },
      { action: 'set', entity: 'admin-settings', reason: 'update daily email report recipients' }
    );
  }, []);

  const refresh = useCallback(async () => {
    const firebaseBranches = await store.refetchProductsFromFirebase('manual refresh');
    setBranches(firebaseBranches);
  }, []);

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

  const updateDateStock = useCallback((branchId: string, date: string, stock: StockItem[]) => {
    return store.updateDateStockAndRefetch(branchId, date, stock).then(updatedBranches => {
      setBranches(updatedBranches);
      return updatedBranches;
    });
  }, []);
  const acceptStoredStockAsCorrect = useCallback((branchId: string, date: string) => {
    const updatedBranches = store.acceptStoredStockAsCorrect(branchId, date);
    setBranches(updatedBranches);
    return updatedBranches;
  }, []);
  const addStockItemFn = useCallback((branchId: string, date: string, item: Omit<StockItem, 'id'>) => {
    return store.addStockItemAndRefetch(branchId, date, item).then(updatedBranches => {
      setBranches(updatedBranches);
      return updatedBranches;
    });
  }, []);
  const updateStockItemFn = useCallback((branchId: string, date: string, stockId: string, updates: Partial<StockItem>) => setBranches(store.updateStockItem(branchId, date, stockId, updates)), []);
  const deleteStockItemFn = useCallback((branchId: string, date: string, stockId: string) => setBranches(store.deleteStockItem(branchId, date, stockId)), []);

  const addSaleFn = useCallback((branchId: string, date: string, sale: Omit<SalesEntry, 'id' | 'branchId' | 'collection'>) => {
    // Snapshot current purchase price at sale time so future pricing edits do not change old sale profit.
    const pricingForSnapshot = productPricing.length > 0 ? productPricing : undefined;
    const saleWithPriceSnapshot = {
      ...sale,
      ...createSalePurchasePriceSnapshot(sale, pricingForSnapshot),
    };
    return store.addSaleAndRefetch(branchId, date, saleWithPriceSnapshot).then(updatedBranches => {
      setBranches(updatedBranches);
      return updatedBranches;
    });
  }, [productPricing]);
  const updateSaleFn = useCallback((branchId: string, date: string, saleId: string, updates: Partial<SalesEntry>) => {
    return store.updateSaleAndRefetch(branchId, date, saleId, updates).then(updatedBranches => {
      setBranches(updatedBranches);
      return updatedBranches;
    });
  }, []);
  const deleteSaleFn = useCallback((branchId: string, date: string, saleId: string) => {
    return store.deleteSaleAndRefetch(branchId, date, saleId).then(updatedBranches => {
      setBranches(updatedBranches);
      return updatedBranches;
    });
  }, []);

  const receiveStockFn = useCallback(async (branchId: string, date: string, item: Omit<StockItem, 'id'>, fromName?: string) => {
    const updatedBranches = await store.addStockItemAndRefetch(branchId, date, item);
    const branch = updatedBranches.find(b => b.id === branchId);
    await store.logProductionReceive({
      date,
      branchId,
      branchName: branch?.name || '',
      product: item.category,
      color: item.color,
      shelfSize: item.shelfSize || '',
      quantity: item.quantity,
      fromName: fromName || '',
    });
    setBranches(updatedBranches);
    return updatedBranches;
  }, []);

  const transferStockFn = useCallback(async (fromBranchId: string, toBranchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number) => {
    const updatedBranches = await store.transferStockAndRefetch(fromBranchId, toBranchId, date, product, color, shelfSize, quantity);
    const fromBranch = updatedBranches.find(b => b.id === fromBranchId);
    const toBranch = updatedBranches.find(b => b.id === toBranchId);
    await store.logTransfer({
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
    setBranches(updatedBranches);
    return updatedBranches;
  }, []);

  const externalTransferFn = useCallback(async (branchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number, externalName?: string) => {
    const updatedBranches = await store.externalTransferAndRefetch(branchId, date, product, color, shelfSize, quantity);
    const branch = updatedBranches.find(b => b.id === branchId);
    await store.logTransfer({
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
    setBranches(updatedBranches);
    return updatedBranches;
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
    safeSetPath(`${CATEGORIES_PATH}/${id}`, newCat, { action: 'set', entity: 'categories' });
  }, []);

  const updateCategoryFn = useCallback((id: string, updates: Partial<DynamicCategory>) => {
    const current = categories.find(c => c.id === id);
    if (current) {
      safeSetPath(`${CATEGORIES_PATH}/${id}`, { ...current, ...updates }, { action: 'set', entity: 'categories' });
    }
  }, [categories]);

  const deleteCategoryFn = useCallback((id: string) => {
    safeSoftDeletePath(`${CATEGORIES_PATH}/${id}`, { entity: 'categories', reason: 'category soft delete' });
  }, []);

  // Tags CRUD
  const addTagFn = useCallback((name: string) => {
    const newRef = push(ref(db, TAGS_PATH));
    safeSetPath(`${TAGS_PATH}/${newRef.key}`, { id: newRef.key, name }, { action: 'set', entity: 'tags' });
  }, []);

  const updateTagFn = useCallback((id: string, name: string) => {
    safeSetPath(`${TAGS_PATH}/${id}`, { id, name }, { action: 'set', entity: 'tags' });
  }, []);

  const deleteTagFn = useCallback((id: string) => {
    safeSoftDeletePath(`${TAGS_PATH}/${id}`, { entity: 'tags', reason: 'tag soft delete' });
  }, []);

  const addProductPricingFn = useCallback((price: Omit<ProductPricing, 'id' | 'isActive' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newRef = push(ref(db, PRODUCT_PRICING_PATH));
    const id = newRef.key || crypto.randomUUID();
    safeSetPath(`${PRODUCT_PRICING_PATH}/${id}`, { ...price, id, isActive: true, createdAt: now, updatedAt: now }, { action: 'set', entity: 'product_pricing', reason: 'create product price' });
  }, []);

  const updateProductPricingFn = useCallback((id: string, updates: Partial<Pick<ProductPricing, 'product' | 'color' | 'size' | 'purchasePrice' | 'isActive'>>) => {
    const current = productPricing.find(p => p.id === id);
    if (!current) return;
    safeSetPath(`${PRODUCT_PRICING_PATH}/${id}`, { ...current, ...updates, updatedAt: new Date().toISOString() }, { action: 'set', entity: 'product_pricing', reason: 'update product price' });
  }, [productPricing]);

  const disableProductPricingFn = useCallback((id: string) => {
    updateProductPricingFn(id, { isActive: false });
  }, [updateProductPricingFn]);

  return (
    <DataContext.Provider
      value={{
        branches,
        productionHistory,
        transferHistory,
        categories,
        availableTags,
        productPricing,
        dailyEmailRecipients,
        updateDailyEmailRecipients,
        addBranch,
        updateBranchName,
        removeBranch,
        addDateEntry,
        deleteDateEntry,
        updateDateStock,
        acceptStoredStockAsCorrect,
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
        addProductPricing: addProductPricingFn,
        updateProductPricing: updateProductPricingFn,
        disableProductPricing: disableProductPricingFn,
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
