import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '@/contexts/DataContext';
import { useAuth } from '@/contexts/AuthContext';
import { DynamicCategory, UserAccount } from '@/lib/types';
import { getOverallStock, getAllSales, getBranchTotalStock, getBranchTotalSales, getLatestDateEntry } from '@/lib/store';
import { getPurchasePrice } from '@/lib/pricing';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Package, TrendingUp, Store, ArrowRight, Plus, Pencil, Trash2, X, Check, Users, Shield, Building2, Tag, Layers, Filter, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { toast } from 'sonner';

export default function DashboardPage() {
  const { branches, categories, availableTags, productionHistory, addBranch, updateBranchName, removeBranch, addCategory, updateCategory, deleteCategory, addTag, updateTag, deleteTag } = useData();
  const { users, addUser, updateUser, deleteUser } = useAuth();
  const [newBranchName, setNewBranchName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [overallStockOpen, setOverallStockOpen] = useState(false);
  const [stockSummaryOpen, setStockSummaryOpen] = useState(false);
  const [dashboardBranchFilter, setDashboardBranchFilter] = useState<string>('all');

  // User management state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'branch' as 'admin' | 'branch', branchId: '' });

  // Category management state
  const [showCatForm, setShowCatForm] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({ name: '', shelfSizes: '', colors: '' });

  // Tag management state
  const [showTagForm, setShowTagForm] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tagName, setTagName] = useState('');

  const dashboardBranches = useMemo(
    () => dashboardBranchFilter === 'all'
      ? branches
      : branches.filter(branch => branch.id === dashboardBranchFilter),
    [branches, dashboardBranchFilter]
  );
  const selectedDashboardBranchName = dashboardBranchFilter === 'all'
    ? 'All Branches'
    : branches.find(branch => branch.id === dashboardBranchFilter)?.name || 'Selected Branch';

  const overallStock = getOverallStock(dashboardBranches);
  const allSales = useMemo(() => getAllSales(dashboardBranches), [dashboardBranches]);
  const parseLocalDate = (date: string) => new Date(`${date}T00:00:00`);
  const formatLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const categoryTotals: { name: string; total: number }[] = [];
  for (const cat of categories) {
    let total = 0;
    const catMap = overallStock.get(cat.name);
    if (catMap) {
      catMap.forEach(sizeMap => sizeMap.forEach(qty => { total += qty; }));
    }
    categoryTotals.push({ name: cat.name, total });
  }

  const grandTotal = categoryTotals.reduce((s, c) => s + c.total, 0);
  // Current month sales only, calculated at runtime without writing/resetting Firebase data.
  const totalSales = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const currentMonthSales = allSales.filter(s => {
      if (!s.date) return false;
      const saleDate = parseLocalDate(s.date);
      return saleDate >= monthStart && saleDate < monthEnd;
    });

    console.log('[Dashboard monthly sales verification]', {
      totalSalesFound: allSales.length,
      currentMonthSalesFound: currentMonthSales.length,
      selectedBranch: selectedDashboardBranchName,
      selectedBranchId: dashboardBranchFilter,
      dateRangeUsed: {
        from: formatLocalDate(monthStart),
        toExclusive: formatLocalDate(monthEnd),
      },
    });

    return currentMonthSales.length;
  }, [allSales, dashboardBranchFilter, selectedDashboardBranchName]);

  const monthlySalesData = useMemo(() => {
    const monthMap = new Map<string, { month: string; salesCount: number; sortKey: string }>();

    for (const sale of allSales) {
      if (!sale.date) continue;
      const saleDate = parseLocalDate(sale.date);
      if (Number.isNaN(saleDate.getTime())) continue;
      const sortKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
      const month = saleDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
      const existing = monthMap.get(sortKey) || { month, salesCount: 0, sortKey };
      existing.salesCount += 1;
      monthMap.set(sortKey, existing);
    }

    const grouped = Array.from(monthMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    console.log('[Dashboard month-wise sales verification]', {
      totalSalesRecords: allSales.length,
      selectedBranch: selectedDashboardBranchName,
      selectedBranchId: dashboardBranchFilter,
      monthWiseGroupedCount: grouped.map(({ month, salesCount }) => ({ month, salesCount })),
    });

    return grouped;
  }, [allSales, dashboardBranchFilter, selectedDashboardBranchName]);

  // Total Stock Value for the selected dashboard branch scope (latest snapshot × purchase price)
  const totalStockValue = useMemo(() => {
    let value = 0;
    for (const branch of dashboardBranches) {
      const latest = getLatestDateEntry(branch);
      if (!latest) continue;
      for (const item of latest.stock) {
        value += item.quantity * getPurchasePrice(item.category, item.color, item.shelfSize || '');
      }
    }
    return value;
  }, [dashboardBranches]);

  const reportsCalculatedStock = useMemo(() => {
    return dashboardBranches.reduce((total, branch) => {
      const latest = getLatestDateEntry(branch);
      if (!latest) return total;
      return total + latest.stock.reduce((sum, item) => sum + item.quantity, 0);
    }, 0);
  }, [dashboardBranches]);

  useEffect(() => {
    console.log('[Dashboard stock sync verification]', {
      dashboardRawProductsCount: branches.length,
      selectedBranch: selectedDashboardBranchName,
      selectedBranchId: dashboardBranchFilter,
      calculatedDashboardStock: grandTotal,
      reportsCalculatedStock,
    });
  }, [branches.length, selectedDashboardBranchName, dashboardBranchFilter, grandTotal, reportsCalculatedStock]);

  // ================== Advanced Stock Summary Filters ==================
  const [sumProduct, setSumProduct] = useState<string>('all');
  const [sumSize, setSumSize] = useState<string>('all');
  const [sumFromDate, setSumFromDate] = useState<string>('');
  const [sumToDate, setSumToDate] = useState<string>('');

  const sumSizeOptions = useMemo(() => {
    if (sumProduct === 'all') {
      const sizes = new Set<string>();
      categories.forEach(c => c.shelfSizes.forEach(s => sizes.add(s)));
      return Array.from(sizes);
    }
    return categories.find(c => c.name === sumProduct)?.shelfSizes ?? [];
  }, [sumProduct, categories]);

  const summaryRows = useMemo(() => {
    const inRange = (d: string) => {
      if (sumFromDate && d < sumFromDate) return false;
      if (sumToDate && d > sumToDate) return false;
      return true;
    };
    const matches = (product: string, size: string) => {
      if (sumProduct !== 'all' && product !== sumProduct) return false;
      if (sumSize !== 'all' && (size || '') !== sumSize) return false;
      return true;
    };

    // key = product|size|color
    const map = new Map<string, { product: string; size: string; color: string; purchased: number; sold: number }>();
    const ensure = (product: string, size: string, color: string) => {
      const k = `${product}|${size}|${color}`;
      let row = map.get(k);
      if (!row) {
        row = { product, size, color, purchased: 0, sold: 0 };
        map.set(k, row);
      }
      return row;
    };

    // Purchased = production/receive history
    for (const r of productionHistory) {
      if (dashboardBranchFilter !== 'all' && r.branchId !== dashboardBranchFilter) continue;
      if (!inRange(r.date)) continue;
      if (!matches(r.product, r.shelfSize || '')) continue;
      ensure(r.product, r.shelfSize || '', r.color).purchased += r.quantity;
    }

    // Sold = sales across selected dashboard branch scope
    for (const branch of dashboardBranches) {
      for (const entry of branch.dateEntries) {
        if (!inRange(entry.date)) continue;
        for (const sale of entry.sales) {
          if (!matches(sale.product, sale.shelfSize || '')) continue;
          ensure(sale.product, sale.shelfSize || '', sale.color).sold += sale.quantity;
        }
      }
    }

    return Array.from(map.values())
      .map(r => {
        const current = r.purchased - r.sold;
        const price = getPurchasePrice(r.product, r.color, r.size);
        return { ...r, currentStock: current, stockValue: current * price, purchasePrice: price };
      })
      .sort((a, b) => a.product.localeCompare(b.product) || a.size.localeCompare(b.size) || a.color.localeCompare(b.color));
  }, [productionHistory, dashboardBranches, dashboardBranchFilter, sumProduct, sumSize, sumFromDate, sumToDate]);

  const summaryTotals = useMemo(() => {
    return summaryRows.reduce(
      (acc, r) => ({
        purchased: acc.purchased + r.purchased,
        sold: acc.sold + r.sold,
        currentStock: acc.currentStock + r.currentStock,
        stockValue: acc.stockValue + r.stockValue,
      }),
      { purchased: 0, sold: 0, currentStock: 0, stockValue: 0 }
    );
  }, [summaryRows]);

  const COLORS = ['hsl(220,80%,55%)', 'hsl(160,60%,45%)', 'hsl(38,92%,50%)', 'hsl(280,60%,55%)', 'hsl(0,70%,55%)'];

  const handleAdd = () => {
    if (newBranchName.trim()) {
      addBranch(newBranchName.trim());
      setNewBranchName('');
      setShowAdd(false);
      toast.success('Branch added');
    }
  };

  const handleEdit = (id: string) => {
    if (editName.trim()) {
      updateBranchName(id, editName.trim());
      setEditingId(null);
      toast.success('Branch renamed');
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this branch and all its data?')) {
      removeBranch(id);
      toast.success('Branch deleted');
    }
  };

  const handleSaveUser = () => {
    if (!userForm.username.trim() || !userForm.password.trim()) return;
    if (userForm.role === 'branch' && !userForm.branchId) return;
    if (editingUserId) {
      updateUser(editingUserId, {
        username: userForm.username,
        password: userForm.password,
        role: userForm.role,
        branchId: userForm.role === 'admin' ? null : userForm.branchId,
      });
      setEditingUserId(null);
      toast.success('User updated');
    } else {
      addUser({
        username: userForm.username,
        password: userForm.password,
        role: userForm.role,
        branchId: userForm.role === 'admin' ? null : userForm.branchId,
      });
      toast.success('User created');
    }
    setUserForm({ username: '', password: '', role: 'branch', branchId: '' });
    setShowUserForm(false);
  };

  const handleEditUser = (user: UserAccount) => {
    setEditingUserId(user.id);
    setUserForm({ username: user.username, password: user.password, role: user.role, branchId: user.branchId || '' });
    setShowUserForm(true);
  };

  const handleDeleteUser = (id: string) => {
    if (confirm('Delete this user?')) {
      deleteUser(id);
      toast.success('User deleted');
    }
  };

  // Category handlers
  const handleSaveCategory = () => {
    const name = catForm.name.trim();
    if (!name) return;
    const shelfSizes = catForm.shelfSizes.split(',').map(s => s.trim()).filter(Boolean);
    const colors = catForm.colors.split(',').map(s => s.trim()).filter(Boolean);
    if (shelfSizes.length === 0 || colors.length === 0) {
      toast.error('Please provide at least one shelf size and one color');
      return;
    }
    if (editingCatId) {
      updateCategory(editingCatId, { name, shelfSizes, colors });
      setEditingCatId(null);
      toast.success('Category updated');
    } else {
      addCategory({ name, shelfSizes, colors });
      toast.success('Category added');
    }
    setCatForm({ name: '', shelfSizes: '', colors: '' });
    setShowCatForm(false);
  };

  const handleEditCategory = (cat: DynamicCategory) => {
    setEditingCatId(cat.id);
    setCatForm({ name: cat.name, shelfSizes: cat.shelfSizes.join(', '), colors: cat.colors.join(', ') });
    setShowCatForm(true);
  };

  const handleDeleteCategory = (id: string) => {
    if (confirm('Delete this category? Existing stock data will not be removed.')) {
      deleteCategory(id);
      toast.success('Category deleted');
    }
  };

  // Tag handlers
  const handleSaveTag = () => {
    const name = tagName.trim();
    if (!name) return;
    if (editingTagId) {
      updateTag(editingTagId, name);
      setEditingTagId(null);
      toast.success('Tag updated');
    } else {
      addTag(name);
      toast.success('Tag added');
    }
    setTagName('');
    setShowTagForm(false);
  };

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-6">
        {/* Dashboard Branch Filter */}
        <div className="glass-card rounded-xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-xs text-muted-foreground font-medium">Dashboard Branch</label>
              <select
                value={dashboardBranchFilter}
                onChange={e => setDashboardBranchFilter(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm"
              >
                <option value="all">All Branches</option>
                {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </div>
            <div className="lg:col-span-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Showing Stock For</p>
              <p className="text-lg font-semibold mt-1">{selectedDashboardBranchName}</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Stock', value: grandTotal.toLocaleString(), icon: Package, gradient: 'gradient-primary' },
            { label: 'Branches', value: dashboardBranches.length, icon: Store, gradient: 'gradient-accent' },
            { label: 'Total Sales (This Month)', value: totalSales, icon: TrendingUp, gradient: 'gradient-warning' },
            { label: 'Stock Value', value: `₹${totalStockValue.toLocaleString()}`, icon: Wallet, gradient: 'gradient-primary' },
          ].map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-xl ${stat.gradient} flex items-center justify-center`}>
                  <stat.icon className="w-5 h-5 text-primary-foreground" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card rounded-xl p-5">
            <h3 className="font-semibold mb-4">Stock by Category</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={categoryTotals}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                  {categoryTotals.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="glass-card rounded-xl p-5">
            <h3 className="font-semibold mb-4">Category Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={categoryTotals.filter(c => c.total > 0)} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {categoryTotals.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Month-wise Sales Count */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-semibold mb-4">Month-wise Sales Count</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlySalesData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
              <Line type="monotone" dataKey="salesCount" name="Sales Count" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Overall Stock Summary */}
        <div className="glass-card rounded-xl p-5">
          <button
            onClick={() => setOverallStockOpen(o => !o)}
            className="w-full flex items-center justify-between"
            aria-expanded={overallStockOpen}
          >
            <h3 className="font-semibold">Overall Stock Summary</h3>
            {overallStockOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {overallStockOpen && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Category</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Shelf Size</th>
                    <th className="text-left py-3 px-3 text-muted-foreground font-medium">Color</th>
                    <th className="text-right py-3 px-3 text-muted-foreground font-medium">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(overallStock.entries()).map(([category, sizeMap]) =>
                    Array.from(sizeMap.entries()).map(([size, colorMap]) =>
                      Array.from(colorMap.entries()).map(([color, qty], ci) => (
                        <tr key={`${category}-${size}-${color}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          {ci === 0 && size === Array.from(sizeMap.keys())[0] && (
                            <td className="py-2 px-3 font-medium" rowSpan={Array.from(sizeMap.values()).reduce((s, m) => s + m.size, 0)}>{category}</td>
                          )}
                          {ci === 0 && <td className="py-2 px-3" rowSpan={colorMap.size}>{size === 'all' ? '-' : size}</td>}
                          <td className="py-2 px-3">{color}</td>
                          <td className="py-2 px-3 text-right font-mono">{qty}</td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stock Summary (Advanced) */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              onClick={() => setStockSummaryOpen(o => !o)}
              className="flex items-center gap-2 flex-1 text-left"
              aria-expanded={stockSummaryOpen}
            >
              <h3 className="font-semibold flex items-center gap-2"><Filter className="w-4 h-4 text-primary" /> Stock Summary</h3>
              {stockSummaryOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {stockSummaryOpen && (sumProduct !== 'all' || sumSize !== 'all' || sumFromDate || sumToDate) && (
              <button
                onClick={() => { setSumProduct('all'); setSumSize('all'); setSumFromDate(''); setSumToDate(''); }}
                className="text-xs px-2.5 py-1 rounded-md bg-muted text-muted-foreground hover:bg-muted/70"
              >
                Clear filters
              </button>
            )}
          </div>

          {stockSummaryOpen && (<>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 mt-4">
            <div>
              <label className="text-xs text-muted-foreground font-medium">Product Type</label>
              <select
                value={sumProduct}
                onChange={e => { setSumProduct(e.target.value); setSumSize('all'); }}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm"
              >
                <option value="all">All Products</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Size</label>
              <select
                value={sumSize}
                onChange={e => setSumSize(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm"
              >
                <option value="all">All Sizes</option>
                {sumSizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">From Date</label>
              <input
                type="date"
                value={sumFromDate}
                onChange={e => setSumFromDate(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">To Date</label>
              <input
                type="date"
                value={sumToDate}
                onChange={e => setSumToDate(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Product</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Size</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Color</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Purchased</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Sold</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Current Stock</th>
                  <th className="text-right py-2 px-3 text-muted-foreground font-medium">Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map(r => (
                  <tr key={`${r.product}-${r.size}-${r.color}`} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="py-2 px-3 font-medium">{r.product}</td>
                    <td className="py-2 px-3">{r.size || '-'}</td>
                    <td className="py-2 px-3">{r.color}</td>
                    <td className="py-2 px-3 text-right font-mono">{r.purchased}</td>
                    <td className="py-2 px-3 text-right font-mono">{r.sold}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{r.currentStock}</td>
                    <td className="py-2 px-3 text-right font-mono">₹{r.stockValue.toLocaleString()}</td>
                  </tr>
                ))}
                {summaryRows.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No data for the selected filters</td></tr>
                )}
              </tbody>
              {summaryRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20">
                    <td className="py-2 px-3 font-semibold" colSpan={3}>Total</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{summaryTotals.purchased}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{summaryTotals.sold}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">{summaryTotals.currentStock}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold">₹{summaryTotals.stockValue.toLocaleString()}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </>)}
        </div>

        {/* Categories Management */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><Layers className="w-5 h-5 text-primary" /> Categories ({categories.length})</h3>
            <button onClick={() => { setShowCatForm(true); setEditingCatId(null); setCatForm({ name: '', shelfSizes: '', colors: '' }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" /> Add Category
            </button>
          </div>

          {showCatForm && (
            <div className="p-4 rounded-xl bg-muted/30 border border-border/50 mb-4 space-y-3">
              <h4 className="font-medium text-sm">{editingCatId ? 'Edit Category' : 'New Category'}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Name</label>
                  <input value={catForm.name} onChange={e => setCatForm(p => ({ ...p, name: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" placeholder="e.g. JUMBO" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Shelf Sizes (comma-separated)</label>
                  <input value={catForm.shelfSizes} onChange={e => setCatForm(p => ({ ...p, shelfSizes: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" placeholder="e.g. 5, 4, 3, 2" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Colors (comma-separated)</label>
                  <input value={catForm.colors} onChange={e => setCatForm(p => ({ ...p, colors: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" placeholder="e.g. Brown, White, Grey" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveCategory} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success text-success-foreground text-sm font-medium">
                  <Check className="w-4 h-4" /> {editingCatId ? 'Update' : 'Create'}
                </button>
                <button onClick={() => { setShowCatForm(false); setEditingCatId(null); }} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {categories.map(cat => (
              <div key={cat.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50 group">
                <div>
                  <p className="font-medium text-sm">{cat.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sizes: {cat.shelfSizes.join(', ')} | Colors: {cat.colors.join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleEditCategory(cat)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDeleteCategory(cat.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tags Management */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><Tag className="w-5 h-5 text-primary" /> Product Tags ({availableTags.length})</h3>
            <button onClick={() => { setShowTagForm(true); setEditingTagId(null); setTagName(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" /> Add Tag
            </button>
          </div>

          {showTagForm && (
            <div className="flex gap-2 mb-4">
              <input value={tagName} onChange={e => setTagName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveTag()}
                placeholder="Tag name (e.g. New Arrival, Discounted)" className="flex-1 px-3 py-2 rounded-lg bg-muted/50 border border-border focus:border-primary outline-none text-sm text-foreground placeholder:text-muted-foreground" autoFocus />
              <button onClick={handleSaveTag} className="p-2 rounded-lg bg-success text-success-foreground"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setShowTagForm(false); setEditingTagId(null); }} className="p-2 rounded-lg bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {availableTags.map(tag => (
              <div key={tag.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border/50 group">
                {editingTagId === tag.id ? (
                  <>
                    <input value={tagName} onChange={e => setTagName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveTag()}
                      className="w-24 px-1 py-0.5 rounded bg-muted border border-border text-sm text-foreground" autoFocus />
                    <button onClick={handleSaveTag} className="text-success"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingTagId(null)} className="text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium">{tag.name}</span>
                    <button onClick={() => { setEditingTagId(tag.id); setTagName(tag.name); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => { if (confirm('Delete this tag?')) deleteTag(tag.id); }} className="p-0.5 rounded hover:bg-destructive/10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3 h-3" /></button>
                  </>
                )}
              </div>
            ))}
            {availableTags.length === 0 && !showTagForm && (
              <p className="text-muted-foreground text-sm">No tags yet. Add tags to label stock items.</p>
            )}
          </div>
        </div>

        {/* Branches */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Branches ({branches.length})</h3>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" /> Add Branch
            </button>
          </div>

          {showAdd && (
            <div className="flex gap-2 mb-4">
              <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="Branch name" className="flex-1 px-3 py-2 rounded-lg bg-muted/50 border border-border focus:border-primary outline-none text-sm text-foreground placeholder:text-muted-foreground" autoFocus />
              <button onClick={handleAdd} className="p-2 rounded-lg bg-success text-success-foreground"><Check className="w-4 h-4" /></button>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {branches.map(branch => {
              const branchTotal = getBranchTotalStock(branch);
              const branchSales = getBranchTotalSales(branch);
              return (
                <motion.div key={branch.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="p-4 rounded-xl bg-muted/30 border border-border/50 hover:border-primary/30 transition-all group">
                  {editingId === branch.id ? (
                    <div className="flex gap-2">
                      <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEdit(branch.id)}
                        className="flex-1 px-2 py-1 rounded bg-muted border border-border outline-none text-sm text-foreground" autoFocus />
                      <button onClick={() => handleEdit(branch.id)} className="text-success"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">{branch.name}</h4>
                        <p className="text-xs text-muted-foreground mt-1">Stock: {branchTotal} | Sales: {branchSales} | Dates: {branch.dateEntries.length}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingId(branch.id); setEditName(branch.name); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(branch.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                        <Link to={`/branch/${branch.id}`} className="p-1.5 rounded-lg hover:bg-primary/10 text-primary"><ArrowRight className="w-3.5 h-3.5" /></Link>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
            {branches.length === 0 && (
              <p className="text-muted-foreground text-sm col-span-full text-center py-8">No branches yet. Add your first branch to get started.</p>
            )}
          </div>
        </div>

        {/* User Management */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Manage Users ({users.length})</h3>
            <button onClick={() => { setShowUserForm(true); setEditingUserId(null); setUserForm({ username: '', password: '', role: 'branch', branchId: '' }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg gradient-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" /> Add User
            </button>
          </div>

          {showUserForm && (
            <div className="p-4 rounded-xl bg-muted/30 border border-border/50 mb-4 space-y-3">
              <h4 className="font-medium text-sm">{editingUserId ? 'Edit User' : 'New User'}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Username</label>
                  <input value={userForm.username} onChange={e => setUserForm(p => ({ ...p, username: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" placeholder="Username" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Password</label>
                  <input value={userForm.password} onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" placeholder="Password" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Role</label>
                  <select value={userForm.role} onChange={e => setUserForm(p => ({ ...p, role: e.target.value as 'admin' | 'branch' }))}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                    <option value="admin">Admin</option>
                    <option value="branch">Branch</option>
                  </select>
                </div>
                {userForm.role === 'branch' && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Assign Branch</label>
                    <select value={userForm.branchId} onChange={e => setUserForm(p => ({ ...p, branchId: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                      <option value="">Select branch</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveUser} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success text-success-foreground text-sm font-medium">
                  <Check className="w-4 h-4" /> {editingUserId ? 'Update' : 'Create'}
                </button>
                <button onClick={() => { setShowUserForm(false); setEditingUserId(null); }} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {users.map(user => (
              <div key={user.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50 group">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${user.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-accent/50 text-accent-foreground'}`}>
                    {user.role === 'admin' ? <Shield className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{user.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.role === 'admin' ? 'Admin' : `Branch: ${branches.find(b => b.id === user.branchId)?.name || 'Unassigned'}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleEditUser(user)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDeleteUser(user.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
