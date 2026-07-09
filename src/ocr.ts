// ===== TESSERACT.JS OCR SERVICE =====

import Tesseract, { createWorker, Worker } from 'tesseract.js';
import type { OCRResult } from './types';

let workerInstance: Worker | null = null;
let isInitializing = false;
let initPromise: Promise<Worker> | null = null;

// Language: English (good for Malaysian receipts which often have English text)
const OCR_LANGUAGE = 'eng';

async function getWorker(): Promise<Worker> {
  if (workerInstance) return workerInstance;
  if (isInitializing && initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    const worker = await createWorker(OCR_LANGUAGE, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          // Dispatch progress event for UI
          window.dispatchEvent(new CustomEvent('ocr-progress', {
            detail: { progress: m.progress }
          }));
        }
      },
    });
    workerInstance = worker;
    return worker;
  })();

  return initPromise;
}

export async function initializeOCR(): Promise<void> {
  await getWorker();
}

export async function terminateOCR(): Promise<void> {
  if (workerInstance) {
    await workerInstance.terminate();
    workerInstance = null;
    isInitializing = false;
    initPromise = null;
  }
}

export async function scanReceipt(
  imageData: string | HTMLImageElement | HTMLCanvasElement | File,
  onProgress?: (progress: number) => void
): Promise<OCRResult> {
  // Listen for progress events
  const progressHandler = (e: Event) => {
    const customEvent = e as CustomEvent<{ progress: number }>;
    onProgress?.(customEvent.detail.progress);
  };
  window.addEventListener('ocr-progress', progressHandler);

  try {
    const worker = await getWorker();

    let imageSource: string | File;
    if (imageData instanceof File) {
      imageSource = imageData;
    } else if (typeof imageData === 'string') {
      imageSource = imageData;
    } else {
      // HTMLImageElement or HTMLCanvasElement - convert to data URL
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      if (imageData instanceof HTMLImageElement) {
        canvas.width = imageData.naturalWidth;
        canvas.height = imageData.naturalHeight;
      } else {
        canvas.width = imageData.width;
        canvas.height = imageData.height;
      }
      ctx.drawImage(imageData, 0, 0);
      imageSource = canvas.toDataURL('image/jpeg', 0.9);
    }

    const result = await worker.recognize(imageSource);
    const rawText = result.data.text.trim();
    const confidence = result.data.confidence;

    // Parse structured data from raw text
    const parsed = parseReceiptText(rawText);

    return { rawText, confidence, parsed };
  } finally {
    window.removeEventListener('ocr-progress', progressHandler);
  }
}

