import { Branch } from './types';

export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getBranchSalesSummary(branch: Branch, today = new Date()) {
  const todayKey = getLocalDateString(today);
  const monthKey = getLocalMonthKey(today);
  let dailySalesCount = 0;
  let monthlySalesCount = 0;

  branch.dateEntries.forEach(entry => {
    entry.sales.forEach(sale => {
      const saleDate = sale.date || entry.date;
      if (sale.branchId && sale.branchId !== branch.id) return;
      if (saleDate === todayKey) dailySalesCount += 1;
      if (saleDate.startsWith(`${monthKey}-`)) monthlySalesCount += 1;
    });
  });

  return {
    dailySalesCount,
    monthlySalesCount,
    todayKey,
    monthKey,
  };
}
