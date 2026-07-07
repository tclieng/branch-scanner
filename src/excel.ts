// ===== EXCEL EXPORT SERVICE (SheetJS) =====

import * as XLSX from 'xlsx';
import type { Receipt, ExportOptions } from './types';
import { CATEGORIES } from './types';
import { getAllReceipts, getReceiptsByDateRange, getReceiptsByCategory } from './database';

function buildWorkbook(receipts: Receipt[]): XLSX.WorkBook {
  // ── Sheet 1: All Receipts ──────────────────────────────────
  const rows: (string | number | null)[][] = [
    // Header
    ['#', 'Date', 'Supplier / Vendor', 'Description', 'Category', 'Account Code',
     'Amount (RM)', 'Notes', 'Created At'],
  ];

  receipts.forEach((r, i) => {
    rows.push([
      i + 1,
      r.date,
      r.supplier,
      r.description || '',
      CATEGORIES[r.category]?.label || r.category,
      r.accountCode || '',
      r.amount,
      r.notes || '',
      new Date(r.createdAt).toLocaleString('en-MY'),
    ]);
  });

  // Summary row
  const total = receipts.reduce((s, r) => s + r.amount, 0);
  rows.push([]);
  rows.push(['TOTAL', '', '', '', '', '', total]);
  rows.push(['Count', receipts.length, '', '', '', '', '']);

  const ws1 = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws1['!cols'] = [
    { wch: 5 },   // #
    { wch: 14 },  // Date
    { wch: 28 },  // Supplier
    { wch: 30 },  // Description
    { wch: 22 },  // Category
    { wch: 14 },  // Account
    { wch: 14 },  // Amount
    { wch: 30 },  // Notes
    { wch: 20 },  // Created
  ];

  // ── Sheet 2: Summary by Category ──────────────────────────
  const categoryMap = new Map<string, { count: number; total: number }>();
  for (const r of receipts) {
    const cat = CATEGORIES[r.category]?.label || r.category;
    const existing = categoryMap.get(cat) || { count: 0, total: 0 };
    existing.count++;
    existing.total += r.amount;
    categoryMap.set(cat, existing);
  }

  const summaryRows: (string | number)[][] = [
    ['Category', 'Receipt Count', 'Total Amount (RM)'],
  ];
  let grandTotal = 0;
  let grandCount = 0;
  categoryMap.forEach((val, cat) => {
    summaryRows.push([cat, val.count, Math.round(val.total * 100) / 100]);
    grandTotal += val.total;
    grandCount += val.count;
  });
  summaryRows.push([]);
  summaryRows.push(['GRAND TOTAL', grandCount, Math.round(grandTotal * 100) / 100]);

  const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws2['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 18 }];

  // ── Create Workbook ───────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Receipts');
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

  return wb;
}

export async function exportReceipts(options: ExportOptions): Promise<Blob> {
  let receipts: Receipt[];

  if (options.mode === 'date-range') {
    receipts = await getReceiptsByDateRange(options.dateFrom!, options.dateTo!);
  } else if (options.mode === 'category') {
    receipts = await getReceiptsByCategory(options.category!);
  } else {
    receipts = await getAllReceipts();
  }

  if (receipts.length === 0) {
    throw new Error('No receipts found for the selected criteria.');
  }

  const wb = buildWorkbook(receipts);

  // Generate filename
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
  let filename = `BranchScanner_${dateStr}_${timeStr}`;

  if (options.mode === 'date-range') {
    filename = `BranchScanner_${options.dateFrom}_to_${options.dateTo}`;
  } else if (options.mode === 'category') {
    filename = `BranchScanner_${options.category}_${dateStr}`;
  }
  filename += '.xlsx';

  // Write to buffer then blob
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  return blob;
}

export async function downloadExcel(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);

  // Try Web Share API first (mobile native share)
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Branch Scanner Export',
        text: `Receipt export from Branch Scanner (${new Date().toLocaleDateString('en-MY')})`,
      });
      URL.revokeObjectURL(url);
      return;
    }
  }

  // Fallback: direct download
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
