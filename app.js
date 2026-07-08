// Default Roommate Palette
const ROOMMATE_PALETTE = [
    "#6366f1", // Indigo
    "#ec4899", // Pink
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#3b82f6", // Blue
    "#8b5cf6"  // Violet
];

// App State
let state = {
    currentUser: "", // Bound identity of this roommate on this device
    roommates: [], // Array of { name: string, color: string }
    transactions: [], // Array of transactions
    settings: {
        syncKey: "",
        firebaseConfig: ""
    },
    filters: {
        search: "",
        payer: "all",
        category: "all"
    },
    activeTab: "ledger" // "ledger" | "analytics"
};

// Chart.js Instances
let payerChartInstance = null;
let categoryChartInstance = null;

// Firebase Globals
let firebaseApp = null;
let firebaseDb = null;
let firebaseSyncRef = null;

// DOM loaded entrypoint
document.addEventListener("DOMContentLoaded", () => {
    loadData();
    checkUrlHashConfig();   // legacy #config= support
    checkInviteCode();      // new ?invite=CODE support
    initFirebase();
    initEventListeners();
    renderAll();

    // If no roommates configured, show onboarding wizard
    if (state.roommates.length === 0) {
        showOnboardingWizard();
    }
});

// Load state from local storage cache
function loadData() {
    const rmSaved = localStorage.getItem("aura_roommates_v1");
    const txSaved = localStorage.getItem("aura_transactions_v1");
    const settingsSaved = localStorage.getItem("aura_settings_v1");
    const currentUserSaved = localStorage.getItem("aura_currentUser_v1");

    state.currentUser = currentUserSaved || "";

    if (rmSaved) {
        try {
            state.roommates = JSON.parse(rmSaved);
        } catch (e) {
            console.error("Failed to parse roommates.", e);
            state.roommates = [];
        }
    }
    if (txSaved) {
        try {
            state.transactions = JSON.parse(txSaved);
        } catch (e) {
            console.error("Failed to parse transactions.", e);
            state.transactions = [];
        }
    }
    if (settingsSaved) {
        try {
            state.settings = JSON.parse(settingsSaved);
        } catch (e) {
            console.error("Failed to parse settings.", e);
            state.settings = { syncKey: "", firebaseConfig: "" };
        }
    }
}

// Save state to local storage
function saveToLocalStorage() {
    localStorage.setItem("aura_roommates_v1", JSON.stringify(state.roommates));
    localStorage.setItem("aura_transactions_v1", JSON.stringify(state.transactions));
    localStorage.setItem("aura_settings_v1", JSON.stringify(state.settings));
    localStorage.setItem("aura_currentUser_v1", state.currentUser);
}

// Push local state edits to Firebase Database
function pushToFirebase() {
    if (firebaseDb && state.settings.syncKey) {
        console.log("Pushing updates to Firebase DB under key:", state.settings.syncKey);
        firebaseDb.ref(`aura_tracker/${state.settings.syncKey}`).set({
            roommates: state.roommates,
            transactions: state.transactions
        }).catch(err => {
            console.error("Firebase push failed:", err);
            showToast("Database write failed. Check Firebase security rules.", "error");
        });
    }
}

// Tolerant Firebase config parser — handles JS object literals from Firebase console
function parseFirebaseConfig(raw) {
    if (!raw) return null;
    let str = raw.trim();

    // Strip "const firebaseConfig = " or "var firebaseConfig = " prefix
    str = str.replace(/^(const|var|let)\s+\w+\s*=\s*/, "");

    // Strip trailing semicolon
    str = str.replace(/;$/, "").trim();

    // First try strict JSON parse
    try {
        return JSON.parse(str);
    } catch (_) {}

    // Fall back: use Function constructor to evaluate JS object literal safely
    try {
        // eslint-disable-next-line no-new-func
        const result = new Function("return " + str)();
        if (result && typeof result === "object") return result;
    } catch (_) {}

    return null;
}

// Initialize Firebase Database Connections
function initFirebase() {
    const configStr = state.settings.firebaseConfig;
    const syncKey = state.settings.syncKey;

    // Disconnect old listener if active
    if (firebaseSyncRef) {
        firebaseSyncRef.off();
        firebaseSyncRef = null;
    }

    if (!configStr) {
        console.log("Firebase config not set. Running offline mode.");
        return;
    }

    // Use passcode as sync path, fallback to project ID derived from config
    let resolvedSyncKey = syncKey;
    if (!resolvedSyncKey) {
        const tempConfig = parseFirebaseConfig(configStr);
        resolvedSyncKey = (tempConfig && tempConfig.projectId) ? tempConfig.projectId : "default";
    }

    try {
        // Parse config — tolerant of JS object literal format from Firebase console
        // (unquoted keys, trailing commas, or with "const firebaseConfig = " prefix)
        const config = parseFirebaseConfig(configStr);

        if (!config) {
            showToast("Firebase config JSON is invalid. Paste just the { } block.", "error");
            return;
        }

        if (!config.databaseURL) {
            showToast("Firebase config is missing 'databaseURL'. Please check your config JSON.", "error");
            return;
        }

        if (typeof firebase !== 'undefined') {
            // Always delete existing apps and re-init cleanly to avoid stale connections
            const deleteExisting = firebase.apps.length > 0
                ? firebase.app().delete()
                : Promise.resolve();

            deleteExisting.then(() => {
                firebaseApp = firebase.initializeApp(config);
                setupFirebaseListener(resolvedSyncKey, firebaseApp);
            }).catch(err => {
                console.warn("Error deleting previous Firebase app:", err);
                // Try initializing anyway
                try {
                    firebaseApp = firebase.initializeApp(config);
                } catch(_) {
                    firebaseApp = firebase.app();
                }
                setupFirebaseListener(resolvedSyncKey, firebaseApp);
            });
        } else {
            showToast("Firebase SDK not loaded. Check your internet connection.", "error");
        }
    } catch (e) {
        console.error("Firebase initialization failed:", e);
        showToast("Firebase config JSON is invalid. Please verify it.", "error");
    }
}

function setupFirebaseListener(syncKey, app) {
    try {
        // Pass app instance explicitly so regional databaseURL is used
        firebaseDb = firebase.database(app);
        firebaseSyncRef = firebaseDb.ref(`aura_tracker/${syncKey}`);

        firebaseSyncRef.on('value', (snapshot) => {
            const data = snapshot.val();

            if (data === null) {
                // Firebase path is completely empty (never initialized).
                // Seed it with local data so other devices can pull.
                if (state.transactions.length > 0 || state.roommates.length > 0) {
                    console.log("Firebase path is new — seeding with local data...");
                    pushToFirebase();
                }
                return;
            }

            // Firebase has data — always treat it as source of truth.
            // This ensures deletions and updates propagate correctly to all devices.
            console.log("Received remote sync from Firebase RTDB");
            state.roommates = data.roommates || state.roommates;
            state.transactions = data.transactions || [];
            saveToLocalStorage();
            renderAll();

        }, (error) => {
            console.error("Firebase listener error:", error);
            showToast("Firebase sync error: " + error.message, "error");
        });

        console.log("Firebase successfully connected! Listening on key:", syncKey);
        showToast("🔥 Firebase sync active!", "success");
    } catch (e) {
        console.error("Firebase listener setup failed:", e);
        showToast("Firebase connection failed. Check your config.", "error");
    }
}

// Check URL Hash config sharing
function checkUrlHashConfig() {
    const hash = window.location.hash;
    if (hash && hash.startsWith("#config=")) {
        try {
            const base64Str = hash.replace("#config=", "");
            const decodedStr = atob(base64Str);
            const configObj = JSON.parse(decodedStr);
            
            if (configObj && configObj.roommates && configObj.settings) {
                state.roommates = configObj.roommates;
                state.settings = configObj.settings;
                
                // Clear bound user identity so new device chooses its own roommate profile
                state.currentUser = "";
                saveToLocalStorage();
                
                // Clear hash in URL bar safely
                history.replaceState(null, "", window.location.pathname);
                showToast("Successfully imported synced workspace config!", "success");

                // Initialize Firebase first to pull data
                initFirebase();

                // Trigger identity select prompt
                setTimeout(() => {
                    openIdentityModal();
                }, 500);
            }
        } catch (e) {
            console.error("Failed to parse URL config sharing hash:", e);
            showToast("Failed to parse configuration share link.", "error");
        }
    }
}

