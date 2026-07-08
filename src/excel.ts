// ===== EXCEL EXPORT SERVICE (SheetJS) =====

import { Capacitor } from '@capacitor/core';
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
      try {
        await navigator.share({
          files: [file],
          title: 'Branch Scanner Export',
          text: `Receipt export from Branch Scanner (${new Date().toLocaleDateString('en-MY')})`,
        });
        return; // blob consumed by share
      } catch {
        // user cancelled — fall through to download
      }
    }
  }

  // Fallback: direct download.
  // Anchor MUST be in the DOM and the object URL must stay alive until the
  // browser has started reading the blob (revoking immediately cancels the
  // download silently in Chrome).
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── HQ WhatsApp number (no +, international format) ──
export const HQ_WHATSAPP = '60168027076';

// ── HQ Gmail address ──
export const HQ_GMAIL = 'sbox2u@gmail.com';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Send the Excel export straight to WhatsApp (HQ).
 * Priority:
 *   1. Native Android plugin → opens WhatsApp with file attached (no picker)
 *   2. Web Share API with file (mobile PWA → tap WhatsApp)
 *   3. Download + open wa.me link (desktop)
 * Returns true if WhatsApp was opened directly.
 */
export async function shareToWhatsApp(blob: Blob, filename: string): Promise<boolean> {
  // 1. Native Android: direct to WhatsApp app (skips OS share sheet)
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      const base64 = await blobToBase64(blob);
      const plugin: any = (Capacitor as any).Plugins?.['ShareWhatsApp'];
      if (plugin?.shareXlsx) {
        await plugin.shareXlsx({ base64, fileName: filename, number: HQ_WHATSAPP });
        return true;
      }
    } catch (e) {
      console.warn('[WhatsApp] native share failed, falling back', e);
    }
  }

  // 2. Web Share API with file (mobile PWA)
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Branch Scanner Export' });
        return true;
      } catch {
        /* user cancelled — fall through to download */
      }
    }
  }

  // 3. Fallback: download + open wa.me so user can attach manually
  downloadExcel(blob, filename);
  const waUrl = `https://wa.me/${HQ_WHATSAPP}?text=${encodeURIComponent(
    `Branch Scanner export: ${filename} (saved to your Downloads folder)`
  )}`;
  window.open(waUrl, '_blank');
  return false;
}

/**
 * Send the Excel export straight to HQ Gmail.
 * Priority:
 *   1. Native Android plugin → opens Gmail with file attached + pre-filled recipient/subject/body (no picker)
 *   2. Web fallback: download file + open Gmail web compose URL (user attaches manually; browsers block mailto attachments)
 * Returns true if Gmail was opened directly with the file attached.
 */
export async function shareToGmail(
  blob: Blob,
  filename: string,
  info?: { email?: string; subject?: string; body?: string }
): Promise<boolean> {
  const email = info?.email || HQ_GMAIL;
  const subject = info?.subject || 'Branch Scanner Report';
  const body = info?.body || '';

  // 1. Native Android: direct to Gmail app (skips OS share sheet)
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      const base64 = await blobToBase64(blob);
      const plugin: any = (Capacitor as any).Plugins?.['ShareGmail'];
      if (plugin?.shareXlsx) {
        await plugin.shareXlsx({ base64, fileName: filename, email, subject, body });
        return true;
      }
    } catch (e) {
      console.warn('[Gmail] native share failed, falling back', e);
    }
  }

  // 2. Mobile PWA: Web Share API attaches the file properly (native share sheet)
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: subject, text: body });
        return true;
      } catch {
        /* user cancelled — fall through to download */
      }
    }
  }

  // 3. Desktop fallback: download file + open Gmail web compose (browser cannot auto-attach)
  downloadExcel(blob, filename);
  const gmailUrl =
    `https://mail.google.com/mail/?view=cm&fs=1` +
    `&to=${encodeURIComponent(email)}` +
    `&su=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  window.open(gmailUrl, '_blank');
  return false;
}
