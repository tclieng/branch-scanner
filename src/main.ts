// ===== BRANCH SCANNER - MAIN ENTRY POINT =====

import './style.css';
import type { Receipt, ExportOptions } from './types';
import { CATEGORIES } from './types';
import * as db from './database';
import { scanReceipt, initializeOCR } from './ocr';
import { exportReceipts, shareToGmail, HQ_GMAIL } from './excel';
import { compressImage, estimateSize } from './imageUtil';

// ── State ──────────────────────────────────────────────────
let currentImageDataUrl: string = '';
let pendingReceiptId: number | null = null;
let pendingDeleteId: number | null = null;
let pendingDeleteFn: (() => Promise<void>) | null = null;

// ── Initialize ─────────────────────────────────────────────
async function init() {
  console.log('[BranchScanner] Starting up...');

  // Pre-warm OCR (download language model in background)
  initializeOCR().catch(console.error);

  // Set today's date as default
  const today = new Date().toISOString().slice(0, 10);
  (document.getElementById('field-date') as HTMLInputElement).value = today;
  (document.getElementById('export-date-from') as HTMLInputElement).value = today.slice(0, 7) + '-01';
  (document.getElementById('export-date-to') as HTMLInputElement).value = today;

  bindEvents();
  await refreshReceiptList();
  await updateStats();

  console.log('[BranchScanner] Ready!');
}

// ── Navigation ─────────────────────────────────────────────
function showView(viewId: string) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');
  document.getElementById(`nav-${viewId}`)?.classList.add('active');
}

// ── Event Bindings ──────────────────────────────────────────
function bindEvents() {
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = (btn as HTMLElement).dataset.view;
      if (view) showView(view);
    });
  });

  // Header export shortcut → go to export view
  document.getElementById('btn-export')?.addEventListener('click', () => showView('export'));

  // Capture button
  document.getElementById('btn-capture')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });

  // File input change
  document.getElementById('file-input')?.addEventListener('change', handleFileSelect);

  // Retake
  document.getElementById('btn-retake')?.addEventListener('click', resetScan);

  // Form
  document.getElementById('receipt-form-el')?.addEventListener('submit', handleFormSubmit);
  document.getElementById('btn-cancel-form')?.addEventListener('click', resetScan);

  // Receipt list
  document.getElementById('search-input')?.addEventListener('input', debounce(refreshReceiptList, 300));
  document.getElementById('filter-category')?.addEventListener('change', refreshReceiptList);

  // Export options
  document.getElementById('export-all')?.addEventListener('click', () => handleExport('all'));
  document.getElementById('export-date-range')?.addEventListener('click', toggleDateRangePanel);
  document.getElementById('export-category')?.addEventListener('click', toggleCategoryPanel);
  document.getElementById('btn-export-date-range')?.addEventListener('click', () => handleExport('date-range'));
  document.getElementById('btn-export-category')?.addEventListener('click', () => handleExport('category'));

  // Clear DB
  document.getElementById('btn-clear-db')?.addEventListener('click', handleClearDB);

  // Confirm dialog
  document.getElementById('confirm-cancel')?.addEventListener('click', hideConfirmDialog);
  document.getElementById('confirm-ok')?.addEventListener('click', () => {
    if (pendingDeleteFn) {
      pendingDeleteFn().then(() => {
        hideConfirmDialog();
        pendingDeleteFn = null;
      }).catch(console.error);
    } else {
      hideConfirmDialog();
    }
  });

  // Receipt modal
  document.getElementById('modal-close')?.addEventListener('click', hideReceiptModal);
  document.getElementById('modal-delete')?.addEventListener('click', () => {
    if (pendingReceiptId !== null) {
      showConfirmDialog('Delete this receipt?', async () => {
        await db.deleteReceipt(pendingReceiptId!);
        pendingReceiptId = null;
        hideReceiptModal();
        await refreshReceiptList();
        await updateStats();
        showToast('Receipt deleted', 'success');
      });
    }
  });
  document.getElementById('modal-share')?.addEventListener('click', async () => {
    if (pendingReceiptId !== null) {
      const r = await db.getReceipt(pendingReceiptId);
      if (r) {
        const text = `Receipt #${r.id}\nDate: ${r.date}\nSupplier: ${r.supplier}\nAmount: RM ${r.amount.toFixed(2)}\nCategory: ${CATEGORIES[r.category]?.label || r.category}\n${r.description ? 'Description: ' + r.description : ''}`;
        if (navigator.share) {
          await navigator.share({ title: 'Branch Scanner Receipt', text });
        } else {
          await navigator.clipboard.writeText(text);
          showToast('Copied to clipboard', 'success');
        }
      }
    }
  });

  // Modal backdrop click to close
  document.getElementById('receipt-modal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('receipt-modal')) hideReceiptModal();
  });
  document.getElementById('confirm-dialog')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('confirm-dialog')) hideConfirmDialog();
  });
}

