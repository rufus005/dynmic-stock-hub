import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { Branch, ProductionRecord, SalesEntry, TransferRecord } from './types';
import { ProductPricing, PRODUCT_PRICING, getPurchasePrice, getSalePurchasePrice } from './pricing';

declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable?: { finalY: number };
  }
}

export type SaleWithBranch = SalesEntry & { branchName: string };

export type BranchDailySalesReport = {
  branchId: string;
  branchName: string;
  date: string;
  sales: SaleWithBranch[];
  totalQuantity: number;
  totalCollection: number;
  totalProfit: number;
  noSales: boolean;
};

export type TopSellingProduct = {
  product: string;
  shelfSize: string;
  color: string;
  quantity: number;
  collection: number;
};

export type DailySalesReportData = {
  date: string;
  branches: BranchDailySalesReport[];
  allSales: SaleWithBranch[];
  totalQuantity: number;
  totalCollection: number;
  totalProfit: number;
  topSellingProducts: TopSellingProduct[];
};

export type DailyReportAttachment = {
  filename: string;
  content: ArrayBuffer;
};

export type FullDailyReportPackage = {
  date: string;
  salesReport: DailySalesReportData;
  attachments: DailyReportAttachment[];
};

export function formatIstDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function formatCurrency(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-IN')}`;
}

function sanitizeFilePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Report';
}

function isVisibleRecord(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as { deleted?: boolean }).deleted !== true;
}

function listFromFirebaseValue<T>(value: unknown): T[] {
  if (!value) return [];
  const source = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return source.filter(isVisibleRecord) as T[];
}

export function normalizeBranchesFromFirebase(value: unknown): Branch[] {
  return listFromFirebaseValue<Record<string, unknown>>(value)
    .filter(branch => typeof branch.id === 'string' && typeof branch.name === 'string')
    .map(branch => ({
      id: branch.id as string,
      name: branch.name as string,
      dateEntries: listFromFirebaseValue<Record<string, unknown>>(branch.dateEntries)
        .filter(entry => typeof entry.date === 'string')
        .map(entry => ({
          date: entry.date as string,
          stock: listFromFirebaseValue(entry.stock),
          sales: listFromFirebaseValue<SalesEntry>(entry.sales),
          manualStockEditedAt: typeof entry.manualStockEditedAt === 'string' ? entry.manualStockEditedAt : undefined,
          manualStockEditReason: typeof entry.manualStockEditReason === 'string' ? entry.manualStockEditReason : undefined,
        })),
    }));
}

export function normalizeProductPricingFromFirebase(value: unknown): ProductPricing[] {
  const pricing = listFromFirebaseValue<ProductPricing>(value)
    .filter(item => item && typeof item.product === 'string' && typeof item.color === 'string' && typeof item.size === 'string');
  return pricing.length > 0 ? pricing : PRODUCT_PRICING;
}

export function normalizeProductionHistoryFromFirebase(value: unknown): ProductionRecord[] {
  return listFromFirebaseValue<ProductionRecord>(value)
    .filter(item => typeof item.date === 'string' && typeof item.branchName === 'string');
}

export function normalizeTransferHistoryFromFirebase(value: unknown): TransferRecord[] {
  return listFromFirebaseValue<TransferRecord>(value)
    .filter(item => typeof item.date === 'string' && typeof item.fromBranchName === 'string');
}

