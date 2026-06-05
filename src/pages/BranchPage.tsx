import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useData } from '@/contexts/DataContext';
import { useAuth } from '@/contexts/AuthContext';
import { StockItem, SalesEntry, DynamicCategory } from '@/lib/types';
import { getRecalculatedDateEntries } from '@/lib/store';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, Plus, Trash2, Pencil, Check, X, Calendar, ChevronRight, ChevronDown, Tag } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { toast } from 'sonner';

const DEFAULT_DRIVER_NAMES = ['AKHIL', 'IMRAN', 'KHALEEL', 'KUMAR', 'MUTHUKUMA', 'SAJJID', 'SHABEER', 'YOUNUS', 'BILLA'];
const DRIVER_SUGGESTIONS_KEY = 'dynamic_driver_suggestions';
const PAYMENT_MODES = ['Cash', 'UPI', 'Online'] as const;

function normalizeDriverName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

function mergeDriverNames(...groups: string[][]) {
  const map = new Map<string, string>();
  groups.flat().forEach(name => {
    const normalized = normalizeDriverName(name);
    if (!normalized) return;
    const key = normalized.toLocaleLowerCase('en-IN');
    if (!map.has(key)) map.set(key, normalized);
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'en-IN', { sensitivity: 'base' }));
}

function parseEntryDate(date: string) {
  return new Date(`${date}T00:00:00`);
}

