# Branch Scanner

Mobile-first receipt scanning PWA for branch employees. Scan receipts → stored locally → export to Excel.

## Features

- 📷 **Camera Scan** — Take photos of receipts, automatic OCR extraction
- 🔍 **Tesseract.js OCR** — Runs 100% in the browser, no server needed
- 📋 **Receipt Management** — Search, filter by category, view details
- 📊 **Excel Export** — Full export or filtered by date/category
- 📱 **Installable PWA** — Works offline, add to home screen
- 🔒 **All Data Stored Locally** — IndexedDB, no server required

## Tech Stack

- **Frontend**: TypeScript + Vite
- **OCR**: Tesseract.js v5 (runs in browser)
- **Database**: Dexie.js (IndexedDB wrapper)
- **Excel**: SheetJS (xlsx)
- **UI**: Custom CSS (mobile-first, forest green + gold theme)

## Setup

```bash
# Install dependencies
npm install

# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Android Build (Requires Java 17 + Android SDK)

```bash
# Install Android SDK command-line tools first
npm run android:setup   # One-time setup
npm run android:build    # Build APK
```

The APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Screens

1. **Scan** — Camera button, OCR scanning, receipt form
2. **Records** — Searchable list, filter by category
3. **Export** — All / date range / category → Excel download

## Categories

⛽ Fuel | 🍔 Food | 📎 Office | 💡 Utilities | 🚗 Transport | 🔧 Maintenance | 💰 Salary | 🏠 Rental | 🛡️ Insurance | 📢 Marketing | 📱 Telecom | 🏥 Medical | 📦 Other

## Account Code Defaults

| Category | Default Code |
|----------|-------------|
| Fuel | 901-000 |
| Food & Beverages | 903-000 |
| Office Supplies | 902-000 |
| Utilities | 904-000 |
| Transport | 905-000 |
| Maintenance | 906-000 |
| Salary | 910-000 |
| Rental | 915-000 |
| Insurance | 920-000 |
| Marketing | 930-000 |
| Telecom | 907-000 |
| Medical | 908-000 |