export function buildDailySalesReport(
  branches: Branch[],
  date: string,
  pricing: ProductPricing[] = PRODUCT_PRICING
): DailySalesReportData {
  const branchReports = branches.map(branch => {
    const sales = branch.dateEntries
      .filter(entry => entry.date === date)
      .flatMap(entry => entry.sales.map(sale => ({ ...sale, date: sale.date || entry.date, branchName: branch.name })))
      .filter(sale => sale.date === date);

    const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
    const totalCollection = sales.reduce((sum, sale) => sum + sale.collection, 0);
    const totalProfit = sales.reduce((sum, sale) => {
      const purchasePrice = getSalePurchasePrice(sale, pricing);
      return sum + (sale.price - purchasePrice * sale.quantity);
    }, 0);

    return {
      branchId: branch.id,
      branchName: branch.name,
      date,
      sales,
      totalQuantity,
      totalCollection,
      totalProfit,
      noSales: sales.length === 0,
    };
  });

  const allSales = branchReports.flatMap(branch => branch.sales);
  const topSellingMap = new Map<string, TopSellingProduct>();
  allSales.forEach(sale => {
    const key = `${sale.product}|${sale.shelfSize || '-'}|${sale.color}`;
    const current = topSellingMap.get(key) || {
      product: sale.product,
      shelfSize: sale.shelfSize || '-',
      color: sale.color,
      quantity: 0,
      collection: 0,
    };
    current.quantity += sale.quantity;
    current.collection += sale.collection;
    topSellingMap.set(key, current);
  });

  return {
    date,
    branches: branchReports,
    allSales,
    totalQuantity: branchReports.reduce((sum, branch) => sum + branch.totalQuantity, 0),
    totalCollection: branchReports.reduce((sum, branch) => sum + branch.totalCollection, 0),
    totalProfit: branchReports.reduce((sum, branch) => sum + branch.totalProfit, 0),
    topSellingProducts: Array.from(topSellingMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
  };
}

function addPageNumbers(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }
}

