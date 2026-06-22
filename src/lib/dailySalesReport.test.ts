import { buildDailySalesReport, createFullDailyReportPackage, formatIstDate } from './dailySalesReport';
import { Branch, ProductionRecord, TransferRecord } from './types';

describe('daily sales email report', () => {
  it('includes branches that have no sales for the day', () => {
    const branches: Branch[] = [
      {
        id: 'jp-nagar',
        name: 'JP Nagar',
        dateEntries: [
          {
            date: '2026-06-21',
            stock: [],
            sales: [
              {
                id: 'sale-1',
                date: '2026-06-21',
                customerNumber: '9999999999',
                driverName: 'Driver',
                paymentMode: 'Cash',
                product: 'JUMBO',
                color: 'Ivory',
                shelfSize: '5',
                quantity: 2,
                price: 10000,
                purchasePrice: 3600,
                driverCharge: 500,
                collection: 9500,
                branchId: 'jp-nagar',
              },
            ],
          },
        ],
      },
      {
        id: 'btm',
        name: 'BTM',
        dateEntries: [],
      },
    ];

    const report = buildDailySalesReport(branches, '2026-06-21');

    expect(report.branches).toHaveLength(2);
    expect(report.branches.find(branch => branch.branchName === 'BTM')).toMatchObject({
      noSales: true,
      totalQuantity: 0,
      totalCollection: 0,
      totalProfit: 0,
    });
    expect(report.totalQuantity).toBe(2);
    expect(report.totalCollection).toBe(9500);
    expect(report.totalProfit).toBe(2800);
  });

  it('formats dates in IST', () => {
    expect(formatIstDate(new Date('2026-06-21T18:00:00.000Z'))).toBe('2026-06-21');
    expect(formatIstDate(new Date('2026-06-21T18:31:00.000Z'))).toBe('2026-06-22');
  });

  it('generates all required daily report PDFs', () => {
    const branches: Branch[] = [
      {
        id: 'jp-nagar',
        name: 'JP Nagar',
        dateEntries: [
          {
            date: '2026-06-22',
            stock: [{ id: 'stock-1', category: 'JUMBO', shelfSize: '5', color: 'Ivory', quantity: 4 }],
            sales: [
              {
                id: 'sale-1',
                date: '2026-06-22',
                customerNumber: '9999999999',
                driverName: 'Driver',
                paymentMode: 'Cash',
                product: 'JUMBO',
                color: 'Ivory',
                shelfSize: '5',
                quantity: 1,
                price: 5000,
                purchasePrice: 3600,
                driverCharge: 500,
                collection: 4500,
                branchId: 'jp-nagar',
              },
            ],
          },
        ],
      },
      { id: 'btm', name: 'BTM', dateEntries: [] },
    ];
    const productionHistory: ProductionRecord[] = [
      { id: 'prod-1', date: '2026-06-22', branchId: 'jp-nagar', branchName: 'JP Nagar', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 2 },
    ];
    const transferHistory: TransferRecord[] = [
      { id: 'transfer-1', date: '2026-06-22', type: 'internal', fromBranchId: 'jp-nagar', fromBranchName: 'JP Nagar', toBranchId: 'btm', toBranchName: 'BTM', product: 'JUMBO', color: 'Ivory', shelfSize: '5', quantity: 1 },
    ];

    const reportPackage = createFullDailyReportPackage({
      branches,
      productionHistory,
      transferHistory,
      date: '2026-06-22',
    });
    const filenames = reportPackage.attachments.map(attachment => attachment.filename);

    expect(filenames).toContain('DYNAMIC-Daily-Sales-Report-All-Branches-2026-06-22.pdf');
    expect(filenames).toContain('DYNAMIC-Daily-Sales-Report-JP-Nagar-2026-06-22.pdf');
    expect(filenames).toContain('DYNAMIC-Daily-Sales-Report-BTM-2026-06-22.pdf');
    expect(filenames).toContain('DYNAMIC-Stock-Report-2026-06-22.pdf');
    expect(filenames).toContain('DYNAMIC-Production-History-2026-06-22.pdf');
    expect(filenames).toContain('DYNAMIC-Driver-Charge-Report-2026-06-22.pdf');
    expect(filenames).toContain('DYNAMIC-Transfer-History-2026-06-22.pdf');
    expect(reportPackage.attachments).toHaveLength(branches.length + 5);
  });
});
