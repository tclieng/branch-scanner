// ===== TESSERACT.JS OCR SERVICE =====

import Tesseract, { createWorker, Worker } from 'tesseract.js';
import type { OCRResult, LineItem } from './types';

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
  let parsedDate: string | undefined;
  for (const line of cleanLines.slice(0, 15)) {
    const labeled = line.match(/(?:date|dated)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
    if (labeled) {
      parsedDate = normalizeDate(labeled[1]);
      if (parsedDate) break;
    }
  }
  if (!parsedDate) {
    for (const line of cleanLines.slice(0, 15)) {
      const m = line.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
      if (m) {
        parsedDate = normalizeDate(m[1]);
        if (parsedDate) break;
      }
    }
  }

  // ── Extract Supplier ─────────────────────────────────────
  let parsedSupplier: string | undefined;
  const skipWords = ['receipt', 'invoice', 'tax', 'total', 'subtotal', 'gst', 'sst', 'rm',
                     'cash', 'card', 'change', 'thank', 'welcome', 'address', 'tel', 'phone',
                     'no.', 'no ', 'bill', 'order', 'ref'];
  for (const line of cleanLines.slice(0, 5)) {
    const lower = line.toLowerCase();
    if (skipWords.some(w => lower.includes(w))) continue;
    if (/^[\d\.\-\/\:\s]+$/.test(line)) continue;
    if (line.length < 3) continue;
    if (/^(total|amount|tax|sub|thank|welcome|change|cash|card|paid)/i.test(line)) continue;

    parsedSupplier = line
      .replace(/[^\w\s&\-\.\'@]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    break;
  }

  // ── Extract TOTAL Amount (from bottom of receipt) ────────
  let parsedAmount: number | undefined;
  let totalLine = '';
  const totalKeywords = /^(total|grand\s*total|net\s*total|net\s*amount|amount\s*due|amount\s*payable|amount|payable|to\s*pay|balance\s*due|final\s*total|due\s*amount)/i;

  for (let i = cleanLines.length - 1; i >= 0; i--) {
    const line = cleanLines[i];
    if (!totalKeywords.test(line)) continue;

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

  // ── Extract Line Items (for multi-page entry) ────────────
  const lineItems: LineItem[] = [];
  const excludeKeywords = /^(sub\s*total|subtotal|total|grand\s*total|tax|gst|sst|amount\s*due|cash\s*tendered|cash|card|change|paid|balance|net|payable|to\s*pay|round|item\s+\d|qty|saving)/i;
  const headerKeywords = /^(receipt|invoice|tax|tel|phone|address|date|bill|order|ref|no\.|welcome|thank|card|cash|change)/i;

  const isBarcode = (s: string): boolean => {
    const digits = (s.match(/\d/g) || []).length;
    const total = s.replace(/\s/g, '').length;
    return total > 0 && digits / total > 0.65;
  };

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (line.length < 3) continue;
    if (line === totalLine) continue;
    if (!/[A-Za-z\s\-\'\.\&]/.test(line)) continue;
    if (isBarcode(line)) continue;
    if (excludeKeywords.test(line)) continue;
    if (headerKeywords.test(line)) continue;

    // Look ahead for qty × price pattern
    for (let j = 1; j <= 2 && i + j < cleanLines.length; j++) {
      const next = cleanLines[i + j];
      const qtyPriceMatch = next.match(/(\d+)\s*[xX]\s*([\d,]+\.?\d*)\s+([\d,]+\.\d{2})/);
      if (qtyPriceMatch) {
        const qty = parseInt(qtyPriceMatch[1], 10);
        const unitPrice = parseFloat(qtyPriceMatch[2].replace(/,/g, ''));
        const lineTotal = parseFloat(qtyPriceMatch[3].replace(/,/g, ''));
        const cleaned = line.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 0 && cleaned.length < 80) {
          lineItems.push({ name: cleaned, quantity: qty, unitPrice, lineTotal });
        }
        break;
      }
      // Alternative: just price at end (restaurant style)
      const simplePriceMatch = next.match(/([\d,]+\.\d{2})\s*$/);
      if (simplePriceMatch && /\d+\s*[xX]/.test(next)) {
        const lineTotal = parseFloat(simplePriceMatch[1].replace(/,/g, ''));
        const cleaned = line.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 0 && cleaned.length < 80) {
          lineItems.push({ name: cleaned, lineTotal });
        }
        break;
      }
    }
  }

  // Generate receipt group ID for this scan
  const receiptGroupId = `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Build fallback description if no line items parsed
  let parsedDescription = '';
  if (lineItems.length === 0 && totalLine) {
    parsedDescription = totalLine.slice(0, 80);
  }

  return {
    date: parsedDate,
    amount: parsedAmount,
    supplier: parsedSupplier,
    description: parsedDescription,
    lineItems: lineItems.length > 0 ? lineItems : undefined,
    receiptGroupId
  };
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
