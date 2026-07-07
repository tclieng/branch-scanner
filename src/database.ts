// ===== INDEXEDDB DATABASE SERVICE (via Dexie) =====

import Dexie, { Table } from 'dexie';
import type { Receipt } from './types';

class BranchScannerDB extends Dexie {
  receipts!: Table<Receipt, number>;

  constructor() {
    super('BranchScannerDB');
    this.version(1).stores({
      receipts: '++id, date, category, supplier, amount, createdAt',
    });
  }
}

const db = new BranchScannerDB();

// ── CRUD Operations ──────────────────────────────────────

export async function addReceipt(receipt: Omit<Receipt, 'id'>): Promise<number> {
  return db.receipts.add(receipt as Receipt);
}

export async function getReceipt(id: number): Promise<Receipt | undefined> {
  return db.receipts.get(id);
}

export async function getAllReceipts(): Promise<Receipt[]> {
  return db.receipts.orderBy('createdAt').reverse().toArray();
}

export async function searchReceipts(query: string, category?: string): Promise<Receipt[]> {
  const all = await getAllReceipts();
  const q = query.toLowerCase().trim();
  return all.filter(r => {
    const matchesQuery = !q ||
      r.supplier.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q) ||
      r.accountCode.toLowerCase().includes(q) ||
      String(r.amount).includes(q);
    const matchesCategory = !category || r.category === category;
    return matchesQuery && matchesCategory;
  });
}

export async function getReceiptsByDateRange(from: string, to: string): Promise<Receipt[]> {
  return db.receipts
    .where('date')
    .between(from, to, true, true)
    .toArray();
}

export async function getReceiptsByCategory(category: string): Promise<Receipt[]> {
  return db.receipts.where('category').equals(category).toArray();
}

export async function updateReceipt(id: number, changes: Partial<Receipt>): Promise<number> {
  return db.receipts.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteReceipt(id: number): Promise<void> {
  return db.receipts.delete(id);
}

export async function clearAllReceipts(): Promise<void> {
  return db.receipts.clear();
}

export async function getReceiptStats(): Promise<{
  total: number;
  totalAmount: number;
  categories: number;
  storageEstimate: string;
}> {
  const all = await getAllReceipts();
  const uniqueCategories = new Set(all.map(r => r.category));
  const totalAmount = all.reduce((sum, r) => sum + r.amount, 0);

  // Rough storage estimate: ~2KB per receipt + images
  let imageSize = 0;
  for (const r of all) {
    if (r.imageData) imageSize += r.imageData.length * 0.75; // base64 overhead
  }
  const baseSize = all.length * 2048 + imageSize;
  const sizeKB = baseSize / 1024;
  const storageStr = sizeKB > 1024
    ? `~${(sizeKB / 1024).toFixed(1)} MB`
    : `~${Math.round(sizeKB)} KB`;

  return {
    total: all.length,
    totalAmount,
    categories: uniqueCategories.size,
    storageEstimate: storageStr,
  };
}

export { db };
