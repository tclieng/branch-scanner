// ===== RECEIPT DATA MODEL =====

export interface Receipt {
  id?: number;                  // Auto-increment primary key
  date: string;                // ISO date string (YYYY-MM-DD)
  supplier: string;            // Supplier/vendor name
  description: string;          // Receipt description (item name)
  amount: number;              // Amount in RM (line item amount)
  category: string;            // Category key
  accountCode: string;         // Optional account code
  notes: string;               // Additional notes
  imageData?: string;         // Base64 image (optional)
  ocrConfidence?: number;      // OCR confidence 0-100
  receiptGroupId?: string;     // Groups line items from same receipt scan
  isTotalRow?: boolean;        // True if this is the summary/total row
  createdAt: number;           // Unix timestamp
  updatedAt: number;           // Unix timestamp
}

// Line item extracted from multi-line receipt
export interface LineItem {
  name: string;                // Item name/description
  unitPrice?: number;          // Unit price (if available)
  quantity?: number;           // Quantity (if available)
  lineTotal: number;           // Line total amount
}

// Parsed result from multi-line receipt OCR
export interface ParsedReceipt {
  date?: string;
  totalAmount?: number;        // Total from bottom of receipt
  supplier?: string;
  lineItems: LineItem[];       // Individual items
  rawDescription?: string;     // Fallback single-line description
}

export interface OCRResult {
  rawText: string;
  confidence: number;
  parsed: {
    date?: string;
    amount?: number;           // Total amount (from bottom of receipt)
    supplier?: string;
    description?: string;      // Legacy fallback
    lineItems?: LineItem[];    // Multi-line items
    receiptGroupId?: string;   // Generated group ID for this scan
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
