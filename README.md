# 🌌 Aura Tracker

**Aura Tracker** is a real-time, multi-device roommate expense tracker built with vanilla HTML, CSS, and JavaScript — no frameworks, no build steps. Just open and use.

Roommates add expenses, split them by equal amounts, percentages, or custom shares, and instantly see who owes whom. Every change syncs to all devices in under a second via Firebase Realtime Database.

---

## ✨ Features

### 🏠 Roommate Management
- Onboarding wizard for first-time setup — add roommates with custom colors
- Per-device identity binding (each person's phone shows their own name as default)
- Add / rename / remove roommates at any time via the Manage Roommates panel

### 💸 Transaction Ledger
- Add **expense** transactions (paid by one roommate, split among others)
- Add **settlement** transactions (one roommate paying back another)
- Four split modes:
  - **Equal** — splits the bill evenly, with automatic penny-rounding correction
  - **Custom** — enter exact amounts per person
  - **Percent** — enter percentages, auto-balanced to 100% with rounding correction
  - **Shares** — enter ratio shares (e.g. 2:1:1), auto-balanced with rounding correction
- Search, filter by payer/category, and sort transactions by date or amount
- Edit and delete transactions (only the payer can delete their own transaction)

### ⚖️ Debt Board
- Pairwise debt calculation (A owes B, B owes C — shown as separate simple arrows)
- One-click **Settle Up** button pre-fills a settlement transaction
- Beginner-friendly: no complex debt simplification that confuses users

### 📊 Spending Analytics
- Donut chart of spending by payer
- Donut chart of spending by category
- Per-roommate total spend summary

### ☁️ Multi-Device Sync (Firebase RTDB)
- Real-time sync across all roommates' devices via Firebase Realtime Database
- Invite link generation (`?invite=CODE`) — share a URL to onboard new devices
- **Smart offline-first merge**: transactions added offline are merged with remote data on reconnect — no data loss
- **Soft deletes**: deleted transactions propagate across devices via `deleted: true` flag + `lastModified` timestamp
- Conflict resolution: the most recently modified version of any transaction always wins

### 📓 Notebook Wrapper *(Coming Soon)*
- Default read-only "Default Notebook" template with ghost sample data
- Create multiple named notebooks (e.g. "Flat 2B", "Road Trip")
- Each notebook has its own roommates, transactions, and Firebase sync key

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Structure | HTML5 (Semantic) |
| Styling | Vanilla CSS (custom properties, glassmorphism) |
| Logic | Vanilla JavaScript (ES6+, no frameworks) |
| Charts | [Chart.js](https://www.chartjs.org/) via CDN |
| Icons | [Lucide Icons](https://lucide.dev/) via CDN |
| Sync | [Firebase Realtime Database](https://firebase.google.com/products/realtime-database) (Compat SDK v9) |
| Hosting | GitHub Pages / Firebase Hosting |

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/auraTracker.git
cd auraTracker/auraTracker
```

### 2. Open Locally

No build step required. Simply open `index.html` in your browser:

```bash
# On macOS / Linux
open index.html

# Or just double-click index.html in your file explorer
```

### 3. First-Time Setup (Onboarding Wizard)

On first load, the onboarding wizard will appear automatically:

1. Enter names for all roommates (e.g. Harsha, Janaki, Sushman)
2. Select your own name as your device identity
3. Click **Initialize Tracker** — you're live!

---

## ☁️ Setting Up Firebase Sync

To enable real-time sync across multiple devices:

### Step 1 — Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project** → name it (e.g. `aura-tracker-live`)
3. Disable Google Analytics → click **Create project**

### Step 2 — Enable Realtime Database

1. In your project, go to **Build** → **Realtime Database**
2. Click **Create database**
3. Start in **Test mode** (you can add security rules later)
4. Note your database URL (e.g. `https://your-project-default-rtdb.firebaseio.com`)

### Step 3 — Get Firebase Config

1. Go to **Project Settings** → **Your apps** → Click the `</>` (Web) icon
2. Register the app with any name
3. Copy the `firebaseConfig` object shown

### Step 4 — Add Config in Aura Tracker

1. Open Aura Tracker → click ⚙️ **Settings**
2. Paste your full Firebase config object (or just the JSON) into the **Firebase Config** field
3. Enter a **Sync Key** — this is the shared "room code" for all roommates (e.g. `flat-2b-2026`)
4. Click **Save Settings** — sync activates immediately

### Step 5 — Share with Roommates

Click the **Share / Invite** button to generate an invite link:

```
https://your-domain.com/?invite=YOUR_SYNC_KEY
```

Send this link to all roommates. When they open it, the app auto-configures their sync key.

---

## 🧪 Testing

The project includes a Node.js-compatible unit test runner for balance and debt calculations.

### Run Tests

```bash
node test_debt_board.js
```

### What's Tested

| Test Case | What it checks |
|---|---|
| 1. Simple Equal Split | 3-way equal split, payer balance = total – share |
| 2. Excluded Payer Split | Payer excluded from split (full credit) |
| 3. Multiple Overlapping Expenses | Direct netting over 2 expenses |
| 4. Partial Settlement | Settlement reduces debt correctly |
| 5. Penny Rounding | ₹100 ÷ 3 = ₹33.33 each, payer gets ₹66.66 |
| 6. Zero/Negative Amounts | Edge-case invalid amounts are skipped |
| 7. Full Settlement Exceeding Debt | Over-payment handled without negative debt |
| 8. Real-World Scenario | Multi-roommate cross-expense with netting |
| 9. Soft-Deleted Transactions | `deleted: true` transactions are ignored in calculations |

---

## 📁 Project Structure

```
auraTracker/
├── index.html          # Single-page application shell + all UI markup
├── styles.css          # Full styling (glassmorphism dark theme, animations)
├── app.js              # All business logic (state, Firebase sync, rendering)
├── test_debt_board.js  # Node.js unit test runner for balance math
├── test_calc.js        # Supplementary calculation test helpers
└── README.md           # This file
```

---

## 💡 How the Math Works

### Net Balance
Each roommate starts at `0`. When a transaction is saved:
- The **payer** receives `+totalAmount`
- Each **split participant** receives `-(their split share)`

A positive balance means the roommate is owed money. A negative balance means they owe money to the group.

### Pairwise Debts
Rather than showing a single net balance, Aura Tracker shows direct pairwise debts:

> **Janaki → Harsha: ₹300** means Janaki owes Harsha ₹300 specifically.

This is simpler for beginners — no confusing "debt minimization" chains.

### Rounding Correction
Splitting ₹100 three ways gives ₹33.333... — we round to ₹33.33 each, which sums to ₹99.99. The remaining **₹0.01 is auto-assigned** to the first participant so the ledger always balances to zero.

---

## 🚢 Deployment

### GitHub Pages

1. Push the `auraTracker/` folder contents to a GitHub repository
2. Go to **Settings** → **Pages** → set source to **Deploy from a branch** → `main` / `root`
3. Your app will be live at `https://YOUR_USERNAME.github.io/REPO_NAME/`

### Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login and initialize
firebase login
firebase init hosting

# Deploy
firebase deploy --only hosting
```

---

## 🔒 Firebase Security Rules (Recommended for Production)

After testing, replace your open rules with:

```json
{
  "rules": {
    "aura": {
      "$syncKey": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

For stricter access, you can add authentication requirements per sync key.

---

## 📋 Roadmap

- [x] Equal, Custom, Percent, Shares split modes
- [x] Pairwise debt board (beginner-friendly)
- [x] Firebase real-time multi-device sync
- [x] Smart offline-first merge with soft deletes
- [x] Rounding error auto-correction for all split types
- [ ] Notebook switcher (multiple named ledgers)
- [ ] Push notification reminders for pending debts
- [ ] Monthly expense summaries & export to CSV
- [ ] Dark/light theme toggle

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

<div align="center">
  Built with ❤️ for roommates who want clear, honest, and simple expense tracking.
</div>