// ── File / Camera Handling ──────────────────────────────────
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    currentImageDataUrl = ev.target?.result as string;
    showPreview(currentImageDataUrl);
    await runOCR(currentImageDataUrl);
  };
  reader.onerror = () => showToast('Failed to read image', 'error');
  reader.readAsDataURL(file);

  // Reset input so same file can be selected again
  input.value = '';
}

function showPreview(dataUrl: string) {
  document.getElementById('camera-placeholder')?.classList.add('hidden');
  document.getElementById('preview-container')?.classList.remove('hidden');
  document.getElementById('receipt-form')?.classList.add('hidden');
  document.getElementById('ocr-status')?.classList.add('hidden');

  const img = document.getElementById('preview-image') as HTMLImageElement;
  if (img) img.src = dataUrl;
}

function resetScan() {
  currentImageDataUrl = '';
  document.getElementById('camera-placeholder')?.classList.remove('hidden');
  document.getElementById('preview-container')?.classList.add('hidden');
  document.getElementById('receipt-form')?.classList.add('hidden');
  document.getElementById('ocr-status')?.classList.add('hidden');
  document.getElementById('ocr-progress-fill')!.style.width = '0%';
}

// ── OCR Processing ───────────────────────────────────────────
async function runOCR(imageDataUrl: string) {
  const statusEl = document.getElementById('ocr-status')!;
  const statusTextEl = document.getElementById('ocr-status-text')!;
  const progressEl = document.getElementById('ocr-progress-fill')!;

  statusEl.classList.remove('hidden');
  statusTextEl.textContent = 'Initializing OCR engine...';
  progressEl.style.width = '5%';

  try {
    // Progress listener
    const onProgress = (progress: number) => {
      progressEl.style.width = `${Math.round(progress * 80 + 10)}%`;
      const pct = Math.round(progress * 100);
      statusTextEl.textContent = `Scanning receipt... ${pct}%`;
    };

    const result = await scanReceipt(imageDataUrl, onProgress);
    progressEl.style.width = '100%';
    statusTextEl.textContent = 'Done!';

    setTimeout(() => {
      statusEl.classList.add('hidden');
      populateForm(result, imageDataUrl);
    }, 400);

  } catch (err) {
    console.error('[OCR Error]', err);
    statusEl.classList.add('hidden');
    showToast('OCR failed. Try a clearer photo.', 'error');
    // Still show the form, let user fill manually
    populateForm({ rawText: '', confidence: 0, parsed: {} }, imageDataUrl);
  }
}