function formatEntryDate(date: string) {
  return parseEntryDate(date).toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMonthLabel(date: string) {
  return parseEntryDate(date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function getMonthKey(date: string) {
  const parsed = parseEntryDate(date);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type BranchDateEntry = {
  date: string;
  stock: StockItem[];
  sales: SalesEntry[];
};

export default function BranchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { branches, updateDateStock, addSale, deleteSale, updateSale, addDateEntry, deleteDateEntry, addStockItem, transferStock, externalTransfer, receiveStock, categories } = useData();
  const branch = branches.find(b => b.id === id);
  const displayDateEntries = useMemo(() => branch ? getRecalculatedDateEntries(branch) : [], [branch]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [showAddDate, setShowAddDate] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const autoCreatedDatesRef = useRef<Set<string>>(new Set());

  const dateEntryGroups = useMemo(() => {
    if (!branch) return [];

    const years = new Map<string, Map<string, {
      monthKey: string;
      monthLabel: string;
      sortKey: string;
      entries: BranchDateEntry[];
    }>>();

    displayDateEntries.forEach(entry => {
      const parsed = parseEntryDate(entry.date);
      const yearKey = String(parsed.getFullYear());
      const monthKey = `${yearKey}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
      if (!years.has(yearKey)) years.set(yearKey, new Map());
      const yearMonths = years.get(yearKey)!;
      if (!yearMonths.has(monthKey)) {
        yearMonths.set(monthKey, {
          monthKey,
          monthLabel: formatMonthLabel(entry.date),
          sortKey: monthKey,
          entries: [],
        });
      }
      yearMonths.get(monthKey)!.entries.push(entry);
    });

    return Array.from(years.entries())
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([year, months]) => ({
        year,
        months: Array.from(months.values())
          .map(month => {
            const entries = [...month.entries].sort((a, b) => b.date.localeCompare(a.date));
            const latestEntry = entries[0];
            return {
              ...month,
              entries,
              totalStock: latestEntry?.stock.reduce((sum, item) => sum + item.quantity, 0) || 0,
              salesCount: entries.reduce((sum, entry) => sum + entry.sales.length, 0),
              dailyEntriesCount: entries.length,
            };
          })
          .sort((a, b) => b.sortKey.localeCompare(a.sortKey)),
      }));
  }, [branch, displayDateEntries]);

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!branch) return;
    const todaysDate = getLocalDateString();
    const autoCreateKey = `${branch.id}|${todaysDate}`;
    const existingEntryFound = branch.dateEntries.some(entry => entry.date === todaysDate);

    console.log('[Auto daily date entry check]', {
      todaysDate,
      branchId: branch.id,
      branchName: branch.name,
      existingEntryFound,
      entriesCount: branch.dateEntries.length,
    });

    if (existingEntryFound) {
      autoCreatedDatesRef.current.delete(autoCreateKey);
      return;
    }

    if (autoCreatedDatesRef.current.has(autoCreateKey)) return;
    autoCreatedDatesRef.current.add(autoCreateKey);
    addDateEntry(branch.id, todaysDate, { source: 'auto' });
    setExpandedMonths(prev => {
      const next = new Set(prev);
      next.add(getMonthKey(todaysDate));
      return next;
    });
    toast.success("Today's entry created automatically");
  }, [branch, addDateEntry]);

  if (currentUser?.role === 'branch' && currentUser.branchId !== id) {
    return <Navigate to={`/branch/${currentUser.branchId}`} replace />;
  }

  if (!branch) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Branch not found</p>
          <button onClick={() => navigate('/dashboard')} className="mt-4 text-primary underline">Go to Dashboard</button>
        </div>
      </AppLayout>
    );
  }

  const dateEntry = selectedDate ? displayDateEntries.find(d => d.date === selectedDate) : null;

  const handleAddDate = () => {
    if (newDate) {
      console.log('[Branch add date requested]', {
        selectedDate: newDate,
        existingEntriesCount: branch.dateEntries.length,
      });
      if (branch.dateEntries.some(entry => entry.date === newDate)) {
        console.log('[Branch add date duplicate]', {
          selectedDate: newDate,
          updatedStateCount: branch.dateEntries.length,
        });
        toast.error('Date entry already exists');
        return;
      }
      addDateEntry(branch.id, newDate);
      setExpandedMonths(prev => {
        const next = new Set(prev);
        next.add(getMonthKey(newDate));
        return next;
      });
      setSelectedDate(null);
      setShowAddDate(false);
      toast.success('Date added');
    }
  };

  const handleDeleteDate = (date: string) => {
    if (confirm(`Delete all data for ${date}?`)) {
      deleteDateEntry(branch.id, date);
      if (selectedDate === date) setSelectedDate(null);
      toast.success('Date deleted');
    }
  };

  if (!selectedDate || !dateEntry) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(currentUser?.role === 'admin' ? '/dashboard' : `/branch/${currentUser?.branchId}`)} className="p-2 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold">{branch.name}</h1>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" /> Date Entries</h2>
              <button onClick={() => setShowAddDate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
                <Plus className="w-4 h-4" /> Add Date
              </button>
            </div>

            {showAddDate && (
              <div className="flex gap-2 mb-4">
                <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
                <button onClick={handleAddDate} className="p-2 rounded-lg bg-success text-success-foreground"><Check className="w-4 h-4" /></button>
                <button onClick={() => setShowAddDate(false)} className="p-2 rounded-lg bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
            )}

            <div className="space-y-2">
              {branch.dateEntries.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-8">No date entries yet. Add a date to start.</p>
              )}
              {dateEntryGroups.map(group => (
                <div key={group.year} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground px-1 pt-2">{group.year}</h3>
                  {group.months.map(month => {
                    const isExpanded = expandedMonths.has(month.monthKey);
                    return (
                      <div key={month.monthKey} className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleMonth(month.monthKey)}
                          className="w-full flex items-center justify-between p-4 rounded-xl bg-muted/40 border border-border/60 hover:border-primary/30 transition-all text-left"
                        >
                          <div>
                            <h4 className="font-medium">{month.monthLabel}</h4>
                            <p className="text-xs text-muted-foreground mt-1">
                              Stock: {month.totalStock} | Sales: {month.salesCount} | Entries: {month.dailyEntriesCount}
                            </p>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="space-y-2 pl-3">
                            {month.entries.map(entry => {
                              const stockTotal = entry.stock.reduce((s, i) => s + i.quantity, 0);
                              return (
                                <motion.div key={entry.date} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                  className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/50 hover:border-primary/30 transition-all group cursor-pointer"
                                  onClick={() => setSelectedDate(entry.date)}>
                                  <div>
                                    <h4 className="font-medium">{formatEntryDate(entry.date)}</h4>
                                    <p className="text-xs text-muted-foreground mt-1">Stock: {stockTotal} | Sales: {entry.sales.length}</p>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button onClick={e => { e.stopPropagation(); handleDeleteDate(entry.date); }} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <DateDetailView
        branchId={branch.id}
        branchName={branch.name}
        dateEntry={dateEntry}
        branches={branches}
        categories={categories}
        onBack={() => setSelectedDate(null)}
        updateDateStock={updateDateStock}
        addSale={addSale}
        updateSale={updateSale}
        deleteSale={deleteSale}
        addStockItem={addStockItem}
        receiveStock={receiveStock}
        transferStock={transferStock}
        externalTransfer={externalTransfer}
        userRole={currentUser?.role || 'branch'}
      />
    </AppLayout>
  );
}

function DateDetailView({
  branchId, branchName, dateEntry, branches, categories, onBack, updateDateStock, addSale, updateSale, deleteSale, addStockItem, receiveStock, transferStock, externalTransfer, userRole
}: {
  branchId: string;
  branchName: string;
  dateEntry: { date: string; stock: StockItem[]; sales: SalesEntry[] };
  branches: { id: string; name: string; dateEntries: { date: string; stock: StockItem[]; sales: SalesEntry[] }[] }[];
  categories: DynamicCategory[];
  onBack: () => void;
  updateDateStock: (branchId: string, date: string, stock: StockItem[]) => void;
  addSale: (branchId: string, date: string, sale: Omit<SalesEntry, 'id' | 'branchId' | 'collection'>) => void;
  updateSale: (branchId: string, date: string, saleId: string, updates: Partial<SalesEntry>) => void;
  deleteSale: (branchId: string, date: string, saleId: string) => void;
  addStockItem: (branchId: string, date: string, item: Omit<StockItem, 'id'>) => void;
  receiveStock: (branchId: string, date: string, item: Omit<StockItem, 'id'>, fromName?: string) => void;
  transferStock: (fromBranchId: string, toBranchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number) => void;
  externalTransfer: (branchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number, externalName?: string) => void;
  userRole: 'admin' | 'branch';
}) {
  const { productionHistory, transferHistory, availableTags, updateTransferRecord, deleteTransferRecord, updateProductionRecord, deleteProductionRecord } = useData();
  const [localStock, setLocalStock] = useState<StockItem[]>(dateEntry.stock);

  // Build a category map for lookups
  const categoryMap = useMemo(() => {
    const map: Record<string, { shelfSizes: string[]; colors: string[] }> = {};
    for (const cat of categories) {
      map[cat.name] = { shelfSizes: cat.shelfSizes, colors: cat.colors };
    }
    return map;
  }, [categories]);

  const categoryNames = useMemo(() => categories.map(c => c.name), [categories]);

  useEffect(() => {
    setLocalStock(prev => {
      const map = new Map<string, StockItem>();
      for (const item of prev) {
        const key = `${item.category}|${item.shelfSize || ''}|${item.color}`;
        const existing = map.get(key);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          map.set(key, { ...item });
        }
      }

      let added = false;
      for (const cat of categories) {
        const catItems = Array.from(map.values()).filter(s => s.category === cat.name);
        const sizes = [...new Set(catItems.map(s => s.shelfSize || '').filter(Boolean))];
        for (const size of sizes) {
          for (const color of cat.colors) {
            const key = `${cat.name}|${size}|${color}`;
            if (!map.has(key)) {
              map.set(key, { id: crypto.randomUUID(), category: cat.name, shelfSize: size, color, quantity: 0 });
              added = true;
            }
          }
        }
      }

      const deduped = Array.from(map.values());
      if (deduped.length !== prev.length || added) return deduped;
      return prev;
    });
  }, [localStock.length, categories]);

  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [editSaleData, setEditSaleData] = useState<Partial<SalesEntry>>({});
  const [saleItems, setSaleItems] = useState([{ product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0, price: 0, driverCharge: 0, driverName: '', customerNumber: '', paymentMode: 'Cash' as SalesEntry['paymentMode'] }]);
  const [customDriverNames, setCustomDriverNames] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(DRIVER_SUGGESTIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const existingDriverNames = useMemo(() => {
    const names: string[] = [];
    branches.forEach(branch => {
      branch.dateEntries.forEach(entry => {
        entry.sales.forEach(sale => names.push(sale.driverName));
      });
    });
    return names;
  }, [branches]);

  const driverSuggestions = useMemo(
    () => mergeDriverNames(DEFAULT_DRIVER_NAMES, existingDriverNames, customDriverNames),
    [existingDriverNames, customDriverNames]
  );

  const rememberDriverName = (name: string) => {
    const normalized = normalizeDriverName(name);
    if (!normalized) return;

    const exists = driverSuggestions.some(driver => driver.toLocaleLowerCase('en-IN') === normalized.toLocaleLowerCase('en-IN'));
    if (exists) return;

    setCustomDriverNames(prev => {
      const next = mergeDriverNames(prev, [normalized]);
      localStorage.setItem(DRIVER_SUGGESTIONS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Tag toggle state
  const [tagPopoverStock, setTagPopoverStock] = useState<string | null>(null);

  // Editing transfer external name
  const [editingTransferId, setEditingTransferId] = useState<string | null>(null);
  const [editTransferName, setEditTransferName] = useState('');

  // Editing transaction quantity (production or transfer)
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [editTxnQty, setEditTxnQty] = useState<number>(0);

  const startEditTxn = (id: string, qty: number) => {
    setEditingTxnId(id);
    setEditTxnQty(qty);
  };
  const saveEditProd = (id: string) => {
    if (editTxnQty < 0) { toast.error('Quantity must be ≥ 0'); return; }
    updateProductionRecord(id, { quantity: editTxnQty });
    setEditingTxnId(null);
    toast.success('Updated');
  };
  const saveEditTransfer = (id: string) => {
    if (editTxnQty < 0) { toast.error('Quantity must be ≥ 0'); return; }
    updateTransferRecord(id, { quantity: editTxnQty });
    setEditingTxnId(null);
    toast.success('Updated');
  };
  const removeProd = (id: string) => {
    if (!confirm('Delete this receive log entry? (stock totals are unchanged)')) return;
    deleteProductionRecord(id);
    toast.success('Deleted');
  };
  const removeTransfer = (id: string) => {
    if (!confirm('Delete this transfer log entry? (stock totals are unchanged)')) return;
    deleteTransferRecord(id);
    toast.success('Deleted');
  };

  const updateSaleItem = (index: number, updates: Partial<typeof saleItems[0]>) => {
    setSaleItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };
  const addSaleRow = () => {
    setSaleItems(prev => [...prev, { product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0, price: 0, driverCharge: 0, driverName: '', customerNumber: '', paymentMode: 'Cash' }]);
  };
  const removeSaleRow = (index: number) => {
    if (saleItems.length <= 1) return;
    setSaleItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleStockChange = (stockId: string, qty: number) => {
    setLocalStock(prev => prev.map(item => item.id === stockId ? { ...item, quantity: Math.max(0, qty) } : item));
  };

  const saveStock = () => {
    updateDateStock(branchId, dateEntry.date, localStock);
    toast.success('Stock saved');
  };

  const handleAddShelfSizeRow = (catName: string, colors: string[]) => {
    const newSize = prompt('Enter new shelf size (e.g. 1, 6, etc.):');
    if (!newSize || !newSize.trim()) return;
    const size = newSize.trim();
    const exists = localStock.some(s => s.category === catName && s.shelfSize === size);
    if (exists) { alert(`Size "${size}" already exists for ${catName}`); return; }
    const newItems: StockItem[] = colors.map(color => ({
      id: crypto.randomUUID(), category: catName, shelfSize: size, color, quantity: 0
    }));
    setLocalStock(prev => [...prev, ...newItems]);
  };

  const handleDeleteShelfSizeRow = (catName: string, size: string) => {
    if (!confirm(`Delete all entries for size "${size}" in ${catName}?`)) return;
    setLocalStock(prev => prev.filter(s => !(s.category === catName && s.shelfSize === size)));
  };

  const handleToggleTag = (stockId: string, tagName: string) => {
    setLocalStock(prev => prev.map(item => {
      if (item.id !== stockId) return item;
      const tags = item.tags || [];
      const newTags = tags.includes(tagName) ? tags.filter(t => t !== tagName) : [...tags, tagName];
      return { ...item, tags: newTags };
    }));
  };

  const handleSale = (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = saleItems.filter(item => item.color && item.shelfSize && item.quantity > 0);
    if (validItems.length === 0) {
      toast.error('Please fill at least one item with Color, Size, and Quantity');
      return;
    }
    for (const item of validItems) {
      const availableItem = localStock.find(s => s.category === item.product && s.color === item.color && (s.shelfSize || '') === item.shelfSize);
      const available = availableItem?.quantity || 0;
      if (item.quantity > available) {
        toast.error(`Insufficient stock for ${item.product} ${item.color} ${item.shelfSize}! Only ${available} available.`);
        return;
      }
    }
    for (const item of validItems) {
      rememberDriverName(item.driverName);
      addSale(branchId, dateEntry.date, {
        date: dateEntry.date,
        customerNumber: item.customerNumber,
        driverName: item.driverName,
        paymentMode: item.paymentMode || 'Cash',
        product: item.product,
        color: item.color,
        shelfSize: item.shelfSize,
        quantity: item.quantity,
        price: item.price,
        driverCharge: item.driverCharge,
      });
    }
    toast.success(`${validItems.length} sale(s) added (${validItems.reduce((s, i) => s + i.quantity, 0)} total units)`);
    setSaleItems([{ product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0, price: 0, driverCharge: 0, driverName: '', customerNumber: '', paymentMode: 'Cash' }]);
    setTimeout(() => {
      setLocalStock(dateEntry.stock);
    }, 100);
  };

  const handleEditSale = (sale: SalesEntry) => {
    setEditingSaleId(sale.id);
    setEditSaleData({ ...sale });
  };

  const handleSaveSaleEdit = () => {
    if (editingSaleId && editSaleData) {
      rememberDriverName(editSaleData.driverName || '');
      updateSale(branchId, dateEntry.date, editingSaleId, editSaleData);
      setEditingSaleId(null);
      setEditSaleData({});
      toast.success('Sale updated');
    }
  };

  const handleDeleteSale = (saleId: string) => {
    if (confirm('Delete this sale? Stock will be restored.')) {
      deleteSale(branchId, dateEntry.date, saleId);
      toast.success('Sale deleted');
    }
  };

  const getColorsForProduct = (product: string) => {
    const cat = categoryMap[product];
    if (!cat) return [];
    return [...cat.colors];
  };

  const getSizesForProduct = (product: string) => {
    const cat = categoryMap[product];
    if (!cat) return [];
    const sizes: string[] = [...cat.shelfSizes];
    const customSizes = localStock.filter(s => s.category === product).map(s => s.shelfSize || '').filter(Boolean);
    for (const s of customSizes) {
      if (!sizes.includes(s)) sizes.push(s);
    }
    sizes.sort((a, b) => Number(b) - Number(a));
    return sizes;
  };

  const getAvailableStockForItem = (product: string, color: string, shelfSize: string) => {
    if (!product || !color || !shelfSize) return null;
    const item = localStock.find(s => s.category === product && s.color === color && (s.shelfSize || '') === shelfSize);
    return item?.quantity || 0;
  };

  const saleTotalCollection = saleItems.reduce((sum, item) => sum + (item.price - item.driverCharge), 0);

  const categoryTotal = (cat: string) => localStock.filter(s => s.category === cat).reduce((sum, s) => sum + s.quantity, 0);

  const dateLabel = formatEntryDate(dateEntry.date);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{branchName}</h1>
          <p className="text-sm text-muted-foreground">{dateLabel}</p>
        </div>
      </div>

      {/* STOCK TABLE */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Stock Management</h2>
          {userRole === 'admin' && (
            <button onClick={saveStock} className="flex items-center gap-1.5 px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Save className="w-4 h-4" /> Save Stock
            </button>
          )}
        </div>

        {categories.map(cat => {
          const catItems = localStock.filter(s => s.category === cat.name);
          const colors = cat.colors;
          const shelfSizes = [...new Set(catItems.map(s => s.shelfSize || '').filter(Boolean))];
          shelfSizes.sort((a, b) => Number(b) - Number(a));

          const findItem = (size: string, color: string) =>
            catItems.find(s => s.shelfSize === size && s.color === color);

          const rowTotal = (size: string) => colors.reduce((sum, color) => {
            const item = findItem(size, color);
            return sum + (item?.quantity || 0);
          }, 0);

          const colTotal = (color: string) => shelfSizes.reduce((sum, size) => {
            const item = findItem(size, color);
            return sum + (item?.quantity || 0);
          }, 0);

          return (
            <div key={cat.id} className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-primary">{cat.name}</h3>
                <span className="text-sm text-muted-foreground font-mono">Total: {categoryTotal(cat.name)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-muted-foreground font-medium">Shelf Size</th>
                      {colors.map(color => (
                        <th key={color} className="text-center py-2 px-3 text-muted-foreground font-medium whitespace-nowrap">{color}</th>
                      ))}
                      <th className="text-center py-2 px-3 text-muted-foreground font-medium">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shelfSizes.map(size => (
                      <tr key={size} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="py-2 px-3 font-medium">{size}</td>
                        {colors.map(color => {
                          const item = findItem(size, color);
                          const itemId = item?.id;
                          const itemTags = item?.tags || [];
                          return (
                            <td key={color} className="py-2 px-3 text-center relative">
                              <input type="number" min="0" value={item?.quantity || 0}
                                onChange={e => {
                                  const qty = parseInt(e.target.value) || 0;
                                  if (itemId) handleStockChange(itemId, qty);
                                }}
                                readOnly={userRole !== 'admin'}
                                disabled={userRole !== 'admin'}
                                className="w-16 px-2 py-1 rounded-lg bg-muted/50 border border-border text-center outline-none focus:border-primary text-foreground font-mono text-sm disabled:opacity-60" />
                              {/* Tags */}
                              {itemTags.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 justify-center mt-0.5">
                                  {itemTags.map(t => (
                                    <span key={t} className="px-1 py-0 rounded text-[9px] bg-primary/15 text-primary font-medium">{t}</span>
                                  ))}
                                </div>
                              )}
                              {userRole === 'admin' && itemId && (
                                <div className="relative inline-block">
                                  <button type="button" onClick={() => setTagPopoverStock(tagPopoverStock === itemId ? null : itemId)}
                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground mt-0.5">
                                    <Tag className="w-3 h-3" />
                                  </button>
                                  {tagPopoverStock === itemId && (
                                    <div className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[120px]">
                                      {availableTags.length === 0 && <p className="text-xs text-muted-foreground">No tags. Add in Dashboard.</p>}
                                      {availableTags.map(tag => (
                                        <label key={tag.id} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer hover:bg-muted/50 rounded px-1">
                                          <input type="checkbox" checked={itemTags.includes(tag.name)} onChange={() => handleToggleTag(itemId, tag.name)} className="rounded" />
                                          {tag.name}
                                        </label>
                                      ))}
                                      <button onClick={() => setTagPopoverStock(null)} className="text-xs text-muted-foreground mt-1 w-full text-center">Close</button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 text-center font-mono font-medium">{rowTotal(size)}</td>
                        <td className="py-2 px-3">
                          {userRole === 'admin' && (
                            <button onClick={() => handleDeleteShelfSizeRow(cat.name, size)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/30">
                      <td className="py-2 px-3 font-semibold">Grand Total</td>
                      {colors.map(color => (
                        <td key={color} className="py-2 px-3 text-center font-mono font-semibold">{colTotal(color)}</td>
                      ))}
                      <td className="py-2 px-3 text-center font-mono font-bold">{categoryTotal(cat.name)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {userRole === 'admin' && (
                <button onClick={() => handleAddShelfSizeRow(cat.name, [...cat.colors])}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors">
                  <Plus className="w-4 h-4" /> Add Row
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* SALES ENTRY */}
      <div className="glass-card rounded-xl p-5">
        <h2 className="font-semibold text-lg mb-4">Add Sale</h2>
        <form onSubmit={handleSale} className="space-y-4">
          <datalist id="driver-suggestions">
            {driverSuggestions.map(driver => <option key={driver} value={driver} />)}
          </datalist>
          {saleItems.map((item, index) => {
            const avail = getAvailableStockForItem(item.product, item.color, item.shelfSize);
            return (
              <div key={index} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-11 gap-3 items-end p-3 rounded-lg bg-muted/20 border border-border/30">
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Customer #</label>
                  <input type="text" value={item.customerNumber} onChange={e => updateSaleItem(index, { customerNumber: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" placeholder="Cust #" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Product</label>
                  <select value={item.product} onChange={e => updateSaleItem(index, { product: e.target.value, color: '', shelfSize: '' })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                    {categoryNames.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Color</label>
                  <select value={item.color} onChange={e => updateSaleItem(index, { color: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                    <option value="">Select</option>
                    {getColorsForProduct(item.product).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Size</label>
                  <select value={item.shelfSize} onChange={e => updateSaleItem(index, { shelfSize: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                    <option value="">Select</option>
                    {getSizesForProduct(item.product).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Qty</label>
                  <input type="number" min="0" value={item.quantity || ''} onChange={e => updateSaleItem(index, { quantity: parseInt(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Price (₹)</label>
                  <input type="number" min="0" value={item.price || ''} onChange={e => updateSaleItem(index, { price: parseFloat(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">DC (₹)</label>
                  <input type="number" min="0" value={item.driverCharge || ''} onChange={e => updateSaleItem(index, { driverCharge: parseFloat(e.target.value) || 0 })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Driver</label>
                  <input
                    type="text"
                    list="driver-suggestions"
                    value={item.driverName}
                    onChange={e => updateSaleItem(index, { driverName: e.target.value })}
                    onBlur={e => rememberDriverName(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" placeholder="Driver" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Payment</label>
                  <select value={item.paymentMode || 'Cash'} onChange={e => updateSaleItem(index, { paymentMode: e.target.value as SalesEntry['paymentMode'] })}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                    {PAYMENT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Coll: <span className="font-semibold text-foreground font-mono">₹{(item.price - item.driverCharge).toLocaleString()}</span></p>
                  {avail !== null && (
                    <p className={`text-xs font-mono ${avail > 0 ? 'text-success' : 'text-destructive'}`}>
                      Avail: {avail}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {saleItems.length > 1 && (
                    <button type="button" onClick={() => removeSaleRow(index)} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex gap-3 items-center">
            <button type="button" onClick={addSaleRow}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors">
              <Plus className="w-4 h-4" /> Add Product
            </button>
            <button type="submit" className="flex items-center justify-center gap-1.5 px-6 py-2 rounded-lg gradient-accent text-accent-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" /> Submit All ({saleItems.filter(i => i.color && i.shelfSize && i.quantity > 0).length})
            </button>
            {saleItems.length > 1 && (
              <p className="text-sm text-muted-foreground font-mono">Total Collection: ₹{saleTotalCollection.toLocaleString()}</p>
            )}
          </div>
        </form>
      </div>

      {/* Sales History */}
      {dateEntry.sales.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <h2 className="font-semibold text-lg mb-4">Sales History ({dateEntry.sales.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Customer', 'Driver', 'Payment', 'Product', 'Color', 'Size', 'Qty', 'Price', 'DC', 'Collection', 'From', 'Actions'].map(h => (
                    <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dateEntry.sales].reverse().map(sale => (
                  <tr key={sale.id} className="border-b border-border/30 hover:bg-muted/20">
                    {editingSaleId === sale.id ? (
                      <>
                        <td className="py-2 px-2"><input type="text" value={editSaleData.customerNumber || ''} onChange={e => setEditSaleData(p => ({ ...p, customerNumber: e.target.value }))} className="w-full px-1 py-0.5 rounded bg-muted/50 border border-border text-sm text-foreground" /></td>
                        <td className="py-2 px-2"><input type="text" list="driver-suggestions" value={editSaleData.driverName || ''} onChange={e => setEditSaleData(p => ({ ...p, driverName: e.target.value }))} onBlur={e => rememberDriverName(e.target.value)} className="w-full px-1 py-0.5 rounded bg-muted/50 border border-border text-sm text-foreground" /></td>
                        <td className="py-2 px-2">
                          <select value={editSaleData.paymentMode || 'Cash'} onChange={e => setEditSaleData(p => ({ ...p, paymentMode: e.target.value as SalesEntry['paymentMode'] }))} className="w-full px-1 py-0.5 rounded bg-muted/50 border border-border text-sm text-foreground">
                            {PAYMENT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                          </select>
                        </td>
                        <td className="py-2 px-2">{sale.product}</td>
                        <td className="py-2 px-2">{sale.color}</td>
                        <td className="py-2 px-2">{sale.shelfSize || '-'}</td>
                        <td className="py-2 px-2"><input type="number" value={editSaleData.quantity || 0} onChange={e => setEditSaleData(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))} className="w-16 px-1 py-0.5 rounded bg-muted/50 border border-border text-sm font-mono text-foreground" /></td>
                        <td className="py-2 px-2"><input type="number" value={editSaleData.price || 0} onChange={e => setEditSaleData(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} className="w-20 px-1 py-0.5 rounded bg-muted/50 border border-border text-sm font-mono text-foreground" /></td>
                        <td className="py-2 px-2"><input type="number" value={editSaleData.driverCharge || 0} onChange={e => setEditSaleData(p => ({ ...p, driverCharge: parseFloat(e.target.value) || 0 }))} className="w-20 px-1 py-0.5 rounded bg-muted/50 border border-border text-sm font-mono text-foreground" /></td>
                        <td className="py-2 px-2 font-mono">₹{((editSaleData.price || 0) - (editSaleData.driverCharge || 0)).toLocaleString()}</td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">{(() => {
                          const match = productionHistory.find(p => p.branchId === branchId && p.product === sale.product && p.color === sale.color && (p.shelfSize || '') === (sale.shelfSize || '') && p.date === dateEntry.date);
                          return match?.fromName || '-';
                        })()}</td>
                        <td className="py-2 px-2">
                          <div className="flex gap-1">
                            <button onClick={handleSaveSaleEdit} className="p-1 rounded text-success hover:bg-success/10"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setEditingSaleId(null)} className="p-1 rounded text-muted-foreground hover:bg-muted"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 px-2">{sale.customerNumber}</td>
                        <td className="py-2 px-2">{sale.driverName}</td>
                        <td className="py-2 px-2">{sale.paymentMode || 'Cash'}</td>
                        <td className="py-2 px-2">{sale.product}</td>
                        <td className="py-2 px-2">{sale.color}</td>
                        <td className="py-2 px-2">{sale.shelfSize || '-'}</td>
                        <td className="py-2 px-2 font-mono">{sale.quantity}</td>
                        <td className="py-2 px-2 font-mono">₹{sale.price}</td>
                        <td className="py-2 px-2 font-mono">₹{sale.driverCharge}</td>
                        <td className="py-2 px-2 font-mono font-semibold">₹{sale.collection}</td>
                        <td className="py-2 px-2 text-muted-foreground text-xs">{(() => {
                          const match = productionHistory.find(p => p.branchId === branchId && p.product === sale.product && p.color === sale.color && (p.shelfSize || '') === (sale.shelfSize || '') && p.date === dateEntry.date);
                          return match?.fromName || '-';
                        })()}</td>
                        <td className="py-2 px-2">
                          <div className="flex gap-1">
                            <button onClick={() => handleEditSale(sale)} className="p-1 rounded text-primary hover:bg-primary/10"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteSale(sale.id)} className="p-1 rounded text-destructive hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-4 border-t border-border flex gap-6 text-sm">
            <p>Total Qty: <span className="font-semibold font-mono">{dateEntry.sales.reduce((s, sale) => s + sale.quantity, 0)}</span></p>
            <p>Total Collection: <span className="font-semibold font-mono">₹{dateEntry.sales.reduce((s, sale) => s + sale.collection, 0).toLocaleString()}</span></p>
            <p>Total DC: <span className="font-semibold font-mono">₹{dateEntry.sales.reduce((s, sale) => s + sale.driverCharge, 0).toLocaleString()}</span></p>
          </div>
        </div>
      )}

      {/* RECEIVE FROM PRODUCTION */}
      <ReceiveStockForm
        branchId={branchId}
        date={dateEntry.date}
        receiveStock={receiveStock}
        categoryNames={categoryNames}
        getColorsForProduct={getColorsForProduct}
        getSizesForProduct={getSizesForProduct}
        onStockUpdated={() => setTimeout(() => setLocalStock(dateEntry.stock), 100)}
      />

      {/* TRANSACTION LOG */}
      {(() => {
        const dateProdRecords = productionHistory.filter(r => r.branchId === branchId && r.date === dateEntry.date);
        const dateTransferRecords = transferHistory.filter(r => (r.fromBranchId === branchId || r.toBranchId === branchId) && r.date === dateEntry.date);
        const hasRecords = dateProdRecords.length > 0 || dateTransferRecords.length > 0;
        if (!hasRecords) return null;
        return (
          <div className="glass-card rounded-xl p-5">
            <h2 className="font-semibold text-lg mb-4">Transaction Log</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Type', 'From', 'To', 'Product', 'Color', 'Size', 'Qty', userRole === 'admin' ? 'Actions' : ''].map((h, i) => (
                      <th key={`${h}-${i}`} className="text-left py-2 px-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dateProdRecords.map(r => (
                    <tr key={`prod-${r.id}`} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="py-2 px-2">{r.date}</td>
                      <td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Receive</span></td>
                      <td className="py-2 px-2">{r.fromName || '-'}</td>
                      <td className="py-2 px-2">{r.branchName}</td>
                      <td className="py-2 px-2">{r.product}</td>
                      <td className="py-2 px-2">{r.color}</td>
                      <td className="py-2 px-2">{r.shelfSize || '-'}</td>
                      <td className="py-2 px-2 font-mono">
                        {editingTxnId === r.id ? (
                          <input type="number" min="0" value={editTxnQty} onChange={e => setEditTxnQty(parseInt(e.target.value) || 0)}
                            className="w-20 px-1 py-0.5 rounded bg-muted/50 border border-border text-sm text-foreground" />
                        ) : r.quantity}
                      </td>
                      {userRole === 'admin' && (
                        <td className="py-2 px-2">
                          {editingTxnId === r.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => saveEditProd(r.id)} className="p-0.5 text-success"><Check className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setEditingTxnId(null)} className="p-0.5 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button onClick={() => startEditTxn(r.id, r.quantity)} className="p-1 rounded hover:bg-muted text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => removeProd(r.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {dateTransferRecords.map(r => (
                    <tr key={`transfer-${r.id}`} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="py-2 px-2">{r.date}</td>
                      <td className="py-2 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.type === 'internal' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {r.type === 'internal' ? 'Transfer' : 'External'}
                        </span>
                      </td>
                      <td className="py-2 px-2">{r.fromBranchName}</td>
                      <td className="py-2 px-2">
                        {r.type === 'external' ? (
                          editingTransferId === r.id ? (
                            <div className="flex items-center gap-1">
                              <input type="text" value={editTransferName} onChange={e => setEditTransferName(e.target.value)}
                                className="w-24 px-1 py-0.5 rounded bg-muted/50 border border-border text-sm text-foreground"
                                onKeyDown={e => { if (e.key === 'Enter') { updateTransferRecord(r.id, { externalName: editTransferName }); setEditingTransferId(null); toast.success('Name updated'); }}} />
                              <button onClick={() => { updateTransferRecord(r.id, { externalName: editTransferName }); setEditingTransferId(null); toast.success('Name updated'); }} className="p-0.5 text-success"><Check className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setEditingTransferId(null)} className="p-0.5 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span>{r.externalName || 'External'}</span>
                              {userRole === 'admin' && (
                                <button onClick={() => { setEditingTransferId(r.id); setEditTransferName(r.externalName || ''); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )
                        ) : (r.toBranchName || '-')}
                      </td>
                      <td className="py-2 px-2">{r.product}</td>
                      <td className="py-2 px-2">{r.color}</td>
                      <td className="py-2 px-2">{r.shelfSize || '-'}</td>
                      <td className="py-2 px-2 font-mono">
                        {editingTxnId === r.id ? (
                          <input type="number" min="0" value={editTxnQty} onChange={e => setEditTxnQty(parseInt(e.target.value) || 0)}
                            className="w-20 px-1 py-0.5 rounded bg-muted/50 border border-border text-sm text-foreground" />
                        ) : r.quantity}
                      </td>
                      {userRole === 'admin' && (
                        <td className="py-2 px-2">
                          {editingTxnId === r.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => saveEditTransfer(r.id)} className="p-0.5 text-success"><Check className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setEditingTxnId(null)} className="p-0.5 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button onClick={() => startEditTxn(r.id, r.quantity)} className="p-1 rounded hover:bg-muted text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => removeTransfer(r.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <TransferStockForm
        branchId={branchId}
        date={dateEntry.date}
        branches={branches}
        localStock={localStock}
        categoryNames={categoryNames}
        transferStock={transferStock}
        externalTransfer={externalTransfer}
        getColorsForProduct={getColorsForProduct}
        getSizesForProduct={getSizesForProduct}
        onStockUpdated={() => setTimeout(() => setLocalStock(dateEntry.stock), 100)}
      />
    </div>
  );
}

function ReceiveStockForm({
  branchId, date, receiveStock, categoryNames, getColorsForProduct, getSizesForProduct, onStockUpdated
}: {
  branchId: string;
  date: string;
  receiveStock: (branchId: string, date: string, item: Omit<StockItem, 'id'>, fromName?: string) => void;
  categoryNames: string[];
  getColorsForProduct: (product: string) => string[];
  getSizesForProduct: (product: string) => string[];
  onStockUpdated: () => void;
}) {
  const [fromName, setFromName] = useState('');
  const [items, setItems] = useState([{ product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0 }]);

  const updateItem = (index: number, updates: Partial<typeof items[0]>) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };
  const addRow = () => {
    setItems(prev => [...prev, { product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0 }]);
  };
  const removeRow = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(item => item.color && item.shelfSize && item.quantity > 0);
    if (validItems.length === 0) {
      toast.error('Please fill at least one item with color, size, and quantity');
      return;
    }
    for (const item of validItems) {
      receiveStock(branchId, date, { category: item.product, color: item.color, shelfSize: item.shelfSize, quantity: item.quantity }, fromName);
    }
    toast.success(`${validItems.length} product(s) received (${validItems.reduce((s, i) => s + i.quantity, 0)} total units)`);
    setItems([{ product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0 }]);
    setFromName('');
    onStockUpdated();
  };

  return (
    <div className="glass-card rounded-xl p-5">
      <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
        <Plus className="w-5 h-5 text-success" /> Receive from Production
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="max-w-sm">
          <label className="text-xs text-muted-foreground font-medium">Received From</label>
          <input type="text" value={fromName} onChange={e => setFromName(e.target.value)}
            placeholder="e.g. Factory name, supplier..."
            className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
        </div>

        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end p-3 rounded-lg bg-muted/20 border border-border/30">
            <div>
              <label className="text-xs text-muted-foreground font-medium">Product</label>
              <select value={item.product} onChange={e => updateItem(index, { product: e.target.value, color: '', shelfSize: '' })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                {categoryNames.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Color</label>
              <select value={item.color} onChange={e => updateItem(index, { color: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                <option value="">Select color</option>
                {getColorsForProduct(item.product).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Size</label>
              <select value={item.shelfSize} onChange={e => updateItem(index, { shelfSize: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                <option value="">Select size</option>
                {getSizesForProduct(item.product).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Quantity</label>
              <input type="number" min="1" value={item.quantity || ''} onChange={e => updateItem(index, { quantity: parseInt(e.target.value) || 0 })}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
            </div>
            <div className="flex gap-2">
              {items.length > 1 && (
                <button type="button" onClick={() => removeRow(index)} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="flex gap-3">
          <button type="button" onClick={addRow}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors">
            <Plus className="w-4 h-4" /> Add Product
          </button>
          <button type="submit" className="flex items-center justify-center gap-1.5 px-6 py-2 rounded-lg bg-success text-success-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            <Check className="w-4 h-4" /> Receive All ({items.filter(i => i.color && i.shelfSize && i.quantity > 0).length})
          </button>
        </div>
      </form>
    </div>
  );
}

function TransferStockForm({
  branchId, date, branches, localStock, categoryNames, transferStock, externalTransfer, getColorsForProduct, getSizesForProduct, onStockUpdated
}: {
  branchId: string;
  date: string;
  branches: { id: string; name: string }[];
  localStock: StockItem[];
  categoryNames: string[];
  transferStock: (fromBranchId: string, toBranchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number) => void;
  externalTransfer: (branchId: string, date: string, product: string, color: string, shelfSize: string, quantity: number, externalName?: string) => void;
  getColorsForProduct: (product: string) => string[];
  getSizesForProduct: (product: string) => string[];
  onStockUpdated: () => void;
}) {
  const [transferType, setTransferType] = useState<'internal' | 'external'>('internal');
  const [toBranchId, setToBranchId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [items, setItems] = useState([{ product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0 }]);

  const otherBranches = branches.filter(b => b.id !== branchId);

  const updateItem = (index: number, updates: Partial<typeof items[0]>) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };
  const addRow = () => {
    setItems(prev => [...prev, { product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0 }]);
  };
  const removeRow = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const getAvailableForItem = (product: string, color: string, shelfSize: string) => {
    if (!product || !color || !shelfSize) return null;
    const item = localStock.find(s => s.category === product && s.color === color && (s.shelfSize || '') === shelfSize);
    return item?.quantity || 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(item => item.color && item.shelfSize && item.quantity > 0);
    if (validItems.length === 0) {
      toast.error('Please fill at least one item with Color, Size, and Quantity');
      return;
    }
    if (transferType === 'internal' && !toBranchId) {
      toast.error('Please select a destination branch');
      return;
    }
    for (const item of validItems) {
      const available = getAvailableForItem(item.product, item.color, item.shelfSize);
      if (available !== null && item.quantity > available) {
        toast.error(`Insufficient stock for ${item.product} ${item.color} ${item.shelfSize}! Only ${available} available.`);
        return;
      }
    }
    for (const item of validItems) {
      if (transferType === 'internal') {
        transferStock(branchId, toBranchId, date, item.product, item.color, item.shelfSize, item.quantity);
      } else {
        externalTransfer(branchId, date, item.product, item.color, item.shelfSize, item.quantity, externalName);
      }
    }
    const totalQty = validItems.reduce((s, i) => s + i.quantity, 0);
    if (transferType === 'internal') {
      const destName = branches.find(b => b.id === toBranchId)?.name || 'destination';
      toast.success(`${validItems.length} product(s) (${totalQty} units) transferred to ${destName}`);
    } else {
      toast.success(`${validItems.length} product(s) (${totalQty} units) sent to ${externalName || 'external'}`);
    }
    setToBranchId('');
    setExternalName('');
    setItems([{ product: categoryNames[0] || 'JUMBO', color: '', shelfSize: '', quantity: 0 }]);
    onStockUpdated();
  };

  return (
    <div className="glass-card rounded-xl p-5">
      <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
        <ArrowLeft className="w-5 h-5 text-primary rotate-180" /> Transfer Stock
      </h2>

      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => setTransferType('internal')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${transferType === 'internal' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          Internal (Branch)
        </button>
        <button type="button" onClick={() => setTransferType('external')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${transferType === 'external' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
          External
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {transferType === 'internal' && (
          <div className="max-w-sm">
            <label className="text-xs text-muted-foreground font-medium">To Branch</label>
            <select value={toBranchId} onChange={e => setToBranchId(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
              <option value="">Select branch</option>
              {otherBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {transferType === 'external' && (
          <div className="max-w-sm">
            <label className="text-xs text-muted-foreground font-medium">Destination Name</label>
            <input type="text" value={externalName} onChange={e => setExternalName(e.target.value)}
              placeholder="e.g. Wholesaler name, company..."
              className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
          </div>
        )}

        {items.map((item, index) => {
          const avail = getAvailableForItem(item.product, item.color, item.shelfSize);
          return (
            <div key={index} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end p-3 rounded-lg bg-muted/20 border border-border/30">
              <div>
                <label className="text-xs text-muted-foreground font-medium">Product</label>
                <select value={item.product} onChange={e => updateItem(index, { product: e.target.value, color: '', shelfSize: '' })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                  {categoryNames.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Color</label>
                <select value={item.color} onChange={e => updateItem(index, { color: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                  <option value="">Select</option>
                  {getColorsForProduct(item.product).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Size</label>
                <select value={item.shelfSize} onChange={e => updateItem(index, { shelfSize: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                  <option value="">Select</option>
                  {getSizesForProduct(item.product).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium">Quantity</label>
                <input type="number" min="1" value={item.quantity || ''} onChange={e => updateItem(index, { quantity: parseInt(e.target.value) || 0 })}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
              </div>
              <div>
                {avail !== null && (
                  <p className={`text-xs font-mono ${avail > 0 ? 'text-success' : 'text-destructive'}`}>
                    Avail: {avail}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {items.length > 1 && (
                  <button type="button" onClick={() => removeRow(index)} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex gap-3">
          <button type="button" onClick={addRow}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors">
            <Plus className="w-4 h-4" /> Add Product
          </button>
          <button type="submit" className="flex items-center justify-center gap-1.5 px-6 py-2 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            {transferType === 'internal' ? 'Transfer' : 'Send'} All ({items.filter(i => i.color && i.shelfSize && i.quantity > 0).length})
          </button>
        </div>
      </form>
    </div>
  );
}
