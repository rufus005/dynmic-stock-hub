import { useState, useMemo } from 'react';
import { useData } from '@/contexts/DataContext';
import { getAllSales, getRecalculatedDateEntries } from '@/lib/store';
import AppLayout from '@/components/AppLayout';
import { Download, Filter, Share2 } from 'lucide-react';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { PRODUCT_PRICING, getPurchasePrice } from '@/lib/pricing';
import { toast } from 'sonner';

declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable?: { finalY: number };
  }
}

type ReportType = 'sales' | 'stock' | 'driver' | 'production' | 'transfer';

type StockReportRow = {
  date: string;
  branchId: string;
  branch: string;
  category: string;
  shelfSize: string;
  color: string;
  quantity: number;
};

export default function ReportsPage() {
  const { branches, productionHistory, transferHistory, categories } = useData();
  const [reportType, setReportType] = useState<ReportType>('sales');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'weekly' | 'monthly' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [sizeFilter, setSizeFilter] = useState<string>('all');
  const [transferTypeFilter, setTransferTypeFilter] = useState<'all' | 'internal' | 'external'>('all');

  const allSales = useMemo(() => getAllSales(branches), [branches]);

  const parseLocalDate = (date: string) => new Date(`${date}T00:00:00`);
  const formatLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const formatPdfCurrency = (amount: number) => `Rs. ${amount.toLocaleString('en-IN')}`;
  const sanitizeFilePart = (value: string) => value.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'All';

  const getDateRange = () => {
    if (dateFilter === 'all') return { start: null as Date | null, end: null as Date | null };
    if (dateFilter === 'custom') {
      const start = customFrom ? parseLocalDate(customFrom) : null;
      const end = customTo ? new Date(parseLocalDate(customTo).getTime() + 24 * 60 * 60 * 1000) : null;
      return { start, end };
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dateFilter === 'today') return { start: todayStart, end: null };
    if (dateFilter === 'yesterday') {
      const yStart = new Date(todayStart);
      yStart.setDate(yStart.getDate() - 1);
      return { start: yStart, end: todayStart };
    }
    const cutoff = new Date(todayStart);
    if (dateFilter === 'weekly') cutoff.setDate(todayStart.getDate() - 7);
    else if (dateFilter === 'monthly') cutoff.setDate(todayStart.getDate() - 30);
    return { start: cutoff, end: null };
  };

  const getDisplayDateRange = () => {
    const { start, end } = getDateRange();
    if (!start && !end) return { fromDate: 'All', toDate: 'All', label: 'All Time' };
    const fromDate = start ? formatLocalDate(start) : 'All';
    const toDate = end ? formatLocalDate(new Date(end.getTime() - 24 * 60 * 60 * 1000)) : formatLocalDate(new Date());
    return { fromDate, toDate, label: `${fromDate} to ${toDate}` };
  };

  const isDateInRange = (date: string, start: Date | null, end: Date | null) => {
    const entryDate = parseLocalDate(date);
    if (start && entryDate < start) return false;
    if (end && entryDate >= end) return false;
    return true;
  };

  const availableSizes = useMemo(() => {
    if (productFilter === 'all') return [];
    const sizes = new Set<string>();
    PRODUCT_PRICING.filter(p => p.product === productFilter).forEach(p => sizes.add(p.size));
    return Array.from(sizes).sort((a, b) => Number(b) - Number(a));
  }, [productFilter]);

  const filteredSales = useMemo(() => {
    let sales = [...allSales];
    if (branchFilter !== 'all') sales = sales.filter(s => s.branchId === branchFilter);
    if (productFilter !== 'all') sales = sales.filter(s => s.product === productFilter);
    if (sizeFilter !== 'all') sales = sales.filter(s => s.shelfSize === sizeFilter);
    const { start, end } = getDateRange();
    if (start) sales = sales.filter(s => parseLocalDate(s.date) >= start);
    if (end) sales = sales.filter(s => parseLocalDate(s.date) < end);
    console.log('[Sales Report verification]', {
      rawSalesCount: allSales.length,
      branchFilter,
      dateFilter,
      customFrom,
      customTo,
      filteredReportResultCount: sales.length,
    });
    return sales;
  }, [allSales, branchFilter, productFilter, sizeFilter, dateFilter, customFrom, customTo]);

  const filteredProduction = useMemo(() => {
    let records = [...productionHistory];
    if (branchFilter !== 'all') records = records.filter(r => r.branchId === branchFilter);
    if (productFilter !== 'all') records = records.filter(r => r.product === productFilter);
    if (sizeFilter !== 'all') records = records.filter(r => r.shelfSize === sizeFilter);
    const { start, end } = getDateRange();
    if (start) records = records.filter(r => parseLocalDate(r.date) >= start);
    if (end) records = records.filter(r => parseLocalDate(r.date) < end);
    return records;
  }, [productionHistory, branchFilter, productFilter, sizeFilter, dateFilter, customFrom, customTo]);

  const filteredTransfers = useMemo(() => {
    let records = [...transferHistory];
    if (branchFilter !== 'all') records = records.filter(r => r.fromBranchId === branchFilter);
    if (productFilter !== 'all') records = records.filter(r => r.product === productFilter);
    if (sizeFilter !== 'all') records = records.filter(r => r.shelfSize === sizeFilter);
    if (transferTypeFilter !== 'all') records = records.filter(r => r.type === transferTypeFilter);
    const { start, end } = getDateRange();
    if (start) records = records.filter(r => parseLocalDate(r.date) >= start);
    if (end) records = records.filter(r => parseLocalDate(r.date) < end);
    return records;
  }, [transferHistory, branchFilter, productFilter, sizeFilter, dateFilter, customFrom, customTo, transferTypeFilter]);

  const totalQtySold = filteredSales.reduce((s, sale) => s + sale.quantity, 0);
  const totalCollection = filteredSales.reduce((s, sale) => s + sale.collection, 0);
  const totalDriverCharges = filteredSales.reduce((s, sale) => s + sale.driverCharge, 0);
  const totalPurchasePrice = filteredSales.reduce((s, sale) => s + getPurchasePrice(sale.product, sale.color, sale.shelfSize) * sale.quantity, 0);
  const totalProfit = filteredSales.reduce((s, sale) => {
    const pp = getPurchasePrice(sale.product, sale.color, sale.shelfSize);
    return s + (sale.price - pp * sale.quantity);
  }, 0);

  const stockData = useMemo(() => {
    const rawRows: StockReportRow[] = [];
    const { start, end } = getDateRange();

    branches.forEach(b => {
      getRecalculatedDateEntries(b).forEach(entry => {
        entry.stock.forEach(s => {
          if (s.quantity <= 0) return;
          rawRows.push({
            date: entry.date,
            branchId: b.id,
            branch: b.name,
            category: s.category,
            shelfSize: s.shelfSize || '-',
            color: s.color,
            quantity: s.quantity,
          });
        });
      });
    });

    const filteredRows = rawRows
      .filter(row => branchFilter === 'all' || row.branchId === branchFilter || row.branch === branchFilter)
      .filter(row => productFilter === 'all' || row.category === productFilter)
      .filter(row => sizeFilter === 'all' || row.shelfSize === sizeFilter)
      .filter(row => isDateInRange(row.date, start, end));

    console.log('[Stock Report verification]', {
      rawStockRowsCount: rawRows.length,
      filteredStockRowsCount: filteredRows.length,
      activeFilters: {
        dateFilter,
        customFrom,
        customTo,
        branchFilter,
        productFilter,
        sizeFilter,
      },
    });

    return filteredRows;
  }, [branches, branchFilter, productFilter, sizeFilter, dateFilter, customFrom, customTo]);

  const stockTotalQty = stockData.reduce((acc, s) => acc + s.quantity, 0);
  const stockTotalValue = stockData.reduce((acc, s) => acc + getPurchasePrice(s.category, s.color, s.shelfSize) * s.quantity, 0);
  const stockBranchCount = new Set(stockData.map(s => s.branchId)).size;
  const stockDateCount = new Set(stockData.map(s => s.date)).size;
  const summaryCards = reportType === 'stock'
    ? [
        { label: 'Stock Quantity', value: stockTotalQty.toLocaleString(), className: '' },
        { label: 'Stock Value', value: `₹${stockTotalValue.toLocaleString()}`, className: '' },
        { label: 'Stock Rows', value: stockData.length.toLocaleString(), className: '' },
        { label: 'Branches', value: stockBranchCount.toLocaleString(), className: '' },
        { label: 'Dates', value: stockDateCount.toLocaleString(), className: '' },
      ]
    : [
        { label: 'Total Qty Sold', value: totalQtySold.toLocaleString(), className: '' },
        { label: 'Total Collection', value: `₹${totalCollection.toLocaleString()}`, className: '' },
        { label: 'Driver Charges', value: `₹${totalDriverCharges.toLocaleString()}`, className: '' },
        { label: 'Purchase Price', value: `₹${totalPurchasePrice.toLocaleString()}`, className: '' },
        { label: 'Total Profit', value: `₹${totalProfit.toLocaleString()}`, className: totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600' },
      ];

  const reportTitle = reportType === 'sales' ? 'Sales Report'
    : reportType === 'stock' ? 'Stock Report'
      : reportType === 'driver' ? 'Driver Charge Report'
        : reportType === 'production' ? 'Production History'
          : 'Transfer History';

  const selectedBranchName = branchFilter === 'all'
    ? 'All Branches'
    : branches.find(b => b.id === branchFilter)?.name || 'Selected Branch';

  const selectedProductName = productFilter === 'all' ? 'All Products' : productFilter;
  const selectedSizeName = sizeFilter === 'all' ? 'All Sizes' : sizeFilter;

  const driverReportRows = useMemo(() => {
    const driverData = new Map<string, { trips: number; charges: number; collection: number }>();
    filteredSales.forEach(s => {
      const d = driverData.get(s.driverName) || { trips: 0, charges: 0, collection: 0 };
      d.trips++;
      d.charges += s.driverCharge;
      d.collection += s.collection;
      driverData.set(s.driverName, d);
    });
    return Array.from(driverData.entries()).map(([name, data]) => ({ name, ...data }));
  }, [filteredSales]);

  const getFilteredRowCount = () => {
    if (reportType === 'sales') return filteredSales.length;
    if (reportType === 'stock') return stockData.length;
    if (reportType === 'driver') return driverReportRows.length;
    if (reportType === 'production') return filteredProduction.length;
    return filteredTransfers.length;
  };

  const getPdfFileName = () => {
    const { fromDate, toDate } = getDisplayDateRange();
    return [
      'DYNAMIC',
      sanitizeFilePart(reportTitle),
      sanitizeFilePart(selectedBranchName),
      sanitizeFilePart(fromDate),
      'to',
      sanitizeFilePart(toDate),
    ].join('-') + '.pdf';
  };

  const addPageNumbers = (doc: jsPDF) => {
    const pageCount = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let page = 1; page <= pageCount; page++) {
      doc.setPage(page);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Page ${page} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    }
  };

  const withSuppressedAutoTableWidthLogs = <T,>(callback: () => T): T => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const shouldSuppress = (args: unknown[]) =>
      args.some(arg => typeof arg === 'string' && arg.includes('Of the table content') && arg.includes('could not fit page'));

    console.log = (...args: unknown[]) => {
      if (!shouldSuppress(args)) originalLog(...args);
    };
    console.warn = (...args: unknown[]) => {
      if (!shouldSuppress(args)) originalWarn(...args);
    };

    try {
      return callback();
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
  };

  const generatePDF = () => {
    return withSuppressedAutoTableWidthLogs(() => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const generatedAt = new Date().toLocaleString('en-IN');
    const dateRange = getDisplayDateRange();
    const marginX = 14;

    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('DYNAMIC', marginX, 18);
    doc.setFontSize(14);
    doc.text(reportTitle, marginX, 27);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Generated: ${generatedAt}`, marginX, 34);

    autoTable(doc, {
      startY: 40,
      theme: 'plain',
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 8, cellPadding: 1.5 },
      body: [
        ['Report Type', reportTitle, 'Branch', selectedBranchName],
        ['Product', selectedProductName, 'Size', selectedSizeName],
        ['Date Range', dateRange.label, 'Transfer Type', reportType === 'transfer' ? transferTypeFilter : '-'],
      ],
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 24 },
        1: { cellWidth: 90 },
        2: { fontStyle: 'bold', cellWidth: 28 },
        3: { cellWidth: 90 },
      },
    });

    const summaryStartY = (doc.lastAutoTable?.finalY || 58) + 4;
    const summaryRows = reportType === 'stock'
      ? [
          ['Stock Quantity', stockTotalQty.toLocaleString('en-IN'), 'Stock Value', formatPdfCurrency(stockTotalValue)],
          ['Stock Rows', stockData.length.toLocaleString('en-IN'), 'Branches', stockBranchCount.toLocaleString('en-IN')],
          ['Dates', stockDateCount.toLocaleString('en-IN'), '', ''],
        ]
      : [
          ['Total Qty Sold', totalQtySold.toLocaleString('en-IN'), 'Total Collection', formatPdfCurrency(totalCollection)],
          ['Driver Charges', formatPdfCurrency(totalDriverCharges), 'Purchase Price', formatPdfCurrency(totalPurchasePrice)],
          ['Total Profit', formatPdfCurrency(totalProfit), '', ''],
        ];

    autoTable(doc, {
      startY: summaryStartY,
      theme: 'grid',
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 8, cellPadding: 2 },
      body: summaryRows,
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 36 },
        1: { halign: 'right', cellWidth: 76 },
        2: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 36 },
        3: { halign: 'right', cellWidth: 76 },
      },
    });

    const tableStartY = (doc.lastAutoTable?.finalY || summaryStartY) + 8;
    const commonTableOptions = {
      startY: tableStartY,
      margin: { left: marginX, right: marginX, bottom: 16 },
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    };

    if (reportType === 'sales') {
      autoTable(doc, {
        ...commonTableOptions,
        head: [['Date', 'Branch', 'Product', 'Shelf Size', 'Color', 'Payment', 'Qty Sold', 'Collection', 'Driver Charges', 'Purchase Price', 'Profit']],
        body: filteredSales.map(s => {
          const pp = getPurchasePrice(s.product, s.color, s.shelfSize);
          const profit = s.price - pp * s.quantity;
          return [
            s.date,
            s.branchName,
            s.product,
            s.shelfSize || '-',
            s.color,
            s.paymentMode || 'Cash',
            s.quantity.toString(),
            formatPdfCurrency(s.collection),
            formatPdfCurrency(s.driverCharge),
            formatPdfCurrency(pp * s.quantity),
            formatPdfCurrency(profit),
          ];
        }),
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 28 },
          2: { cellWidth: 34 },
          3: { cellWidth: 18 },
          4: { cellWidth: 28 },
          5: { cellWidth: 20 },
          6: { halign: 'right', cellWidth: 16 },
          7: { halign: 'right', cellWidth: 24 },
          8: { halign: 'right', cellWidth: 24 },
          9: { halign: 'right', cellWidth: 24 },
          10: { halign: 'right', cellWidth: 24 },
        },
      });
    } else if (reportType === 'stock') {
      autoTable(doc, {
        ...commonTableOptions,
        head: [['Branch', 'Category', 'Shelf Size', 'Color', 'Quantity', 'Purchase Price (Rs.)', 'Total Value (Rs.)']],
        body: [
          ...stockData.map(s => {
            const pp = getPurchasePrice(s.category, s.color, s.shelfSize);
            return [s.branch, s.category, s.shelfSize, s.color, s.quantity.toString(), formatPdfCurrency(pp), formatPdfCurrency(pp * s.quantity)];
          }),
          ['', '', '', 'Grand Total', stockTotalQty.toString(), '', formatPdfCurrency(stockTotalValue)],
        ],
        columnStyles: {
          0: { cellWidth: 36 },
          1: { cellWidth: 38 },
          2: { cellWidth: 22 },
          3: { cellWidth: 38 },
          4: { halign: 'right', cellWidth: 22 },
          5: { halign: 'right', cellWidth: 36 },
          6: { halign: 'right', cellWidth: 36 },
        },
      });
    } else if (reportType === 'driver') {
      autoTable(doc, {
        ...commonTableOptions,
        head: [['Driver Name', 'Total Trips', 'Total Charges', 'Total Collection']],
        body: driverReportRows.map(d => [d.name, d.trips.toString(), formatPdfCurrency(d.charges), formatPdfCurrency(d.collection)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      });
    } else if (reportType === 'production') {
      autoTable(doc, {
        ...commonTableOptions,
        head: [['Date', 'Branch', 'From', 'Product', 'Color', 'Size', 'Quantity']],
        body: filteredProduction.map(r => [r.date, r.branchName, r.fromName || '-', r.product, r.color, r.shelfSize || '-', r.quantity]),
        columnStyles: { 6: { halign: 'right' } },
      });
    } else if (reportType === 'transfer') {
      autoTable(doc, {
        ...commonTableOptions,
        head: [['Date', 'Type', 'From', 'To', 'Product', 'Size', 'Quantity']],
        body: filteredTransfers.map(r => [
          r.date,
          r.type === 'internal' ? 'Internal' : 'External',
          r.fromBranchName,
          r.type === 'external' ? (r.externalName || 'External') : (r.toBranchName || '-'),
          r.product,
          r.shelfSize || '-',
          r.quantity.toString(),
        ]),
        columnStyles: { 6: { halign: 'right' } },
      });
    }

    addPageNumbers(doc);
    return doc;
    });
  };

  const downloadPDF = () => {
    if (getFilteredRowCount() === 0) {
      toast.error('No data available for selected filters.');
      return;
    }

    try {
      const doc = generatePDF();
      const fileName = getPdfFileName();
      doc.save(fileName);
      toast.success('PDF downloaded successfully.');
    } catch (error) {
      console.error('PDF download failed:', error);
      toast.error('Unable to download PDF. Please try again.');
    }
  };

  const sharePDF = async () => {
    if (getFilteredRowCount() === 0) {
      toast.error('No data available for selected filters.');
      return;
    }

    try {
      const doc = generatePDF();
      const fileName = getPdfFileName();
      const blob = doc.output('blob');
      const file = new File([blob], fileName, { type: 'application/pdf' });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: reportTitle, text: `${reportTitle} from DYNAMIC` });
        toast.success('PDF shared successfully.');
        return;
      }

      doc.save(fileName);
      toast.info('Sharing is not supported on this device. PDF downloaded instead.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('PDF share failed:', error);
      toast.error('Unable to share PDF. Downloading instead.');
      try {
        const doc = generatePDF();
        doc.save(getPdfFileName());
      } catch (downloadError) {
        console.error('PDF share fallback download failed:', downloadError);
        toast.error('Unable to create PDF. Please try again.');
      }
    }
  };

  return (
    <AppLayout title="Reports">
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {summaryCards.map(card => (
            <div key={card.label} className="glass-card rounded-xl p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 font-mono ${card.className}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold">Filters</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-muted-foreground font-medium">Report Type</label>
              <select value={reportType} onChange={e => setReportType(e.target.value as ReportType)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                <option value="sales">Sales Report</option>
                <option value="stock">Stock Report</option>
                <option value="driver">Driver Charge Report</option>
                <option value="production">Production History</option>
                <option value="transfer">Transfer History</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Date Range</label>
              <select value={dateFilter} onChange={e => setDateFilter(e.target.value as any)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="weekly">Last 7 Days</option>
                <option value="monthly">Last 30 Days</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {dateFilter === 'custom' && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">From Date</label>
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium">To Date</label>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm" />
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-muted-foreground font-medium">Branch</label>
              <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                <option value="all">All Branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Product</label>
              <select value={productFilter} onChange={e => { setProductFilter(e.target.value); setSizeFilter('all'); }}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                <option value="all">All Products</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            {productFilter !== 'all' && availableSizes.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground font-medium">Size</label>
                <select value={sizeFilter} onChange={e => setSizeFilter(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                  <option value="all">All Sizes</option>
                  {availableSizes.map(sz => <option key={sz} value={sz}>{sz}</option>)}
                </select>
              </div>
            )}
            {reportType === 'transfer' && (
              <div>
                <label className="text-xs text-muted-foreground font-medium">Transfer Type</label>
                <select value={transferTypeFilter} onChange={e => setTransferTypeFilter(e.target.value as any)}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted/50 border border-border outline-none focus:border-primary text-foreground text-sm">
                  <option value="all">All Types</option>
                  <option value="internal">Internal</option>
                  <option value="external">External</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Download & Share */}
        <div className="flex justify-end gap-3">
          <button onClick={sharePDF} className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border bg-muted/50 text-foreground font-medium text-sm hover:bg-muted transition-colors">
            <Share2 className="w-4 h-4" /> Share as PDF
          </button>
          <button onClick={downloadPDF} className="flex items-center gap-2 px-5 py-2.5 rounded-lg gradient-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity">
            <Download className="w-4 h-4" /> Download PDF
          </button>
        </div>

        {/* Preview */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-semibold mb-4">
            {reportType === 'sales' ? 'Sales' : reportType === 'stock' ? 'Stock' : reportType === 'driver' ? 'Driver Charges' : reportType === 'production' ? 'Production History' : 'Transfer History'} Preview
          </h3>
          <div className="overflow-x-auto">
            {reportType === 'sales' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Branch', 'Customer', 'Driver', 'Payment', 'Product', 'Color', 'Size', 'Qty', 'Price', 'Purchase Price', 'Profit', 'DC', 'Collection'].map(h => (
                      <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.map(s => {
                    const pp = getPurchasePrice(s.product, s.color, s.shelfSize);
                    const profit = s.price - pp * s.quantity;
                    return (
                      <tr key={s.id} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="py-2 px-2">{s.date}</td>
                        <td className="py-2 px-2">{s.branchName}</td>
                        <td className="py-2 px-2">{s.customerNumber}</td>
                        <td className="py-2 px-2">{s.driverName}</td>
                        <td className="py-2 px-2">{s.paymentMode || 'Cash'}</td>
                        <td className="py-2 px-2">{s.product}</td>
                        <td className="py-2 px-2">{s.color}</td>
                        <td className="py-2 px-2">{s.shelfSize || '-'}</td>
                        <td className="py-2 px-2 font-mono">{s.quantity}</td>
                        <td className="py-2 px-2 font-mono">₹{s.price}</td>
                        <td className="py-2 px-2 font-mono">₹{(pp * s.quantity).toLocaleString()}</td>
                        <td className={`py-2 px-2 font-mono ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>₹{profit}</td>
                        <td className="py-2 px-2 font-mono">₹{s.driverCharge}</td>
                        <td className="py-2 px-2 font-mono font-semibold">₹{s.collection}</td>
                      </tr>
                    );
                  })}
                  {filteredSales.length === 0 && (
                    <tr><td colSpan={14} className="py-8 text-center text-muted-foreground">No data found</td></tr>
                  )}
                  {filteredSales.length > 0 && (
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                      <td className="py-2 px-2" colSpan={8}>Totals</td>
                      <td className="py-2 px-2 font-mono">{totalQtySold}</td>
                      <td className="py-2 px-2"></td>
                      <td className="py-2 px-2 font-mono">₹{totalPurchasePrice.toLocaleString()}</td>
                      <td className={`py-2 px-2 font-mono ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>₹{totalProfit.toLocaleString()}</td>
                      <td className="py-2 px-2 font-mono">₹{totalDriverCharges.toLocaleString()}</td>
                      <td className="py-2 px-2 font-mono">₹{totalCollection.toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {reportType === 'stock' && (() => {
              return (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Branch', 'Category', 'Shelf Size', 'Color', 'Quantity', 'Purchase Price (₹)', 'Total Value (₹)'].map(h => (
                      <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stockData.map((s, i) => {
                    const pp = getPurchasePrice(s.category, s.color, s.shelfSize);
                    const total = pp * s.quantity;
                    return (
                      <tr key={i} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="py-2 px-2">{s.branch}</td>
                        <td className="py-2 px-2">{s.category}</td>
                        <td className="py-2 px-2">{s.shelfSize}</td>
                        <td className="py-2 px-2">{s.color}</td>
                        <td className="py-2 px-2 font-mono">{s.quantity}</td>
                        <td className="py-2 px-2 font-mono">₹{pp.toLocaleString('en-IN')}</td>
                        <td className="py-2 px-2 font-mono">₹{total.toLocaleString('en-IN')}</td>
                      </tr>
                    );
                  })}
                  {stockData.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No stock data found</td></tr>
                  )}
                </tbody>
                {stockData.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                      <td className="py-2 px-2" colSpan={3}></td>
                      <td className="py-2 px-2 text-right">Grand Total</td>
                      <td className="py-2 px-2 font-mono">{stockTotalQty}</td>
                      <td className="py-2 px-2 font-mono">—</td>
                      <td className="py-2 px-2 font-mono">₹{stockTotalValue.toLocaleString('en-IN')}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              );
            })()}

            {reportType === 'driver' && (() => {
              const driverData = new Map<string, { trips: number; charges: number; collection: number }>();
              filteredSales.forEach(s => {
                const d = driverData.get(s.driverName) || { trips: 0, charges: 0, collection: 0 };
                d.trips++; d.charges += s.driverCharge; d.collection += s.collection;
                driverData.set(s.driverName, d);
              });
              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">Driver Name</th>
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">Total Trips</th>
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">Total Charges</th>
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">Total Collection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(driverData.entries()).map(([name, d]) => (
                      <tr key={name} className="border-b border-border/30 hover:bg-muted/20">
                        <td className="py-2 px-2">{name}</td>
                        <td className="py-2 px-2 font-mono">{d.trips}</td>
                        <td className="py-2 px-2 font-mono">₹{d.charges}</td>
                        <td className="py-2 px-2 font-mono">₹{d.collection}</td>
                      </tr>
                    ))}
                    {driverData.size === 0 && (
                      <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No driver data found</td></tr>
                    )}
                  </tbody>
                </table>
              );
            })()}
            {reportType === 'production' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Branch', 'From', 'Product', 'Color', 'Size', 'Quantity'].map(h => (
                      <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredProduction.map(r => (
                    <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="py-2 px-2">{r.date}</td>
                      <td className="py-2 px-2">{r.branchName}</td>
                      <td className="py-2 px-2">{r.fromName || '-'}</td>
                      <td className="py-2 px-2">{r.product}</td>
                      <td className="py-2 px-2">{r.color}</td>
                      <td className="py-2 px-2">{r.shelfSize || '-'}</td>
                      <td className="py-2 px-2 font-mono">{r.quantity}</td>
                    </tr>
                  ))}
                  {filteredProduction.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No production history found</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {reportType === 'transfer' && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Type', 'From', 'To', 'Product', 'Size', 'Quantity'].map(h => (
                      <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTransfers.map(r => (
                    <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="py-2 px-2">{r.date}</td>
                      <td className="py-2 px-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.type === 'internal' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {r.type === 'internal' ? 'Internal' : 'External'}
                        </span>
                      </td>
                      <td className="py-2 px-2">{r.fromBranchName}</td>
                      <td className="py-2 px-2">{r.type === 'external' ? (r.externalName || 'External') : (r.toBranchName || '-')}</td>
                      <td className="py-2 px-2">{r.product}</td>
                      <td className="py-2 px-2">{r.shelfSize || '-'}</td>
                      <td className="py-2 px-2 font-mono">{r.quantity}</td>
                    </tr>
                  ))}
                  {filteredTransfers.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No transfer history found</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
