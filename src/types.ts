// ===== RECEIPT DATA MODEL =====

export interface Receipt {
  id?: number;                  // Auto-increment primary key
  date: string;                // ISO date string (YYYY-MM-DD)
  supplier: string;            // Supplier/vendor name
  description: string;          // Receipt description (all items joined)
  amount: number;              // Total amount from receipt
  category: string;            // Category key
  accountCode: string;         // Optional account code
  notes: string;               // Additional notes
  imageData?: string;         // Base64 image (optional)
  ocrConfidence?: number;      // OCR confidence 0-100
  createdAt: number;           // Unix timestamp
  updatedAt: number;           // Unix timestamp
}

export interface OCRResult {
  rawText: string;
  confidence: number;
  parsed: {
    date?: string;
    amount?: number;           // Total amount (from bottom of receipt)
    supplier?: string;
    description?: string;      // All items joined with " | "
  };
}

export interface ExportOptions {
  mode: 'all' | 'date-range' | 'category';
  dateFrom?: string;
  dateTo?: string;
  category?: string;
}

export const CATEGORIES: Record<string, { label: string; accountDefault?: string }> = {
  fuel:        { label: '⛽ Fuel / Petrol',         accountDefault: '901-000' },
  food:        { label: '🍔 Food & Beverages',      accountDefault: '903-000' },
  office:      { label: '📎 Office Supplies',        accountDefault: '902-000' },
  utilities:   { label: '💡 Utilities',               accountDefault: '904-000' },
  transport:   { label: '🚗 Transport / Logistics',  accountDefault: '905-000' },
  maintenance: { label: '🔧 Maintenance / Repair',   accountDefault: '906-000' },
  salary:      { label: '💰 Salary / Wages',        accountDefault: '910-000' },
  rental:      { label: '🏠 Rental',                 accountDefault: '915-000' },
  insurance:   { label: '🛡️ Insurance',              accountDefault: '920-000' },
  marketing:   { label: '📢 Marketing / Advertising',accountDefault: '930-000' },
  telecom:     { label: '📱 Telecommunications',    accountDefault: '907-000' },
  medical:     { label: '🏥 Medical / Healthcare',   accountDefault: '908-000' },
  other:       { label: '📦 Other',                  accountDefault: '' },
};
