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
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);

  // ── Extract Date ─────────────────────────────────────────
  // Pattern: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD.MM.YYYY
  const datePatterns = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
    /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
  ];
  let parsedDate: string | undefined;
  for (const line of lines) {
    for (const pattern of datePatterns) {
      const m = line.match(pattern);
      if (m) {
        try {
          let day: string, month: string, year: string;
          if (m[3].length === 4) {
            // YYYY-MM-DD format
            [year, month, day] = [m[1], m[2], m[3]];
          } else {
            [day, month, year] = m[1][0] === '0' ? [m[1], m[2], m[3]] : [m[1], m[2], m[3]];
            // Handle year as 2 digits
            year = year.length === 2 ? `20${year}` : year;
          }
          month = month.padStart(2, '0');
          day = day.padStart(2, '0');
          const d = new Date(`${year}-${month}-${day}`);
          if (!isNaN(d.getTime())) {
            parsedDate = `${year}-${month}-${day}`;
            break;
          }
        } catch (_) {}
      }
    }
    if (parsedDate) break;
  }

  // ── Extract Amount ───────────────────────────────────────
  // Pattern: RM followed by number, or number ending with .00 / .XX
  const amountPatterns = [
    /RM\s*([\d,]+\.?\d*)/i,
    /([\d,]+\.\d{2})/,
    /([\d,]+\.00)/,
  ];
  let parsedAmount: number | undefined;
  let amountLine = '';
  for (const line of lines) {
    for (const pattern of amountPatterns) {
      const m = line.match(pattern);
      if (m) {
        const raw = m[1].replace(/,/g, '');
        const val = parseFloat(raw);
        if (!isNaN(val) && val > 0 && val < 10000000) {
          parsedAmount = Math.round(val * 100) / 100;
          amountLine = line;
          break;
        }
      }
    }
    if (parsedAmount !== undefined) break;
  }

  // ── Extract Supplier ─────────────────────────────────────
  // First non-empty line that looks like a business name
  let parsedSupplier: string | undefined;
  const skipWords = ['receipt', 'invoice', 'tax', 'total', 'subtotal', 'gst', 'rm', 'date', 'time', 'cash', 'card', 'change', 'thank', 'welcome'];
  for (const line of lines.slice(0, 5)) {
    const lower = line.toLowerCase();
    const looksLikeBusiness = !skipWords.some(w => lower.includes(w)) &&
      line.length > 3 &&
      !/^[\d\.\-\/\:]+$/.test(line) &&
      !/^(total|amount|tax|sub|thank|welcome)/i.test(line);

    if (looksLikeBusiness) {
      // Clean up the business name
      parsedSupplier = line
        .replace(/[^\w\s&\-\.\'@]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      break;
    }
  }

  // ── Extract Description ─────────────────────────────────
  // Usually contains product/item keywords near the amount
  let parsedDescription = '';
  if (amountLine && amountLine !== parsedSupplier) {
    parsedDescription = amountLine.slice(0, 80);
  }

  return { date: parsedDate, amount: parsedAmount, supplier: parsedSupplier, description: parsedDescription };
}