// -------------------------------------------------------------
// EVENT LISTENERS INITIALIZATION
// -------------------------------------------------------------
function initEventListeners() {
    // Navigation Tabs Switching
    document.getElementById("tab-btn-ledger").addEventListener("click", () => switchTab("ledger"));
    document.getElementById("tab-btn-analytics").addEventListener("click", () => switchTab("analytics"));

    // Quick add dialogs
    document.getElementById("btn-add-transaction").addEventListener("click", () => openTransactionModal());
    document.getElementById("btn-modal-close").addEventListener("click", closeTransactionModal);
    document.getElementById("btn-form-cancel").addEventListener("click", closeTransactionModal);

    // Entry Type Segment Selection
    document.getElementById("type-btn-expense").addEventListener("click", () => setEntryType("expense"));
    document.getElementById("type-btn-settlement").addEventListener("click", () => setEntryType("settlement"));

    // Split Rules Segment Selection
    const splitSegButtons = document.querySelectorAll("#split-options-block .btn-segments .segment-btn");
    splitSegButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            splitSegButtons.forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            updateSplitInputsLayout(e.target.dataset.split);
        });
    });

    // Transaction form amount & split triggers
    document.getElementById("tx-amount").addEventListener("input", recalculateSplitsRealtime);

    // Save transaction handler
    document.getElementById("transaction-form").addEventListener("submit", handleSaveTransaction);

    // Settings Modal
    document.getElementById("btn-open-settings").addEventListener("click", openSettingsModal);
    document.getElementById("btn-settings-close").addEventListener("click", closeSettingsModal);
    document.getElementById("btn-settings-cancel").addEventListener("click", closeSettingsModal);
    document.getElementById("settings-form").addEventListener("submit", handleSaveSettings);

    // Onboarding Wizard
    document.getElementById("btn-add-roommate-row").addEventListener("click", () => addRoommateWizardRow("onboarding-roommates-list"));
    document.getElementById("onboarding-form").addEventListener("submit", handleSaveOnboarding);

    // Manage Roommates
    document.getElementById("btn-manage-roommates").addEventListener("click", openRoommatesManagerModal);
    document.getElementById("btn-roommates-mgr-close").addEventListener("click", closeRoommatesManagerModal);
    document.getElementById("btn-roommates-mgr-cancel").addEventListener("click", closeRoommatesManagerModal);
    document.getElementById("btn-mgr-add-roommate").addEventListener("click", () => addRoommateWizardRow("mgr-roommates-list"));
    document.getElementById("roommates-mgr-form").addEventListener("submit", handleSaveRoommatesManager);

    // Data Purge Reset button
    document.getElementById("btn-reset-data").addEventListener("click", handleResetData);

    // Generate Config Link
    document.getElementById("btn-generate-share-link").addEventListener("click", handleGenerateShareLink);
    document.getElementById("btn-copy-share-link").addEventListener("click", copyShareLinkToClipboard);

    // Filters & Search
    document.getElementById("search-input").addEventListener("input", (e) => {
        state.filters.search = e.target.value.trim();
        renderTransactionList();
    });
    document.getElementById("filter-payer").addEventListener("change", (e) => {
        state.filters.payer = e.target.value;
        renderTransactionList();
    });
    document.getElementById("filter-category").addEventListener("change", (e) => {
        state.filters.category = e.target.value;
        renderTransactionList();
    });
}