function parseReceiptText(text: string): OCRResult['parsed'] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const cleanLines = lines.filter(l => l.length > 2);

  // ── Extract Date ─────────────────────────────────────────
  // Look for a labeled date first ("Date: 09/07/2026"), then any date in the
  // top 10 lines. This avoids catching transaction IDs / phone numbers that
  // happen to look like dates.
  let parsedDate: string | undefined;
  for (const line of cleanLines.slice(0, 10)) {
    // Labeled: "Date: 09/07/26" or "Dated 09-07-2026"
    const labeled = line.match(/(?:date|dated)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
    if (labeled) {
      parsedDate = normalizeDate(labeled[1]);
      if (parsedDate) break;
    }
  }
  if (!parsedDate) {
    for (const line of cleanLines.slice(0, 10)) {
      const m = line.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
      if (m) {
        parsedDate = normalizeDate(m[1]);
        if (parsedDate) break;
      }
    }
  }

  // ── Extract Supplier ─────────────────────────────────────
  // First non-trivial line in the header that looks like a business name.
  let parsedSupplier: string | undefined;
  const skipWords = ['receipt', 'invoice', 'tax', 'total', 'subtotal', 'gst', 'sst', 'rm',
                     'cash', 'card', 'change', 'thank', 'welcome', 'address', 'tel', 'phone',
                     'no.', 'no ', 'bill', 'order', 'ref'];
  for (const line of cleanLines.slice(0, 5)) {
    const lower = line.toLowerCase();
    if (skipWords.some(w => lower.includes(w))) continue;
    if (/^[\d\.\-\/\:\s]+$/.test(line)) continue;   // digits / separators only
    if (line.length < 3) continue;
    if (/^(total|amount|tax|sub|thank|welcome|change|cash|card|paid)/i.test(line)) continue;

    parsedSupplier = line
      .replace(/[^\w\s&\-\.\'@]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    break;
  }

  // ── Extract Amount (TOTAL-aware, multi-line safe) ────────
  // Strategy:
  //   1. Look for a line containing TOTAL / GRAND TOTAL / AMOUNT DUE / NET TOTAL / PAYABLE
  //   2. If a number sits on the same line, use it. Otherwise the next line.
  //   3. Fall back to a line with explicit "RM" prefix.
  //   4. Last resort: largest .XX number (typical total has 2 decimals).
  let parsedAmount: number | undefined;
  let totalLine = '';
  const totalKeywords = /^(total|grand\s*total|net\s*total|net\s*amount|amount\s*due|amount\s*payable|amount|payable|to\s*pay|balance\s*due|final\s*total|due\s*amount)/i;

  for (let i = cleanLines.length - 1; i >= 0; i--) {
    const line = cleanLines[i];
    if (!totalKeywords.test(line)) continue;

    // Try same line
    const same = line.match(/([\d,]+\.?\d*)/g);
    if (same) {
      for (const s of same.reverse()) {
        const val = parseFloat(s.replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          parsedAmount = Math.round(val * 100) / 100;
          totalLine = line;
          break;
        }
      }
    }
    if (parsedAmount !== undefined) break;

    // Try next line (TOTAL often on its own line)
    if (i + 1 < cleanLines.length) {
      const next = cleanLines[i + 1];
      const m = next.match(/([\d,]+\.?\d*)/);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          parsedAmount = Math.round(val * 100) / 100;
          totalLine = next;
          break;
        }
      }
    }
  }

  // Fallback 1: explicit "RM" anywhere
  if (parsedAmount === undefined) {
    for (const line of cleanLines) {
      const rm = line.match(/RM\s*([\d,]+\.?\d*)/i);
      if (rm) {
        const val = parseFloat(rm[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          parsedAmount = Math.round(val * 100) / 100;
          totalLine = line;
          break;
        }
      }
    }
  }

  // Fallback 2: last .XX number on the receipt (typical total)
  if (parsedAmount === undefined) {
    for (let i = cleanLines.length - 1; i >= 0; i--) {
      const m = cleanLines[i].match(/([\d,]+\.\d{2})\b/);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          parsedAmount = Math.round(val * 100) / 100;
          totalLine = cleanLines[i];
          break;
        }
      }
    }
  }

  // ── Extract Description (collect line items) ─────────────
  // Build a short description from multi-line item blocks.
  // Strategy: Look for a line that is followed (within 1-2 lines) by a
  // "qty × price" pattern. This handles:
  //   - Normal items: ItemName → 1x4.00 4.00
  //   - Items with barcodes: ItemName → BARCODE UNIT → 1x12.50 12.50
  //   - Restaurant items: ItemName → 1 x 8.50 8.50
  // Skip header lines (tel, date, invoice), barcode lines (>65% digits),
  // and total/tax lines.
  const lineItems: string[] = [];
  const excludeKeywords = /^(sub\s*total|subtotal|total|grand\s*total|tax|gst|sst|amount\s*due|cash\s*tendered|cash|card|change|paid|balance|net|payable|to\s*pay|round|item\s+\d|qty|saving)/i;
  const headerKeywords = /^(receipt|invoice|tax|tel|phone|address|date|bill|order|ref|no\.|welcome|thank|card|cash|change)/i;

  // Skip lines where >65% of non-space chars are digits (barcodes, EAN codes)
  const isBarcode = (s: string): boolean => {
    const digits = (s.match(/\d/g) || []).length;
    const total = s.replace(/\s/g, '').length;
    return total > 0 && digits / total > 0.65;
  };

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (line.length < 3) continue;
    if (line === totalLine) continue;
    if (!/[A-Za-z\s\-\'\.\&]/.test(line)) continue;   // must have letters/word chars
    if (isBarcode(line)) continue;                         // skip barcode/UNIT lines
    if (excludeKeywords.test(line)) continue;               // skip total/tax lines
    if (headerKeywords.test(line)) continue;                // skip header lines

    // Look ahead up to 2 lines for a qty × price pattern
    let priceVal = '';
    for (let j = 1; j <= 2 && i + j < cleanLines.length; j++) {
      const next = cleanLines[i + j];
      if (/\d+\s*[xX]\s*[\d,]+\.?\d*/.test(next)) {
        const m = next.match(/([\d,]+\.\d{2})\s*$/);
        if (m) { priceVal = m[1]; break; }
      }
    }

    if (priceVal) {
      const cleaned = line.replace(/\s+/g, ' ').trim();
      if (cleaned.length > 0 && cleaned.length < 80) {
        lineItems.push(`${cleaned} (${priceVal})`);
      }
    }
  }

  let parsedDescription = '';
  if (lineItems.length > 0) {
    parsedDescription = lineItems.slice(0, 8).join(' | ').slice(0, 250);
  } else if (totalLine) {
    parsedDescription = totalLine.slice(0, 80);
  }

  return { date: parsedDate, amount: parsedAmount, supplier: parsedSupplier, description: parsedDescription };
}

function normalizeDate(dateStr: string): string | undefined {
  const m = dateStr.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (!m) return undefined;
  let p1 = m[1], p2 = m[2], p3 = m[3];
  // YYYY-MM-DD
  if (p1.length === 4) {
    return `${p1}-${p2.padStart(2, '0')}-${p3.padStart(2, '0')}`;
  }
  // DD/MM/YYYY (Malaysian convention)
  let day = p1, month = p2, year = p3;
  if (year.length === 2) year = `20${year}`;
  if (parseInt(month, 10) > 12) {
    // Looks like MM/DD/YYYY instead - swap
    [day, month] = [month, day];
  }
  const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  if (isNaN(d.getTime())) return undefined;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