function addHeader(doc: jsPDF, title: string, date: string, branchName: string) {
  const marginX = 14;
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('DYNAMIC', marginX, 18);
  doc.setFontSize(14);
  doc.text(title, marginX, 27);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Date: ${date}`, marginX, 34);
  doc.text(`Branch: ${branchName}`, marginX, 40);
  doc.text(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, marginX, 46);
}

function addSummarySections(
  doc: jsPDF,
  report: DailySalesReportData,
  branches: BranchDailySalesReport[],
  branchName: string
) {
  const marginX = 14;
  autoTable(doc, {
    startY: 52,
    theme: 'grid',
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 8, cellPadding: 2 },
    body: [
      ['Total sales quantity', report.totalQuantity.toLocaleString('en-IN'), 'Total collection', formatCurrency(report.totalCollection)],
      ['Total profit', formatCurrency(report.totalProfit), 'Branches covered', branches.length.toLocaleString('en-IN')],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 40 },
      1: { halign: 'right', cellWidth: 76 },
      2: { fontStyle: 'bold', fillColor: [245, 247, 250], cellWidth: 40 },
      3: { halign: 'right', cellWidth: 76 },
    },
  });

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 70) + 6,
    theme: 'striped',
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 7, cellPadding: 1.8 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
    head: [['Branch-wise Summary', 'Qty', 'Collection', 'Profit', 'Status']],
    body: branches.map(branch => [
      branch.branchName,
      branch.totalQuantity.toString(),
      formatCurrency(branch.totalCollection),
      formatCurrency(branch.totalProfit),
      branch.noSales ? 'No sales updated today' : 'Sales updated',
    ]),
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });

  const topSelling = branchName === 'All Branches'
    ? report.topSellingProducts
    : buildTopSellingProducts(branches.flatMap(branch => branch.sales));

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 92) + 6,
    theme: 'striped',
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 7, cellPadding: 1.8 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
    head: [['Top Selling Products', 'Size', 'Color', 'Qty', 'Collection']],
    body: topSelling.length > 0
      ? topSelling.map(item => [item.product, item.shelfSize, item.color, item.quantity.toString(), formatCurrency(item.collection)])
      : [['No sales', '-', '-', '0', formatCurrency(0)]],
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
  });
}

function buildTopSellingProducts(sales: SaleWithBranch[]): TopSellingProduct[] {
  const topSellingMap = new Map<string, TopSellingProduct>();
  sales.forEach(sale => {
    const key = `${sale.product}|${sale.shelfSize || '-'}|${sale.color}`;
    const current = topSellingMap.get(key) || {
      product: sale.product,
      shelfSize: sale.shelfSize || '-',
      color: sale.color,
      quantity: 0,
      collection: 0,
    };
    current.quantity += sale.quantity;
    current.collection += sale.collection;
    topSellingMap.set(key, current);
  });
  return Array.from(topSellingMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 10);
}

function addSalesTable(doc: jsPDF, sales: SaleWithBranch[], pricing: ProductPricing[]) {
  const marginX = 14;
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 120) + 8,
    margin: { left: marginX, right: marginX, bottom: 16 },
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 1.8, overflow: 'linebreak' },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [['Date', 'Branch', 'Product', 'Size', 'Color', 'Payment', 'Qty', 'Collection', 'Driver Charges', 'Purchase Price', 'Profit']],
    body: sales.length > 0
      ? sales.map(sale => {
          const purchasePrice = getSalePurchasePrice(sale, pricing);
          const profit = sale.price - purchasePrice * sale.quantity;
          return [
            sale.date,
            sale.branchName,
            sale.product,
            sale.shelfSize || '-',
            sale.color,
            sale.paymentMode || 'Cash',
            sale.quantity.toString(),
            formatCurrency(sale.collection),
            formatCurrency(sale.driverCharge),
            formatCurrency(purchasePrice * sale.quantity),
            formatCurrency(profit),
          ];
        })
      : [['No sales', '-', '-', '-', '-', '-', '0', formatCurrency(0), formatCurrency(0), formatCurrency(0), formatCurrency(0)]],
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 28 },
      2: { cellWidth: 34 },
      3: { cellWidth: 16 },
      4: { cellWidth: 28 },
      5: { cellWidth: 20 },
      6: { halign: 'right', cellWidth: 14 },
      7: { halign: 'right', cellWidth: 24 },
      8: { halign: 'right', cellWidth: 24 },
      9: { halign: 'right', cellWidth: 24 },
      10: { halign: 'right', cellWidth: 24 },
    },
  });
}

function createBaseReport(title: string, date: string, branchName = 'All Branches') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addHeader(doc, title, date, branchName);
  return doc;
}

export function createDailySalesPdf(
  report: DailySalesReportData,
  options: { branchId?: string; pricing?: ProductPricing[] } = {}
) {
  const pricing = options.pricing || PRODUCT_PRICING;
  const selectedBranches = options.branchId
    ? report.branches.filter(branch => branch.branchId === options.branchId)
    : report.branches;
  const branchName = selectedBranches.length === 1 ? selectedBranches[0].branchName : 'All Branches';
  const sales = selectedBranches.flatMap(branch => branch.sales);
  const selectedReport: DailySalesReportData = {
    ...report,
    allSales: sales,
    totalQuantity: selectedBranches.reduce((sum, branch) => sum + branch.totalQuantity, 0),
    totalCollection: selectedBranches.reduce((sum, branch) => sum + branch.totalCollection, 0),
    totalProfit: selectedBranches.reduce((sum, branch) => sum + branch.totalProfit, 0),
  };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addHeader(doc, 'Daily Sales Report', report.date, branchName);
  addSummarySections(doc, selectedReport, selectedBranches, branchName);
  addSalesTable(doc, sales, pricing);
  addPageNumbers(doc);
  return doc;
}

export function createDailySalesPdfAttachments(report: DailySalesReportData, pricing: ProductPricing[] = PRODUCT_PRICING) {
  const attachments = [
    {
      filename: `DYNAMIC-Daily-Sales-Report-All-Branches-${report.date}.pdf`,
      content: createDailySalesPdf(report, { pricing }).output('arraybuffer'),
    },
    ...report.branches.map(branch => ({
      filename: `DYNAMIC-Daily-Sales-Report-${sanitizeFilePart(branch.branchName)}-${report.date}.pdf`,
      content: createDailySalesPdf(report, { branchId: branch.branchId, pricing }).output('arraybuffer'),
    })),
  ];
  return attachments;
}

export function createStockReportPdf(branches: Branch[], date: string, pricing: ProductPricing[] = PRODUCT_PRICING) {
  const doc = createBaseReport('Stock Report', date);
  const rows = branches.flatMap(branch => {
    const latestEntry = [...branch.dateEntries].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latestEntry) {
      return [[branch.name, '-', '-', '-', '0', formatCurrency(0), formatCurrency(0), 'No stock entry']];
    }
    const stockRows = latestEntry.stock
      .filter(item => item.quantity > 0)
      .map(item => {
        const purchasePrice = getPurchasePrice(item.category, item.color, item.shelfSize || '', pricing);
        return [
          branch.name,
          item.category,
          item.shelfSize || '-',
          item.color,
          item.quantity.toString(),
          formatCurrency(purchasePrice),
          formatCurrency(purchasePrice * item.quantity),
          latestEntry.date,
        ];
      });
    return stockRows.length > 0
      ? stockRows
      : [[branch.name, '-', '-', '-', '0', formatCurrency(0), formatCurrency(0), `No stock on ${latestEntry.date}`]];
  });
  const totalQty = branches.reduce((sum, branch) => {
    const latestEntry = [...branch.dateEntries].sort((a, b) => b.date.localeCompare(a.date))[0];
    return sum + (latestEntry?.stock.reduce((stockSum, item) => stockSum + item.quantity, 0) || 0);
  }, 0);

  autoTable(doc, {
    startY: 54,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8, cellPadding: 2 },
    body: [['Current Stock Quantity', totalQty.toLocaleString('en-IN'), 'Branches', branches.length.toLocaleString('en-IN')]],
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { halign: 'right' },
      2: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      3: { halign: 'right' },
    },
  });
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 66) + 8,
    margin: { left: 14, right: 14, bottom: 16 },
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 1.8 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
    head: [['Branch', 'Product', 'Size', 'Color', 'Qty', 'Purchase Price', 'Total Value', 'Stock Date']],
    body: rows,
    columnStyles: {
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
  });
  addPageNumbers(doc);
  return doc;
}

export function createProductionHistoryPdf(records: ProductionRecord[], date: string) {
  const doc = createBaseReport('Production History', date);
  const todayRecords = records.filter(record => record.date === date);
  const totalQty = todayRecords.reduce((sum, record) => sum + record.quantity, 0);
  autoTable(doc, {
    startY: 54,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8, cellPadding: 2 },
    body: [['Production receive entries', todayRecords.length.toString(), 'Total quantity', totalQty.toLocaleString('en-IN')]],
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { halign: 'right' },
      2: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      3: { halign: 'right' },
    },
  });
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 66) + 8,
    margin: { left: 14, right: 14, bottom: 16 },
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 1.8 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
    head: [['Date', 'Branch', 'From', 'Product', 'Size', 'Color', 'Quantity']],
    body: todayRecords.length > 0
      ? todayRecords.map(record => [record.date, record.branchName, record.fromName || '-', record.product, record.shelfSize || '-', record.color, record.quantity.toString()])
      : [[date, '-', '-', '-', '-', '-', 'No production receive entries today']],
    columnStyles: { 6: { halign: 'right' } },
  });
  addPageNumbers(doc);
  return doc;
}

export function createDriverChargeReportPdf(report: DailySalesReportData) {
  const doc = createBaseReport('Driver Charge Report', report.date);
  const driverRows = new Map<string, { trips: number; charges: number; collection: number }>();
  report.allSales.forEach(sale => {
    const name = sale.driverName || 'Unassigned';
    const current = driverRows.get(name) || { trips: 0, charges: 0, collection: 0 };
    current.trips += 1;
    current.charges += sale.driverCharge;
    current.collection += sale.collection;
    driverRows.set(name, current);
  });
  const rows = Array.from(driverRows.entries()).sort((a, b) => b[1].charges - a[1].charges);
  autoTable(doc, {
    startY: 54,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8, cellPadding: 2 },
    body: [
      ['Total trips', report.allSales.length.toString(), 'Total driver charges', formatCurrency(report.allSales.reduce((sum, sale) => sum + sale.driverCharge, 0))],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { halign: 'right' },
      2: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      3: { halign: 'right' },
    },
  });
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 66) + 8,
    margin: { left: 14, right: 14, bottom: 16 },
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 1.8 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
    head: [['Driver Name', 'Trips', 'Driver Charges', 'Collection']],
    body: rows.length > 0
      ? rows.map(([name, data]) => [name, data.trips.toString(), formatCurrency(data.charges), formatCurrency(data.collection)])
      : [['No driver charges today', '0', formatCurrency(0), formatCurrency(0)]],
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });
  addPageNumbers(doc);
  return doc;
}

export function createTransferHistoryPdf(records: TransferRecord[], date: string) {
  const doc = createBaseReport('Transfer History', date);
  const todayRecords = records.filter(record => record.date === date);
  const totalQty = todayRecords.reduce((sum, record) => sum + record.quantity, 0);
  autoTable(doc, {
    startY: 54,
    theme: 'grid',
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8, cellPadding: 2 },
    body: [['Transfer entries', todayRecords.length.toString(), 'Total quantity', totalQty.toLocaleString('en-IN')]],
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      1: { halign: 'right' },
      2: { fontStyle: 'bold', fillColor: [245, 247, 250] },
      3: { halign: 'right' },
    },
  });
  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 66) + 8,
    margin: { left: 14, right: 14, bottom: 16 },
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 1.8 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
    head: [['Date', 'Type', 'From', 'To', 'Product', 'Size', 'Color', 'Quantity']],
    body: todayRecords.length > 0
      ? todayRecords.map(record => [
          record.date,
          record.type === 'internal' ? 'Internal' : 'External',
          record.fromBranchName,
          record.type === 'external' ? (record.externalName || 'External') : (record.toBranchName || '-'),
          record.product,
          record.shelfSize || '-',
          record.color,
          record.quantity.toString(),
        ])
      : [[date, '-', '-', '-', '-', '-', '-', 'No transfers today']],
    columnStyles: { 7: { halign: 'right' } },
  });
  addPageNumbers(doc);
  return doc;
}

export function createFullDailyReportPackage(input: {
  branches: Branch[];
  productionHistory: ProductionRecord[];
  transferHistory: TransferRecord[];
  date: string;
  pricing?: ProductPricing[];
}): FullDailyReportPackage {
  const pricing = input.pricing || PRODUCT_PRICING;
  const salesReport = buildDailySalesReport(input.branches, input.date, pricing);
  const attachments: DailyReportAttachment[] = [
    ...createDailySalesPdfAttachments(salesReport, pricing),
    {
      filename: `DYNAMIC-Stock-Report-${input.date}.pdf`,
      content: createStockReportPdf(input.branches, input.date, pricing).output('arraybuffer'),
    },
    {
      filename: `DYNAMIC-Production-History-${input.date}.pdf`,
      content: createProductionHistoryPdf(input.productionHistory, input.date).output('arraybuffer'),
    },
    {
      filename: `DYNAMIC-Driver-Charge-Report-${input.date}.pdf`,
      content: createDriverChargeReportPdf(salesReport).output('arraybuffer'),
    },
    {
      filename: `DYNAMIC-Transfer-History-${input.date}.pdf`,
      content: createTransferHistoryPdf(input.transferHistory, input.date).output('arraybuffer'),
    },
  ];
  return {
    date: input.date,
    salesReport,
    attachments,
  };
}