// -------------------------------------------------------------
// UI VIEW RENDERING & CONTROLLERS
// -------------------------------------------------------------
function renderAll() {
    renderUserIdentityHeader();
    renderRoommatesFilterOptions();
    renderRoommateCards();
    renderTransactionList();
    renderSettleDebtsBoard();
    renderInsightsWidget();
    
    if (state.activeTab === "analytics") {
        renderCharts();
    }
    
    // Trigger Lucide CDN to render SVG icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Render active roommate identity in header
function renderUserIdentityHeader() {
    const headerIdentity = document.getElementById("header-user-identity");
    const nameEl = document.getElementById("header-user-name");

    if (state.currentUser) {
        headerIdentity.style.display = "flex";
        nameEl.textContent = state.currentUser;
        
        // Match name color to roommate's configured color
        const rm = state.roommates.find(r => r.name === state.currentUser);
        if (rm) {
            nameEl.style.color = rm.color;
        } else {
            nameEl.style.color = "var(--accent-primary)";
        }
    } else if (state.roommates.length > 0) {
        headerIdentity.style.display = "flex";
        nameEl.textContent = "Spectator";
        nameEl.style.color = "var(--text-secondary)";
    } else {
        headerIdentity.style.display = "none";
    }
}

// Show Identity Select Modal
function openIdentityModal() {
    const modal = document.getElementById("identity-modal");
    const container = document.getElementById("identity-options-list");
    container.innerHTML = "";

    state.roommates.forEach(rm => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "identity-select-btn";
        btn.style.setProperty("--btn-avatar-color", rm.color);
        btn.innerHTML = `
            <div class="identity-btn-avatar" style="background: ${rm.color}">${rm.name.charAt(0).toUpperCase()}</div>
            <span>I am ${rm.name}</span>
        `;
        btn.addEventListener("click", () => {
            state.currentUser = rm.name;
            saveToLocalStorage();
            modal.classList.remove("active");
            showToast(`Bound to profile: ${rm.name}!`, "success");
            renderAll();
        });
        container.appendChild(btn);
    });

    // Spectator Button
    const spectatorBtn = document.createElement("button");
    spectatorBtn.type = "button";
    spectatorBtn.className = "identity-select-btn";
    spectatorBtn.style.setProperty("--btn-avatar-color", "#6b7280");
    spectatorBtn.innerHTML = `
        <div class="identity-btn-avatar" style="background: #4b5563">👁</div>
        <span>Just Viewing (Spectator)</span>
    `;
    spectatorBtn.addEventListener("click", () => {
        state.currentUser = "";
        saveToLocalStorage();
        modal.classList.remove("active");
        showToast("Access set to Spectator mode.", "success");
        renderAll();
    });
    container.appendChild(spectatorBtn);

    modal.classList.add("active");
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Switch tabs view
function switchTab(tab) {
    state.activeTab = tab;
    
    const tabLedgerBtn = document.getElementById("tab-btn-ledger");
    const tabAnalyticsBtn = document.getElementById("tab-btn-analytics");
    const viewLedgerEl = document.getElementById("view-ledger");
    const viewAnalyticsEl = document.getElementById("view-analytics");

    if (tab === "ledger") {
        tabLedgerBtn.classList.add("active");
        tabAnalyticsBtn.classList.remove("active");
        viewLedgerEl.style.display = "block";
        viewAnalyticsEl.style.display = "none";
    } else {
        tabLedgerBtn.classList.remove("active");
        tabAnalyticsBtn.classList.add("active");
        viewLedgerEl.style.display = "none";
        viewAnalyticsEl.style.display = "grid";
        renderCharts();
    }
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Populate filters selection items
function renderRoommatesFilterOptions() {
    const filterPayer = document.getElementById("filter-payer");
    
    // Keep the "All Payers" option
    filterPayer.innerHTML = '<option value="all">All Payers</option>';
    
    state.roommates.forEach(rm => {
        const option = document.createElement("option");
        option.value = rm.name;
        option.textContent = rm.name;
        filterPayer.appendChild(option);
    });
}

// Compute Net Balances for each roommate
function calculateBalances() {
    let balances = {};
    // Initialize
    state.roommates.forEach(r => {
        balances[r.name] = 0;
    });

    state.transactions.forEach(tx => {
        const amt = parseFloat(tx.amount) || 0;
        if (tx.type === "expense") {
            // Payer gets credit for total paid
            if (balances.hasOwnProperty(tx.paidBy)) {
                balances[tx.paidBy] += amt;
            }
            // Subtract split shares from each member's balance
            if (tx.splits) {
                for (let name in tx.splits) {
                    if (balances.hasOwnProperty(name)) {
                        balances[name] -= parseFloat(tx.splits[name]) || 0;
                    }
                }
            }
        } else if (tx.type === "settlement") {
            // Payer who transferred cash gets +Amt
            if (balances.hasOwnProperty(tx.paidBy)) {
                balances[tx.paidBy] += amt;
            }
            // Recipient gets -Amt
            if (balances.hasOwnProperty(tx.receiver)) {
                balances[tx.receiver] -= amt;
            }
        }
    });

    // Clean decimals
    for (let name in balances) {
        balances[name] = Math.round(balances[name] * 100) / 100;
    }

    // DEBUG: log final balances
    console.log("[AuraTracker] Calculated balances:", JSON.stringify(balances));
    return balances;
}

// Render Roommate status cards at the top
function renderRoommateCards() {
    const container = document.getElementById("roommates-cards-container");
    container.innerHTML = "";
    
    const balances = calculateBalances();
    const transfers = calculatePairwiseDebts();

    state.roommates.forEach(rm => {
        const card = document.createElement("div");
        card.className = "roommate-card";
        card.style.setProperty("--roommate-color", rm.color);
        card.addEventListener("click", () => openTransactionModal(rm.name));

        const isYou = rm.name === state.currentUser;
        const youBadge = isYou ? `<span class="identity-you-pill">You</span>` : "";

        // Collect all debt/credit relationships for this roommate
        let detailedOwesHtml = "";
        
        // Filter transfers where this roommate is involved
        const owesOthers = transfers.filter(t => t.from === rm.name);
        const owedByOthers = transfers.filter(t => t.to === rm.name);

        if (owesOthers.length > 0) {
            owesOthers.forEach(t => {
                detailedOwesHtml += `
                    <div class="roommate-balance-item">
                        <span class="lbl">${isYou ? "You owe" : "Owes"} ${t.to}</span>
                        <span class="val you-owe">₹${t.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                `;
            });
        }

        if (owedByOthers.length > 0) {
            owedByOthers.forEach(t => {
                detailedOwesHtml += `
                    <div class="roommate-balance-item">
                        <span class="lbl">${t.from} ${isYou ? "owes you" : "owes"}</span>
                        <span class="val owes-you">₹${t.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                `;
            });
        }

        // Default if completely settled up
        if (owesOthers.length === 0 && owedByOthers.length === 0) {
            detailedOwesHtml = `
                <div class="roommate-balance-item" style="justify-content: center; padding-top: 0.5rem;">
                    <span class="val settled">✨ Settled Up</span>
                </div>
            `;
        }

        card.innerHTML = `
            <button class="roommate-quick-add-btn" title="Paid by ${rm.name}">
                <i data-lucide="plus"></i>
            </button>
            <div class="roommate-card-header">
                <div class="roommate-avatar" style="--roommate-color: ${rm.color}">
                    ${rm.name.charAt(0).toUpperCase()}
                </div>
                <div class="roommate-name">${rm.name}${youBadge}</div>
            </div>
            <div class="roommate-balance-info">
                <div class="roommate-balance-list">
                    ${detailedOwesHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Settle Debt board calculation and display
function renderSettleDebtsBoard() {
    const container = document.getElementById("simplified-debts-container");
    container.innerHTML = "";

    const balances = calculateBalances();
    const transfers = calculatePairwiseDebts();

    if (transfers.length === 0) {
        container.innerHTML = `
            <div class="debts-empty">
                <i data-lucide="check-circle-2"></i>
                <p>Everything is settled up! All clear.</p>
            </div>
        `;
        return;
    }

    transfers.forEach(transfer => {
        const row = document.createElement("div");
        row.className = "debt-row";
        
        row.innerHTML = `
            <div class="debt-transfer-desc">
                <strong>${transfer.from}</strong> owes <strong>${transfer.to}</strong>
            </div>
            <div class="debt-amount-settle">
                <div class="debt-amt">₹${transfer.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                <button class="btn-settle-mini">Settle Up</button>
            </div>
        `;

        // Add event listener to Settle Up button to pre-fill settlement transaction
        row.querySelector(".btn-settle-mini").addEventListener("click", () => {
            openSettlementModalPreFilled(transfer.from, transfer.to, transfer.amount);
        });

        container.appendChild(row);
    });
}

// Compute unsimplified pairwise direct debts
function calculatePairwiseDebts() {
    let matrix = {};
    // Initialize matrix
    state.roommates.forEach(r1 => {
        matrix[r1.name] = {};
        state.roommates.forEach(r2 => {
            matrix[r1.name][r2.name] = 0;
        });
    });

    state.transactions.forEach(tx => {
        const amt = parseFloat(tx.amount) || 0;
        if (amt <= 0) return;

        if (tx.type === "expense") {
            const payer = tx.paidBy;
            if (tx.splits) {
                for (let debtor in tx.splits) {
                    if (debtor !== payer) {
                        const splitAmt = parseFloat(tx.splits[debtor]) || 0;
                        matrix[payer][debtor] += splitAmt;
                    }
                }
            }
        } else if (tx.type === "settlement") {
            const sender = tx.paidBy;
            const receiver = tx.receiver;
            // Sender paid Receiver directly. This increases the amount Sender has paid Receiver.
            matrix[sender][receiver] += amt;
        }
    });

    // Calculate the net pairwise debts
    let transfers = [];
    const names = state.roommates.map(r => r.name);
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            const u = names[i];
            const v = names[j];
            const net = matrix[u][v] - matrix[v][u];
            const roundedNet = Math.round(net * 100) / 100;
            if (roundedNet > 0.01) {
                // v owes u roundedNet
                transfers.push({
                    from: v,
                    to: u,
                    amount: roundedNet
                });
            } else if (roundedNet < -0.01) {
                // u owes v -roundedNet
                transfers.push({
                    from: u,
                    to: v,
                    amount: -roundedNet
                });
            }
        }
    }
    return transfers;
}



// Render insights widget on the right sidebar
function renderInsightsWidget() {
    const container = document.getElementById("insights-container");
    container.innerHTML = "";

    const totalTx = state.transactions.filter(t => t.type === "expense");
    const totalSpent = totalTx.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
    const avgSpent = totalSpent / (state.roommates.length || 1);

    // Find highest category
    let catTotals = {};
    totalTx.forEach(tx => {
        catTotals[tx.category] = (catTotals[tx.category] || 0) + (parseFloat(tx.amount) || 0);
    });

    let topCategory = "None";
    let topCatAmt = 0;
    for (let cat in catTotals) {
        if (catTotals[cat] > topCatAmt) {
            topCatAmt = catTotals[cat];
            topCategory = cat;
        }
    }

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 0.35rem;">
            <span style="color: var(--text-secondary);">Total Group Spend:</span>
            <strong>₹${totalSpent.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 0.35rem;">
            <span style="color: var(--text-secondary);">Per Person Share:</span>
            <strong>₹${avgSpent.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.35rem;">
            <span style="color: var(--text-secondary);">Top Spending Area:</span>
            <strong>${topCategory} (₹${topCatAmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })})</strong>
        </div>
    `;
}

// Render transaction ledger list
function renderTransactionList() {
    const container = document.getElementById("transaction-list-container");
    container.innerHTML = "";

    // Filters
    const query = state.filters.search.toLowerCase();
    const payerFilter = state.filters.payer;
    const catFilter = state.filters.category;

    const filtered = state.transactions.filter(tx => {
        // Search description
        if (query && !tx.description.toLowerCase().includes(query)) return false;
        
        // Payer
        if (payerFilter !== "all" && tx.paidBy !== payerFilter) return false;

        // Category
        if (catFilter !== "all" && tx.category !== catFilter) return false;

        return true;
    });

    // Sort newest first (by date, then by creation order for same-date entries)
    filtered.sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        // For same date, sort by ID timestamp (newer first)
        const aTime = parseInt(a.id.split('-')[1]) || 0;
        const bTime = parseInt(b.id.split('-')[1]) || 0;
        return bTime - aTime;
    });

    // Gather categories for dropdown filter
    const activeCats = new Set();
    state.transactions.forEach(t => {
        if (t.category) activeCats.add(t.category);
    });

    const catDropdown = document.getElementById("filter-category");
    const currentSelectedCat = catDropdown.value;
    catDropdown.innerHTML = '<option value="all">All Categories</option>';
    activeCats.forEach(cat => {
        const option = document.createElement("option");
        option.value = cat;
        option.textContent = cat;
        catDropdown.appendChild(option);
    });
    catDropdown.value = currentSelectedCat;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-placeholder">
                <i data-lucide="receipt"></i>
                <p>No transactions match your search filter.</p>
            </div>
        `;
        return;
    }

    filtered.forEach(tx => {
        const item = document.createElement("div");
        item.className = `transaction-item ${tx.type}-type`;

        let icon = "credit-card";
        let iconBg = "rgba(99, 102, 241, 0.15)";
        let iconColor = "var(--accent-primary)";

        if (tx.type === "settlement") {
            icon = "check-circle";
            iconBg = "rgba(16, 185, 129, 0.12)";
            iconColor = "var(--accent-green)";
        } else {
            // Category icon
            switch (tx.category) {
                case "Rent": icon = "home"; iconBg = "rgba(59, 130, 246, 0.15)"; iconColor = "#3b82f6"; break;
                case "Groceries": icon = "shopping-cart"; iconBg = "rgba(16, 185, 129, 0.15)"; iconColor = "#10b981"; break;
                case "Utilities": icon = "zap"; iconBg = "rgba(245, 158, 11, 0.15)"; iconColor = "#f59e0b"; break;
                case "Dine Out": icon = "utensils"; iconBg = "rgba(239, 68, 68, 0.15)"; iconColor = "#ef4444"; break;
                case "Travel": icon = "plane"; iconBg = "rgba(139, 92, 246, 0.15)"; iconColor = "#8b5cf6"; break;
                default: icon = "help-circle"; iconBg = "rgba(255,255,255,0.06)"; iconColor = "var(--text-secondary)";
            }
        }

        // Subtitle split details text
        let splitText = "";
        if (tx.type === "settlement") {
            splitText = `Transfer: ${tx.paidBy} ➔ ${tx.receiver}`;
        } else {
            if (tx.splitType === "equal") {
                const count = Object.keys(tx.splits || {}).length;
                splitText = `Split equally among ${count} roomies`;
            } else {
                splitText = `Custom splits configured`;
            }
        }

        const dateFormatted = new Date(tx.date).toLocaleDateString('en-IN', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        const txAmtStr = parseFloat(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Only the payer (or spectator on same device) can delete
        const canDelete = !state.currentUser || state.currentUser === tx.paidBy;

        item.innerHTML = `
            <div class="tx-main-info">
                <div class="tx-icon-wrap" style="background: ${iconBg}; color: ${iconColor};">
                    <i data-lucide="${icon}" style="width: 18px; height: 18px;"></i>
                </div>
                <div class="tx-details-info">
                    <div class="tx-title">${tx.description}</div>
                    <div class="tx-meta-info">
                        <span class="badge badge-payer">${tx.paidBy} Paid</span>
                        ${tx.type !== "settlement" ? `<span class="badge badge-category" style="--cat-bg: ${iconBg}; --cat-color: ${iconColor}">${tx.category}</span>` : `<span class="badge badge-category" style="--cat-bg: ${iconBg}; --cat-color: ${iconColor}">Settlement</span>`}
                        <span class="badge badge-split">${splitText}</span>
                        <span style="font-size: 0.7rem; color: var(--text-muted); margin-left: 0.25rem;">${dateFormatted}</span>
                    </div>
                </div>
            </div>
            <div class="tx-value-block">
                <div class="tx-amt-value ${tx.type}-type">₹${txAmtStr}</div>
                <div class="tx-actions-buttons">
                    <button class="btn-icon-action edit-action" title="Edit Transaction"><i data-lucide="edit"></i></button>
                    ${canDelete ? `<button class="btn-icon-action delete-action" title="Delete Transaction"><i data-lucide="trash-2"></i></button>` : `<span class="tx-no-delete-hint" title="Only ${tx.paidBy} can delete this">🔒</span>`}
                </div>
            </div>
        `;

        // Event hooks
        item.querySelector(".edit-action").addEventListener("click", () => editTransaction(tx.id));
        const deleteBtn = item.querySelector(".delete-action");
        if (deleteBtn) deleteBtn.addEventListener("click", () => deleteTransaction(tx.id, tx.paidBy));

        container.appendChild(item);
    });
}

// -------------------------------------------------------------
// TRANSACTION FORM MODAL & SPLIT LOGIC
// -------------------------------------------------------------
function openTransactionModal(payerName = "") {
    document.getElementById("tx-id").value = "";
    document.getElementById("transaction-form").reset();
    document.getElementById("modal-heading-label").textContent = "Add Transaction";

    // Set default date to today
    document.getElementById("tx-date").value = new Date().toISOString().split("T")[0];

    // Populate roommates in dropdowns
    populateModalDropdowns();

    // Preselect payer if provided, otherwise default to current bound device roommate
    if (payerName) {
        document.getElementById("tx-payer").value = payerName;
    } else if (state.currentUser) {
        const exists = state.roommates.some(r => r.name === state.currentUser);
        if (exists) {
            document.getElementById("tx-payer").value = state.currentUser;
        }
    }

    setEntryType("expense"); // default type
    
    // Select "Equally" split method segment button
    const segments = document.querySelectorAll("#split-options-block .btn-segments .segment-btn");
    segments.forEach(b => {
        if (b.dataset.split === "equal") b.classList.add("active");
        else b.classList.remove("active");
    });

    updateSplitInputsLayout("equal");

    document.getElementById("transaction-modal").classList.add("active");
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function openSettlementModalPreFilled(fromRoomie, toRoomie, amount) {
    openTransactionModal();
    setEntryType("settlement");
    
    document.getElementById("tx-settle-from").value = fromRoomie;
    document.getElementById("tx-settle-to").value = toRoomie;
    document.getElementById("tx-amount").value = amount;
    
    // Set correct description based on the pre-filled values
    document.getElementById("tx-description").value = `Settle: ${fromRoomie} paid ${toRoomie}`;
    
    document.getElementById("modal-heading-label").textContent = "Settle Debt";
}

function closeTransactionModal() {
    document.getElementById("transaction-modal").classList.remove("active");
}

function setEntryType(type) {
    const expenseFields = document.getElementById("expense-fields-block");
    const settlementFields = document.getElementById("settlement-fields-block");
    const splitOptions = document.getElementById("split-options-block");
    const typeExpenseBtn = document.getElementById("type-btn-expense");
    const typeSettleBtn = document.getElementById("type-btn-settlement");

    if (type === "expense") {
        expenseFields.style.display = "block";
        settlementFields.style.display = "none";
        splitOptions.style.display = "block";
        typeExpenseBtn.classList.add("active");
        typeSettleBtn.classList.remove("active");

        // Set category & payer fields as required
        document.getElementById("tx-payer").setAttribute("required", "required");
        document.getElementById("tx-description").setAttribute("required", "required");
        document.getElementById("tx-category").setAttribute("required", "required");
    } else {
        expenseFields.style.display = "none";
        settlementFields.style.display = "block";
        splitOptions.style.display = "none";
        typeExpenseBtn.classList.remove("active");
        typeSettleBtn.classList.add("active");

        // Remove required fields
        document.getElementById("tx-payer").removeAttribute("required");
        document.getElementById("tx-description").removeAttribute("required");
        document.getElementById("tx-category").removeAttribute("required");
        
        // Add default description for settlements
        const from = document.getElementById("tx-settle-from").value;
        const to = document.getElementById("tx-settle-to").value;
        document.getElementById("tx-description").value = `Settle: ${from} paid ${to}`;
    }
}

function populateModalDropdowns() {
    const payerSelect = document.getElementById("tx-payer");
    const settleFrom = document.getElementById("tx-settle-from");
    const settleTo = document.getElementById("tx-settle-to");

    payerSelect.innerHTML = "";
    settleFrom.innerHTML = "";
    settleTo.innerHTML = "";

    state.roommates.forEach(rm => {
        // Payer select
        const opt1 = document.createElement("option");
        opt1.value = rm.name;
        opt1.textContent = rm.name;
        payerSelect.appendChild(opt1);

        // Settle from
        const opt2 = document.createElement("option");
        opt2.value = rm.name;
        opt2.textContent = rm.name;
        settleFrom.appendChild(opt2);

        // Settle to
        const opt3 = document.createElement("option");
        opt3.value = rm.name;
        opt3.textContent = rm.name;
        settleTo.appendChild(opt3);
    });

    // Prevent settle from and to being the same roommate
    settleFrom.addEventListener("change", (e) => {
        const val = e.target.value;
        if (settleTo.value === val) {
            // Find another roommate
            const other = state.roommates.find(r => r.name !== val);
            if (other) settleTo.value = other.name;
        }
    });

    settleTo.addEventListener("change", (e) => {
        const val = e.target.value;
        if (settleFrom.value === val) {
            const other = state.roommates.find(r => r.name !== val);
            if (other) settleFrom.value = other.name;
        }
    });

    // Default pre-select
    if (state.roommates.length >= 2) {
        settleTo.value = state.roommates[1].name;
    }
}

// Render inputs dynamically inside split subform depending on Split Type
function updateSplitInputsLayout(splitType) {
    const container = document.getElementById("split-members-list-container");
    container.innerHTML = "";

    const instEl = document.getElementById("split-instructions");
    let instructions = "";

    switch (splitType) {
        case "equal":
            instructions = "Uncheck roommates to exclude them from sharing this expense.";
            break;
        case "custom":
            instructions = "Enter the exact cash amount (₹) owed by each roommate.";
            break;
        case "percent":
            instructions = "Enter the percentage share (%) for each roommate (must sum to 100%).";
            break;
        case "shares":
            instructions = "Enter shares proportions (e.g. 2 for Roomie A, 1 for Roomie B).";
            break;
    }
    instEl.textContent = instructions;

    state.roommates.forEach(rm => {
        const row = document.createElement("div");
        row.className = "split-member-row";
        row.dataset.name = rm.name;

        let inputHtml = "";
        if (splitType === "equal") {
            inputHtml = `
                <div class="split-calc-display" id="split-calc-${rm.name}">₹0.00</div>
            `;
        } else if (splitType === "custom") {
            inputHtml = `
                <div class="split-input-wrapper">
                    <span>₹</span>
                    <input type="number" class="form-control split-amt-input" min="0" step="any" placeholder="0.00" value="0">
                </div>
            `;
        } else if (splitType === "percent") {
            inputHtml = `
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <div class="split-calc-display" style="font-size: 0.75rem;" id="split-calc-${rm.name}">₹0.00</div>
                    <div class="split-input-wrapper" style="width: 80px;">
                        <input type="number" class="form-control split-pct-input" min="0" max="100" step="any" placeholder="0" value="0">
                        <span>%</span>
                    </div>
                </div>
            `;
        } else if (splitType === "shares") {
            inputHtml = `
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <div class="split-calc-display" style="font-size: 0.75rem;" id="split-calc-${rm.name}">₹0.00</div>
                    <div class="split-input-wrapper" style="width: 80px;">
                        <input type="number" class="form-control split-shares-input" min="0" step="any" placeholder="0" value="1">
                        <span>sh.</span>
                    </div>
                </div>
            `;
        }

        row.innerHTML = `
            <div class="split-member-left">
                <input type="checkbox" class="split-member-checkbox" checked id="checkbox-${rm.name}">
                <label class="split-member-avatar-label" for="checkbox-${rm.name}">
                    <div class="split-member-mini-avatar" style="--avatar-color: ${rm.color}">
                        ${rm.name.charAt(0).toUpperCase()}
                    </div>
                    <span>${rm.name}</span>
                </label>
            </div>
            ${inputHtml}
        `;

        // Event hooks for real-time calculations
        row.querySelector(".split-member-checkbox").addEventListener("change", recalculateSplitsRealtime);
        
        const textInput = row.querySelector("input[type='number']");
        if (textInput) {
            textInput.addEventListener("input", recalculateSplitsRealtime);
        }

        container.appendChild(row);
    });

    recalculateSplitsRealtime();
}

// Compute real-time outputs in split subform
function recalculateSplitsRealtime() {
    const totalAmt = parseFloat(document.getElementById("tx-amount").value) || 0;
    
    // Find active split type
    const activeSegBtn = document.querySelector("#split-options-block .btn-segments .segment-btn.active");
    if (!activeSegBtn) return;
    const splitType = activeSegBtn.dataset.split;

    const validationMsg = document.getElementById("split-validation-msg");
    validationMsg.innerHTML = "";

    const rows = document.querySelectorAll(".split-member-row");
    
    if (totalAmt <= 0) {
        rows.forEach(row => {
            const displayEl = row.querySelector(".split-calc-display");
            if (displayEl) displayEl.textContent = "₹0.00";
        });
        return;
    }

    if (splitType === "equal") {
        // Find checked checkboxes
        let checkedRoomies = [];
        rows.forEach(row => {
            const cb = row.querySelector(".split-member-checkbox");
            if (cb && cb.checked) {
                checkedRoomies.push(row.dataset.name);
            }
        });

        if (checkedRoomies.length === 0) {
            validationMsg.innerHTML = `<span class="split-validation-alert"><i data-lucide="alert-circle"></i> Select at least one roommate.</span>`;
            rows.forEach(row => {
                row.querySelector(".split-calc-display").textContent = "₹0.00";
            });
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        const share = Math.round((totalAmt / checkedRoomies.length) * 100) / 100;
        
        // Handle penny rounding remainder
        const totalCalculated = share * checkedRoomies.length;
        let remainder = Math.round((totalAmt - totalCalculated) * 100) / 100;

        rows.forEach(row => {
            const name = row.dataset.name;
            const displayEl = row.querySelector(".split-calc-display");
            const isChecked = checkedRoomies.includes(name);

            if (isChecked) {
                let roommateShare = share;
                // Distribute remainder to the first roommate
                if (remainder !== 0) {
                    roommateShare += remainder;
                    remainder = 0; // consumed
                }
                displayEl.textContent = `₹${roommateShare.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            } else {
                displayEl.textContent = "₹0.00";
            }
        });

        validationMsg.innerHTML = `<span class="split-validation-success"><i data-lucide="check-circle-2"></i> Splits match amount perfectly!</span>`;

    } else if (splitType === "custom") {
        let sumCustom = 0;
        rows.forEach(row => {
            const cb = row.querySelector(".split-member-checkbox");
            const input = row.querySelector(".split-amt-input");
            
            if (cb && cb.checked) {
                input.removeAttribute("disabled");
                sumCustom += parseFloat(input.value) || 0;
            } else {
                input.setAttribute("disabled", "disabled");
                input.value = "0";
            }
        });

        sumCustom = Math.round(sumCustom * 100) / 100;
        const diff = Math.round((totalAmt - sumCustom) * 100) / 100;

        if (diff === 0) {
            validationMsg.innerHTML = `<span class="split-validation-success"><i data-lucide="check-circle-2"></i> Sum matches total (₹${totalAmt.toLocaleString()})!</span>`;
        } else if (diff > 0) {
            validationMsg.innerHTML = `<span class="split-validation-alert"><i data-lucide="alert-circle"></i> Sum: ₹${sumCustom.toLocaleString()} (₹${diff.toLocaleString()} remaining).</span>`;
        } else {
            validationMsg.innerHTML = `<span class="split-validation-alert"><i data-lucide="alert-circle"></i> Sum: ₹${sumCustom.toLocaleString()} exceeds total by ₹${Math.abs(diff).toLocaleString()}.</span>`;
        }

    } else if (splitType === "percent") {
        let sumPct = 0;
        rows.forEach(row => {
            const cb = row.querySelector(".split-member-checkbox");
            const input = row.querySelector(".split-pct-input");
            const displayEl = row.querySelector(".split-calc-display");

            if (cb && cb.checked) {
                input.removeAttribute("disabled");
                const pct = parseFloat(input.value) || 0;
                sumPct += pct;
                const shareAmt = Math.round((totalAmt * (pct / 100)) * 100) / 100;
                displayEl.textContent = `₹${shareAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            } else {
                input.setAttribute("disabled", "disabled");
                input.value = "0";
                displayEl.textContent = "₹0.00";
            }
        });

        const diff = 100 - sumPct;
        if (Math.abs(diff) < 0.001) {
            validationMsg.innerHTML = `<span class="split-validation-success"><i data-lucide="check-circle-2"></i> Percentages total 100%!</span>`;
        } else {
            validationMsg.innerHTML = `<span class="split-validation-alert"><i data-lucide="alert-circle"></i> Percentage sum is ${sumPct}% (needs 100%).</span>`;
        }

    } else if (splitType === "shares") {
        let totalShares = 0;
        rows.forEach(row => {
            const cb = row.querySelector(".split-member-checkbox");
            const input = row.querySelector(".split-shares-input");

            if (cb && cb.checked) {
                input.removeAttribute("disabled");
                totalShares += parseFloat(input.value) || 0;
            } else {
                input.setAttribute("disabled", "disabled");
                input.value = "0";
            }
        });

        if (totalShares <= 0) {
            validationMsg.innerHTML = `<span class="split-validation-alert"><i data-lucide="alert-circle"></i> Total shares must be greater than zero.</span>`;
            rows.forEach(row => {
                row.querySelector(".split-calc-display").textContent = "₹0.00";
            });
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        rows.forEach(row => {
            const cb = row.querySelector(".split-member-checkbox");
            const input = row.querySelector(".split-shares-input");
            const displayEl = row.querySelector(".split-calc-display");

            if (cb && cb.checked) {
                const sh = parseFloat(input.value) || 0;
                const shareAmt = Math.round((totalAmt * (sh / totalShares)) * 100) / 100;
                displayEl.textContent = `₹${shareAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            } else {
                displayEl.textContent = "₹0.00";
            }
        });

        validationMsg.innerHTML = `<span class="split-validation-success"><i data-lucide="check-circle-2"></i> Distributed proportionally across ${totalShares} shares.</span>`;
    }

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Handle Save Transaction Submission
function handleSaveTransaction(e) {
    e.preventDefault();

    const editId = document.getElementById("tx-id").value;
    const type = document.querySelector("#transaction-form .btn-segments .segment-btn.active").dataset.type;
    const amount = parseFloat(document.getElementById("tx-amount").value);
    const date = document.getElementById("tx-date").value;
    const description = document.getElementById("tx-description").value.trim();

    if (isNaN(amount) || amount <= 0) {
        showToast("Please enter a valid amount.", "error");
        return;
    }

    let transactionData = {
        id: editId || "tx-" + Date.now() + "-" + Math.floor(Math.random()*1000),
        type: type,
        amount: amount,
        date: date,
        description: description
    };

    if (type === "expense") {
        const paidBy = document.getElementById("tx-payer").value;
        const category = document.getElementById("tx-category").value;
        const splitType = document.querySelector("#split-options-block .btn-segments .segment-btn.active").dataset.split;

        transactionData.paidBy = paidBy;
        transactionData.category = category;
        transactionData.splitType = splitType;

        // Collect splits
        let splits = {};
        let splitInputs = {};
        const rows = document.querySelectorAll(".split-member-row");

        if (splitType === "equal") {
            let checkedRoomies = [];
            rows.forEach(row => {
                const cb = row.querySelector(".split-member-checkbox");
                if (cb && cb.checked) {
                    checkedRoomies.push(row.dataset.name);
                    splitInputs[row.dataset.name] = 1;
                }
            });

            if (checkedRoomies.length === 0) {
                showToast("Select at least one roommate to split with.", "error");
                return;
            }

            const share = Math.round((amount / checkedRoomies.length) * 100) / 100;
            let remainder = Math.round((amount - (share * checkedRoomies.length)) * 100) / 100;

            checkedRoomies.forEach(name => {
                let sAmt = share;
                if (remainder !== 0) {
                    sAmt += remainder;
                    remainder = 0;
                }
                splits[name] = sAmt;
            });

        } else if (splitType === "custom") {
            let sum = 0;
            rows.forEach(row => {
                const cb = row.querySelector(".split-member-checkbox");
                const val = parseFloat(row.querySelector(".split-amt-input").value) || 0;
                if (cb && cb.checked) {
                    splits[row.dataset.name] = val;
                    splitInputs[row.dataset.name] = val;
                    sum += val;
                }
            });

            sum = Math.round(sum * 100) / 100;
            if (Math.abs(amount - sum) > 0.02) {
                showToast(`Splits sum (₹${sum.toLocaleString()}) must match total bill amount (₹${amount.toLocaleString()}).`, "error");
                return;
            }

        } else if (splitType === "percent") {
            let sumPct = 0;
            rows.forEach(row => {
                const cb = row.querySelector(".split-member-checkbox");
                const pct = parseFloat(row.querySelector(".split-pct-input").value) || 0;
                if (cb && cb.checked) {
                    sumPct += pct;
                    splitInputs[row.dataset.name] = pct;
                    const calculatedShare = Math.round((amount * (pct / 100)) * 100) / 100;
                    splits[row.dataset.name] = calculatedShare;
                }
            });

            if (Math.abs(100 - sumPct) > 0.1) {
                showToast("Total percentages must sum to 100%.", "error");
                return;
            }

        } else if (splitType === "shares") {
            let totalShares = 0;
            rows.forEach(row => {
                const cb = row.querySelector(".split-member-checkbox");
                const sh = parseFloat(row.querySelector(".split-shares-input").value) || 0;
                if (cb && cb.checked) {
                    totalShares += sh;
                    splitInputs[row.dataset.name] = sh;
                }
            });

            if (totalShares <= 0) {
                showToast("Total shares must be greater than zero.", "error");
                return;
            }

            rows.forEach(row => {
                const cb = row.querySelector(".split-member-checkbox");
                const sh = parseFloat(row.querySelector(".split-shares-input").value) || 0;
                if (cb && cb.checked) {
                    const shareAmt = Math.round((amount * (sh / totalShares)) * 100) / 100;
                    splits[row.dataset.name] = shareAmt;
                }
            });
        }

        transactionData.splits = splits;
        transactionData.splitInputs = splitInputs;

        // DEBUG: log splits to help diagnose balance bugs
        console.log("[AuraTracker] Saving transaction:", JSON.stringify(transactionData, null, 2));
        console.log("[AuraTracker] Splits breakdown:", JSON.stringify(splits));
        console.log("[AuraTracker] checkedRoomies count:", Object.keys(splits).length, "→ names:", Object.keys(splits));

    } else {
        // Settlement type
        const paidBy = document.getElementById("tx-settle-from").value;
        const receiver = document.getElementById("tx-settle-to").value;

        if (paidBy === receiver) {
            showToast("Sender and recipient cannot be the same roommate.", "error");
            return;
        }

        transactionData.paidBy = paidBy;
        transactionData.receiver = receiver;
        transactionData.description = `Settlement: ${paidBy} paid ${receiver}`;
        transactionData.category = "Settlement";
    }

    if (editId) {
        // Replace existing
        const index = state.transactions.findIndex(t => t.id === editId);
        if (index !== -1) state.transactions[index] = transactionData;
    } else {
        // Add new
        state.transactions.push(transactionData);
    }

    saveToLocalStorage();
    pushToFirebase();
    renderAll();
    closeTransactionModal();
    showToast(editId ? "Entry updated!" : "Entry added successfully!", "success");
}

// Edit transaction
function editTransaction(id) {
    const tx = state.transactions.find(t => t.id === id);
    if (!tx) return;

    openTransactionModal();
    document.getElementById("tx-id").value = tx.id;
    document.getElementById("tx-amount").value = tx.amount;
    document.getElementById("tx-date").value = tx.date;
    document.getElementById("tx-description").value = tx.description;
    document.getElementById("modal-heading-label").textContent = "Edit Transaction";

    setEntryType(tx.type);

    if (tx.type === "expense") {
        document.getElementById("tx-payer").value = tx.paidBy;
        document.getElementById("tx-category").value = tx.category;

        // Select split type
        const splitType = tx.splitType || "equal";
        const splitSegButtons = document.querySelectorAll("#split-options-block .btn-segments .segment-btn");
        splitSegButtons.forEach(b => {
            if (b.dataset.split === splitType) b.classList.add("active");
            else b.classList.remove("active");
        });

        // Set inputs layout
        updateSplitInputsLayout(splitType);

        // Prepopulate checkbox and values
        const rows = document.querySelectorAll(".split-member-row");
        rows.forEach(row => {
            const name = row.dataset.name;
            const cb = row.querySelector(".split-member-checkbox");
            
            const hasSplit = tx.splits && tx.splits.hasOwnProperty(name);
            cb.checked = hasSplit;
            
            if (splitType === "custom") {
                const input = row.querySelector(".split-amt-input");
                if (input) input.value = hasSplit ? tx.splits[name] : 0;
            } else if (splitType === "percent") {
                const input = row.querySelector(".split-pct-input");
                if (input) {
                    input.value = (tx.splitInputs && tx.splitInputs.hasOwnProperty(name)) 
                        ? tx.splitInputs[name] 
                        : (hasSplit ? Math.round((tx.splits[name] / tx.amount) * 100) : 0);
                }
            } else if (splitType === "shares") {
                const input = row.querySelector(".split-shares-input");
                if (input) {
                    input.value = (tx.splitInputs && tx.splitInputs.hasOwnProperty(name))
                        ? tx.splitInputs[name]
                        : (hasSplit ? 1 : 0);
                }
            }
        });
        
        recalculateSplitsRealtime();
    } else {
        document.getElementById("tx-settle-from").value = tx.paidBy;
        document.getElementById("tx-settle-to").value = tx.receiver;
    }
}

// Delete transaction — only allowed by the payer
function deleteTransaction(id, paidBy) {
    if (state.currentUser && state.currentUser !== paidBy) {
        showToast(`Only ${paidBy} can delete this transaction.`, "error");
        return;
    }
    if (confirm("Are you sure you want to delete this transaction?")) {
        state.transactions = state.transactions.filter(t => t.id !== id);
        saveToLocalStorage();
        pushToFirebase();
        renderAll();
        showToast("Transaction deleted.", "success");
    }
}

// -------------------------------------------------------------
// SETTINGS / SYNC MODAL HANDLERS
// -------------------------------------------------------------
function openSettingsModal() {
    document.getElementById("settings-sync-key").value = state.settings.syncKey || "";
    document.getElementById("settings-firebase-config").value = state.settings.firebaseConfig || "";
    
    // Hide old share URL generated containers
    document.getElementById("share-link-container").style.display = "none";

    document.getElementById("settings-modal").classList.add("active");
}

function closeSettingsModal() {
    document.getElementById("settings-modal").classList.remove("active");
}

function handleSaveSettings(e) {
    e.preventDefault();

    const syncKey = document.getElementById("settings-sync-key").value.trim();
    const configStr = document.getElementById("settings-firebase-config").value.trim();

    state.settings.syncKey = syncKey;
    state.settings.firebaseConfig = configStr;

    saveToLocalStorage();
    initFirebase();
    
    // Perform initial push to populate database if sync active
    pushToFirebase();
    
    renderAll();
    closeSettingsModal();
    showToast("Settings saved successfully!", "success");
}

// Onboarding config url link generation
async function handleGenerateShareLink() {
    const btn = document.getElementById("btn-generate-share-link");
    const container = document.getElementById("share-link-container");
    const input = document.getElementById("share-link-input");
    const codeDisplay = document.getElementById("invite-code-display");

    // Build the full base64 config URL
    const configData = { roommates: state.roommates, settings: state.settings };
    const base64Str = btoa(JSON.stringify(configData));
    const origin = window.location.origin + window.location.pathname;
    const fullUrl = `${origin}#config=${base64Str}`;

    // Show loading state
    input.value = "⏳ Generating link...";
    input.disabled = true;
    if (btn) btn.disabled = true;
    if (codeDisplay) codeDisplay.style.display = "none";
    container.style.display = "block";

    // Try TinyURL (works on public domains; fails silently on localhost)
    let shortUrl = null;
    try {
        const resp = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(fullUrl)}`);
        if (resp.ok) {
            const text = await resp.text();
            if (text.startsWith("https://tinyurl.com/")) shortUrl = text.trim();
        }
    } catch (e) {
        console.warn("TinyURL unavailable:", e);
    }

    input.value = shortUrl || fullUrl;
    input.disabled = false;
    if (btn) btn.disabled = false;

    if (shortUrl) {
        showToast("🔗 Short invite link ready!", "success");
    } else {
        showToast("Link ready! (Short URLs work after hosting on GitHub Pages)", "success");
    }
}

function copyShareLinkToClipboard() {
    const input = document.getElementById("share-link-input");
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value).then(() => {
        showToast("Invite link copied! 📋 Send it to your roommates.", "success");
    }).catch(() => {
        showToast("Failed to auto-copy. Select and copy manually.", "error");
    });
}

// Check for ?invite=CODE in URL on page load
async function checkInviteCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("invite");
    if (!code) return;

    // Clear the ?invite= param from URL bar immediately
    const cleanUrl = window.location.origin + window.location.pathname;
    history.replaceState(null, "", cleanUrl);

    showToast(`⏳ Loading invite code: ${code}...`, "success");

    // We need Firebase to fetch the invite — but Firebase isn't connected yet.
    // Use the REST API directly to fetch the invite without needing full init.
    try {
        // Try fetching from all known Firebase projects (stored in localStorage)
        const settingsSaved = localStorage.getItem("aura_settings_v1");
        let databaseURL = null;

        if (settingsSaved) {
            const s = JSON.parse(settingsSaved);
            const cfg = parseFirebaseConfig(s.firebaseConfig);
            if (cfg && cfg.databaseURL) databaseURL = cfg.databaseURL;
        }

        if (!databaseURL) {
            showToast(`Enter your Firebase config in Settings first, then open the invite link again.`, "error");
            return;
        }

        const resp = await fetch(`${databaseURL}/aura_tracker_invites/${code}.json`);
        const data = await resp.json();

        if (!data) {
            showToast(`Invite code "${code}" not found or expired.`, "error");
            return;
        }

        if (data.expiresAt && Date.now() > data.expiresAt) {
            showToast(`Invite code "${code}" has expired. Ask your roommate for a new one.`, "error");
            return;
        }

        // Apply the invite config
        state.roommates = data.roommates || [];
        state.settings = data.settings || state.settings;
        state.currentUser = "";
        saveToLocalStorage();

        showToast("✅ Workspace synced from invite! Choose your identity.", "success");
        initFirebase();
        renderAll();

        // Prompt identity selection
        setTimeout(() => openIdentityModal(), 600);

    } catch (e) {
        console.error("Failed to load invite:", e);
        showToast("Failed to load invite. Check your internet connection.", "error");
    }
}

// -------------------------------------------------------------
// ONBOARDING WIZARD HANDLERS
// -------------------------------------------------------------
function showOnboardingWizard() {
    const list = document.getElementById("onboarding-roommates-list");
    list.innerHTML = "";

    // Generate 3 default roommates
    const defaults = ["Alex", "Sam", "Chris"];
    defaults.forEach((name, idx) => {
        addRoommateWizardRow("onboarding-roommates-list", name, ROOMMATE_PALETTE[idx % ROOMMATE_PALETTE.length]);
    });

    document.getElementById("onboarding-modal").classList.add("active");
    updateOnboardingUserSelect();
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function updateOnboardingUserSelect() {
    const select = document.getElementById("onboarding-user-select");
    const nameInputs = document.querySelectorAll("#onboarding-roommates-list .rm-wizard-name");
    const currentValue = select.value;

    select.innerHTML = '<option value="" disabled selected>Select who you are...</option>';

    nameInputs.forEach(input => {
        const val = input.value.trim();
        if (val) {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        }
    });

    if (currentValue) {
        select.value = currentValue;
    }
}

function updateMgrUserSelect() {
    const select = document.getElementById("mgr-user-select");
    const nameInputs = document.querySelectorAll("#mgr-roommates-list .rm-wizard-name");
    const currentValue = select.value || state.currentUser;

    select.innerHTML = '<option value="">Spectator / View Only</option>';

    nameInputs.forEach(input => {
        const val = input.value.trim();
        if (val) {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        }
    });

    select.value = currentValue;
}

function addRoommateWizardRow(containerId, name = "", color = "") {
    const container = document.getElementById(containerId);
    const rows = container.querySelectorAll(".onboarding-member-row");
    
    if (rows.length >= 6) {
        showToast("Maximum of 6 roommates allowed.", "error");
        return;
    }

    const nextColor = color || ROOMMATE_PALETTE[rows.length % ROOMMATE_PALETTE.length];

    const row = document.createElement("div");
    row.className = "onboarding-member-row";
    row.innerHTML = `
        <input type="text" class="form-control rm-wizard-name" placeholder="Roommate Name" value="${name}" required>
        <input type="color" class="rm-wizard-color" value="${nextColor}">
        <button type="button" class="btn-icon-action delete-action" title="Delete" style="opacity: 1; visibility: visible;"><i data-lucide="trash-2"></i></button>
    `;

    row.querySelector(".delete-action").addEventListener("click", () => {
        const activeRows = container.querySelectorAll(".onboarding-member-row");
        if (activeRows.length <= 2) {
            showToast("At least 2 roommates are required.", "error");
            return;
        }
        row.remove();
        if (containerId === "onboarding-roommates-list") {
            updateOnboardingUserSelect();
        } else if (containerId === "mgr-roommates-list") {
            updateMgrUserSelect();
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    });

    // Add input event listener to name field to update select lists reactively
    row.querySelector(".rm-wizard-name").addEventListener("input", () => {
        if (containerId === "onboarding-roommates-list") {
            updateOnboardingUserSelect();
        } else if (containerId === "mgr-roommates-list") {
            updateMgrUserSelect();
        }
    });

    container.appendChild(row);
    if (containerId === "onboarding-roommates-list") {
        updateOnboardingUserSelect();
    } else if (containerId === "mgr-roommates-list") {
        updateMgrUserSelect();
    }
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function handleSaveOnboarding(e) {
    e.preventDefault();

    const rows = document.querySelectorAll("#onboarding-roommates-list .onboarding-member-row");
    let roomies = [];
    let namesMap = new Set();
    let hasError = false;

    rows.forEach(row => {
        const nameVal = row.querySelector(".rm-wizard-name").value.trim();
        const colorVal = row.querySelector(".rm-wizard-color").value;

        if (!nameVal) return;
        if (namesMap.has(nameVal.toLowerCase())) {
            showToast(`Duplicate name found: "${nameVal}". Names must be unique.`, "error");
            hasError = true;
            return;
        }
        
        namesMap.add(nameVal.toLowerCase());
        roomies.push({
            name: nameVal,
            color: colorVal
        });
    });

    if (hasError) return;

    if (roomies.length < 2) {
        showToast("Please add at least 2 roommates.", "error");
        return;
    }

    const selectedUser = document.getElementById("onboarding-user-select").value;
    if (!selectedUser) {
        showToast("Please select your identity to proceed.", "error");
        return;
    }

    state.roommates = roomies;
    state.currentUser = selectedUser;
    
    saveToLocalStorage();
    renderAll();
    
    document.getElementById("onboarding-modal").classList.remove("active");
    showToast(`Workspace initialized. Welcome ${selectedUser}!`, "success");
}

// -------------------------------------------------------------
// MANAGE ROOMMATES MODAL HANDLERS
// -------------------------------------------------------------
function openRoommatesManagerModal() {
    const list = document.getElementById("mgr-roommates-list");
    list.innerHTML = "";

    state.roommates.forEach(rm => {
        addRoommateWizardRow("mgr-roommates-list", rm.name, rm.color);
    });

    document.getElementById("roommates-manager-modal").classList.add("active");
    updateMgrUserSelect();
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function closeRoommatesManagerModal() {
    document.getElementById("roommates-manager-modal").classList.remove("active");
}

function handleSaveRoommatesManager(e) {
    e.preventDefault();

    const rows = document.querySelectorAll("#mgr-roommates-list .onboarding-member-row");
    let roomies = [];
    let namesMap = new Set();
    let hasError = false;

    rows.forEach(row => {
        const nameVal = row.querySelector(".rm-wizard-name").value.trim();
        const colorVal = row.querySelector(".rm-wizard-color").value;

        if (!nameVal) return;
        
        if (namesMap.has(nameVal.toLowerCase())) {
            showToast(`Duplicate roommate name: "${nameVal}".`, "error");
            hasError = true;
            return;
        }

        namesMap.add(nameVal.toLowerCase());
        roomies.push({
            name: nameVal,
            color: colorVal
        });
    });

    if (hasError) return;

    if (roomies.length < 2) {
        showToast("At least 2 roommates are required.", "error");
        return;
    }

    const oldNames = state.roommates.map(r => r.name);
    const newNames = roomies.map(r => r.name);
    const deletedNames = oldNames.filter(n => !newNames.includes(n));
    
    if (deletedNames.length > 0) {
        const confirmDelete = confirm(`Deleting roommates (${deletedNames.join(", ")}) will not remove their past transactions, but their balance will no longer be visible. Proceed?`);
        if (!confirmDelete) return;
    }

    state.roommates = roomies;
    state.currentUser = document.getElementById("mgr-user-select").value;

    saveToLocalStorage();
    pushToFirebase();
    renderAll();
    closeRoommatesManagerModal();
    showToast("Roommate settings updated!", "success");
}

// -------------------------------------------------------------
// GENERAL UTILITIES
// -------------------------------------------------------------
function showToast(message, type = "success") {
    const toast = document.getElementById("toast-notification");
    const toastMsg = document.getElementById("toast-message");
    const toastIcon = document.getElementById("toast-icon");

    toastMsg.textContent = message;
    
    toast.className = "toast active " + type;

    if (type === "success") {
        toastIcon.setAttribute("data-lucide", "check-circle");
    } else {
        toastIcon.setAttribute("data-lucide", "alert-circle");
    }

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // Auto dismiss
    setTimeout(() => {
        toast.classList.remove("active");
    }, 3000);
}

// Reset ledger database state
function handleResetData() {
    if (confirm("WARNING: This will purge all transaction history and configuration details to zero. Are you sure you want to proceed?")) {
        localStorage.clear();
        state = {
            roommates: [],
            transactions: [],
            settings: { syncKey: "", firebaseConfig: "" },
            filters: { search: "", payer: "all", category: "all" },
            activeTab: "ledger"
        };
        
        // Destruct Firebase sync references
        if (firebaseSyncRef) {
            firebaseSyncRef.off();
            firebaseSyncRef = null;
        }

        saveToLocalStorage();
        renderAll();
        showOnboardingWizard();
        showToast("Database successfully wiped.", "success");
    }
}

// -------------------------------------------------------------
// ANALYTICS CHART CALCULATIONS
// -------------------------------------------------------------
function renderCharts() {
    const payerCanvas = document.getElementById("payerChart");
    const categoryCanvas = document.getElementById("categoryChart");

    if (!payerCanvas || !categoryCanvas) return;

    // Destroy existing instances if present
    if (payerChartInstance) {
        payerChartInstance.destroy();
    }
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    // Check if there are transactions
    const totalTx = state.transactions.filter(t => t.type === "expense");
    if (totalTx.length === 0) {
        // Draw empty placeholders inside parent containers
        payerCanvas.style.display = "none";
        categoryCanvas.style.display = "none";
        return;
    }

    payerCanvas.style.display = "block";
    categoryCanvas.style.display = "block";

    // 1. Payer totals spent
    let payerLabels = state.roommates.map(r => r.name);
    let payerColors = state.roommates.map(r => r.color);
    let payerDataMap = {};
    
    state.roommates.forEach(r => {
        payerDataMap[r.name] = 0;
    });

    totalTx.forEach(tx => {
        if (payerDataMap.hasOwnProperty(tx.paidBy)) {
            payerDataMap[tx.paidBy] += parseFloat(tx.amount) || 0;
        }
    });

    let payerDatasetValues = state.roommates.map(r => payerDataMap[r.name]);

    payerChartInstance = new Chart(payerCanvas.getContext("2d"), {
        type: 'bar',
        data: {
            labels: payerLabels,
            datasets: [{
                label: 'Total Paid (₹)',
                data: payerDatasetValues,
                backgroundColor: payerColors,
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111322',
                    titleColor: '#fff',
                    bodyColor: '#9ca3af',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#9ca3af' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#9ca3af' }
                }
            }
        }
    });

    // 2. Category totals spent
    let categoryMap = {
        Rent: 0,
        Groceries: 0,
        Utilities: 0,
        "Dine Out": 0,
        Travel: 0,
        Misc: 0
    };

    totalTx.forEach(tx => {
        const cat = tx.category || "Misc";
        categoryMap[cat] = (categoryMap[cat] || 0) + (parseFloat(tx.amount) || 0);
    });

    // Filter out zero categories
    let catLabels = [];
    let catValues = [];
    const categoryColors = {
        Rent: "#3b82f6",
        Groceries: "#10b981",
        Utilities: "#f59e0b",
        "Dine Out": "#ef4444",
        Travel: "#8b5cf6",
        Misc: "#6b7280"
    };
    let catColors = [];

    for (let cat in categoryMap) {
        if (categoryMap[cat] > 0.01) {
            catLabels.push(cat);
            catValues.push(categoryMap[cat]);
            catColors.push(categoryColors[cat] || "#6b7280");
        }
    }

    categoryChartInstance = new Chart(categoryCanvas.getContext("2d"), {
        type: 'doughnut',
        data: {
            labels: catLabels,
            datasets: [{
                data: catValues,
                backgroundColor: catColors,
                borderColor: 'rgba(0,0,0,0.5)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#9ca3af', padding: 12 }
                },
                tooltip: {
                    backgroundColor: '#111322',
                    titleColor: '#fff',
                    bodyColor: '#9ca3af',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1
                }
            }
        }
    });
}