function populateForm(ocrResult: { rawText: string; confidence: number; parsed: any }, imageDataUrl: string) {
  const form = document.getElementById('receipt-form')!;
  form.classList.remove('hidden');

  // Date
  const dateField = document.getElementById('field-date') as HTMLInputElement;
  if (ocrResult.parsed.date) {
    dateField.value = ocrResult.parsed.date;
  } else {
    dateField.value = new Date().toISOString().slice(0, 10);
  }

  // Supplier
  const supplierField = document.getElementById('field-supplier') as HTMLInputElement;
  supplierField.value = ocrResult.parsed.supplier || '';
  supplierField.focus();

  // Amount
  const amountField = document.getElementById('field-amount') as HTMLInputElement;
  if (ocrResult.parsed.amount !== undefined) {
    amountField.value = String(ocrResult.parsed.amount);
  } else {
    amountField.value = '';
  }

  // Description
  (document.getElementById('field-description') as HTMLInputElement).value = ocrResult.parsed.description || '';

  // Store image data
  (document.getElementById('field-image-data') as HTMLInputElement).value = imageDataUrl;

  // Confidence badge
  const confidenceEl = document.getElementById('ocr-confidence')!;
  const confidenceTextEl = document.getElementById('confidence-text')!;
  const conf = Math.round(ocrResult.confidence);
  if (conf > 60) {
    confidenceEl.className = 'confidence-badge confidence-high';
    confidenceTextEl.textContent = `🟢 OCR Confidence: ${conf}%`;
  } else if (conf > 30) {
    confidenceEl.className = 'confidence-badge confidence-medium';
    confidenceTextEl.textContent = `🟡 OCR Confidence: ${conf}%`;
  } else if (conf > 0) {
    confidenceEl.className = 'confidence-badge confidence-low';
    confidenceTextEl.textContent = `🔴 OCR Confidence: ${conf}% — please verify`;
  } else {
    confidenceEl.className = 'hidden';
  }
  confidenceEl.classList.remove('hidden');

  // Scroll form into view
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Form Submission ─────────────────────────────────────────
async function handleFormSubmit(e: Event) {
  e.preventDefault();

  const receipt: Omit<Receipt, 'id'> = {
    date: (document.getElementById('field-date') as HTMLInputElement).value,
    supplier: (document.getElementById('field-supplier') as HTMLInputElement).value.trim(),
    description: (document.getElementById('field-description') as HTMLInputElement).value.trim(),
    amount: parseFloat((document.getElementById('field-amount') as HTMLInputElement).value) || 0,
    category: (document.getElementById('field-category') as HTMLSelectElement).value,
    accountCode: (document.getElementById('field-account') as HTMLInputElement).value.trim(),
    notes: (document.getElementById('field-notes') as HTMLTextAreaElement).value.trim(),
    imageData: (document.getElementById('field-image-data') as HTMLInputElement).value || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (!receipt.date || !receipt.supplier || !receipt.amount || !receipt.category) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  const saveBtn = document.getElementById('btn-save-receipt') as HTMLButtonElement;
  saveBtn.disabled = true;
  saveBtn.textContent = '💾 Saving...';

  try {
    // Compress image before save to avoid Android WebView IndexedDB quota
    if (receipt.imageData && receipt.imageData.startsWith('data:image')) {
      const before = estimateSize(receipt.imageData);
      receipt.imageData = await compressImage(receipt.imageData, 1024, 0.7);
      const after = estimateSize(receipt.imageData);
      console.log(`[Image] compressed ${before} → ${after}`);
    }
    await db.addReceipt(receipt);
    showToast('Receipt saved successfully!', 'success');
    try { resetScan(); } catch (e: any) { throw new Error(`resetScan: ${e.message}`); }
    try { await refreshReceiptList(); } catch (e: any) { throw new Error(`refreshReceiptList: ${e.message}`); }
    try { await updateStats(); } catch (e: any) { throw new Error(`updateStats: ${e.message}`); }
    try { showView('list'); } catch (e: any) { throw new Error(`showView: ${e.message}`); }
  } catch (err: any) {
    console.error('[Save Error]', err);
    const msg = err?.message || err?.name || 'Unknown error';
    showToast(`❌ Save failed: ${msg}`, 'error', 6000);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Receipt';
  }
}

// ── Receipt List ─────────────────────────────────────────────
async function refreshReceiptList() {
  const searchQuery = (document.getElementById('search-input') as HTMLInputElement).value;
  const categoryFilter = (document.getElementById('filter-category') as HTMLSelectElement).value;

  const receipts = await db.searchReceipts(searchQuery, categoryFilter);

  const listEl = document.getElementById('receipt-list')!;
  const emptyEl = document.getElementById('empty-list')!;

  if (receipts.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    emptyEl.style.display = 'block';
    document.getElementById('summary-count')!.textContent = '0 receipts';
    document.getElementById('summary-total')!.textContent = 'RM 0.00';
    return;
  }

  emptyEl.classList.add('hidden');

  const total = receipts.reduce((s, r) => s + r.amount, 0);
  document.getElementById('summary-count')!.textContent = `${receipts.length} receipt${receipts.length !== 1 ? 's' : ''}`;
  document.getElementById('summary-total')!.textContent = `RM ${total.toFixed(2)}`;

  listEl.innerHTML = receipts.map(r => {
    const catLabel = CATEGORIES[r.category]?.label.split(' ').slice(1).join(' ') || r.category;
    return `
      <div class="receipt-card" data-id="${r.id}">
        <div class="receipt-card-header">
          <span class="receipt-supplier">${escapeHtml(r.supplier)}</span>
          <span class="receipt-amount">RM ${r.amount.toFixed(2)}</span>
        </div>
        <div class="receipt-card-meta">
          <span class="receipt-date">${formatDate(r.date)}</span>
          <span class="receipt-tag">${escapeHtml(catLabel)}</span>
          ${r.accountCode ? `<span class="receipt-account">A/C ${escapeHtml(r.accountCode)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Bind click events
  listEl.querySelectorAll('.receipt-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt((card as HTMLElement).dataset.id!);
      showReceiptModal(id);
    });
  });
}

async function showReceiptModal(id: number) {
  pendingReceiptId = id;
  const r = await db.getReceipt(id);
  if (!r) return;

  const catLabel = CATEGORIES[r.category]?.label || r.category;

  document.getElementById('modal-title')!.textContent = `Receipt #${r.id}`;
  const body = document.getElementById('modal-body')!;
  body.innerHTML = `
    ${r.imageData ? `<img src="${r.imageData}" class="modal-image" alt="Receipt" />` : ''}
    <div class="modal-row"><strong>Date</strong><span>${formatDate(r.date)}</span></div>
    <div class="modal-row"><strong>Supplier</strong><span>${escapeHtml(r.supplier)}</span></div>
    <div class="modal-row"><strong>Amount</strong><span style="color:var(--primary);font-weight:800">RM ${r.amount.toFixed(2)}</span></div>
    <div class="modal-row"><strong>Category</strong><span>${escapeHtml(catLabel)}</span></div>
    ${r.accountCode ? `<div class="modal-row"><strong>Account</strong><span>${escapeHtml(r.accountCode)}</span></div>` : ''}
    ${r.description ? `<div class="modal-row"><strong>Description</strong><span>${escapeHtml(r.description)}</span></div>` : ''}
    ${r.notes ? `<div class="modal-row"><strong>Notes</strong><span>${escapeHtml(r.notes)}</span></div>` : ''}
    <div class="modal-row"><strong>Recorded</strong><span>${new Date(r.createdAt).toLocaleString('en-MY')}</span></div>
  `;

  document.getElementById('receipt-modal')!.classList.remove('hidden');
}

function hideReceiptModal() {
  document.getElementById('receipt-modal')!.classList.add('hidden');
  pendingReceiptId = null;
}

// ── Export ──────────────────────────────────────────────────
function toggleDateRangePanel() {
  document.getElementById('date-range-panel')?.classList.toggle('hidden');
  document.getElementById('category-panel')?.classList.add('hidden');
}

function toggleCategoryPanel() {
  document.getElementById('category-panel')?.classList.toggle('hidden');
  document.getElementById('date-range-panel')?.classList.add('hidden');
}

async function handleExport(mode: ExportOptions['mode']) {
  const options: ExportOptions = { mode };

  if (mode === 'date-range') {
    options.dateFrom = (document.getElementById('export-date-from') as HTMLInputElement).value;
    options.dateTo = (document.getElementById('export-date-to') as HTMLInputElement).value;
    if (!options.dateFrom || !options.dateTo) {
      showToast('Please select a date range', 'error');
      return;
    }
  } else if (mode === 'category') {
    options.category = (document.getElementById('export-category-select') as HTMLSelectElement).value;
    if (!options.category) {
      showToast('Please select a category', 'error');
      return;
    }
  }

  const successEl = document.getElementById('export-success')!;
  const errorEl = document.getElementById('export-error')!;
  successEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  document.getElementById('export-result')?.classList.remove('hidden');

  try {
    const blob = await exportReceipts(options);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    let filename = `BranchScanner_${dateStr}_${timeStr}.xlsx`;
    if (mode === 'date-range') filename = `BranchScanner_${options.dateFrom}_to_${options.dateTo}.xlsx`;
    if (mode === 'category') filename = `BranchScanner_${options.category}_${dateStr}.xlsx`;

    // Build auto-filled email subject + body
    const dateLabel =
      mode === 'date-range'
        ? `${options.dateFrom} to ${options.dateTo}`
        : mode === 'category'
          ? (CATEGORIES[options.category!]?.label || options.category!)
          : 'all records';
    const subject = `Branch Scanner Report - ${new Date().toLocaleDateString('en-MY')}`;
    const body =
      `Hi HQ,\n\nBranch collection report for ${dateLabel} is attached.\n\nRegards,\nBranch Team`;

    const attached = await shareToGmail(blob, filename, { email: HQ_GMAIL, subject, body });
    successEl.classList.remove('hidden');
    if (attached) {
      successEl.textContent = `✅ Gmail opened with ${filename} attached (${HQ_GMAIL})!`;
    } else {
      successEl.textContent = `📥 ${filename} downloaded — attach it to the Gmail window that just opened (${HQ_GMAIL})`;
    }
  } catch (err: any) {
    errorEl.classList.remove('hidden');
    errorEl.textContent = `❌ ${err.message || 'Export failed. Please try again.'}`;
    console.error('[Export Error]', err);
  }
}

// ── Stats ───────────────────────────────────────────────────
async function updateStats() {
  const stats = await db.getReceiptStats();
  document.getElementById('stat-total')!.textContent = String(stats.total);
  document.getElementById('stat-amount')!.textContent = `RM ${stats.totalAmount.toFixed(2)}`;
  document.getElementById('stat-categories')!.textContent = String(stats.categories);
  document.getElementById('stat-storage')!.textContent = stats.storageEstimate;
}

// ── Clear DB ────────────────────────────────────────────────
function handleClearDB() {
  showConfirmDialog('Delete ALL receipts? This cannot be undone.', async () => {
    await db.clearAllReceipts();
    await refreshReceiptList();
    await updateStats();
    showToast('All data cleared', 'success');
  });
}

// ── Confirm Dialog ──────────────────────────────────────────
function showConfirmDialog(message: string, onConfirm: () => Promise<void>) {
  document.getElementById('confirm-message')!.textContent = message;
  pendingDeleteFn = onConfirm;
  document.getElementById('confirm-dialog')!.classList.remove('hidden');
}

function hideConfirmDialog() {
  document.getElementById('confirm-dialog')!.classList.add('hidden');
  pendingDeleteFn = null;
}

// ── Toast ───────────────────────────────────────────────────
let toastTimer: ReturnType<typeof setTimeout>;
function showToast(message: string, type: 'success' | 'error' = 'success', durationMs = 3000) {
  const toast = document.getElementById('toast')!;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, durationMs);
}

// ── Utilities ───────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

// ── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
