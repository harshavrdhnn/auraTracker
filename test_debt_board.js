// Comprehensive Test Suite for Aura Debt Board calculations (Pairwise Netting)
const state = {
    roommates: [
        { name: "Harsha", color: "#7c3aed" },
        { name: "Janaki", color: "#db2777" },
        { name: "Sushman", color: "#0891b2" }
    ],
    transactions: []
};

function calculateBalances() {
    let balances = {};
    state.roommates.forEach(r => {
        balances[r.name] = 0;
    });

    state.transactions.forEach(tx => {
        if (tx.deleted) return;
        const amt = parseFloat(tx.amount) || 0;
        if (amt <= 0) return; // Skip zero/negative invalid transactions

        if (tx.type === "expense") {
            if (balances.hasOwnProperty(tx.paidBy)) {
                balances[tx.paidBy] += amt;
            }
            if (tx.splits) {
                for (let name in tx.splits) {
                    if (balances.hasOwnProperty(name)) {
                        balances[name] -= parseFloat(tx.splits[name]) || 0;
                    }
                }
            }
        } else if (tx.type === "settlement") {
            if (balances.hasOwnProperty(tx.paidBy)) {
                balances[tx.paidBy] += amt;
            }
            if (balances.hasOwnProperty(tx.receiver)) {
                balances[tx.receiver] -= amt;
            }
        }
    });

    for (let name in balances) {
        balances[name] = Math.round(balances[name] * 100) / 100;
    }
    return balances;
}

function calculatePairwiseDebts() {
    let matrix = {};
    state.roommates.forEach(r1 => {
        matrix[r1.name] = {};
        state.roommates.forEach(r2 => {
            matrix[r1.name][r2.name] = 0;
        });
    });

    state.transactions.forEach(tx => {
        if (tx.deleted) return;
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
            matrix[sender][receiver] += amt;
        }
    });

    let transfers = [];
    const names = state.roommates.map(r => r.name);
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            const u = names[i];
            const v = names[j];
            const net = matrix[u][v] - matrix[v][u];
            const roundedNet = Math.round(net * 100) / 100;
            if (roundedNet > 0.01) {
                transfers.push({ from: v, to: u, amount: roundedNet });
            } else if (roundedNet < -0.01) {
                transfers.push({ from: u, to: v, amount: -roundedNet });
            }
        }
    }
    return transfers;
}

function runTestCase(title, action, expectedBalances, expectedDebts) {
    action();
    const balances = calculateBalances();
    const debts = calculatePairwiseDebts();
    
    console.log(`\n========================================`);
    console.log(`TEST: ${title}`);
    console.log(`========================================`);
    console.log(`Balances:`, balances);
    console.log(`Debts:`, debts);

    // Assert balances
    let balancesPassed = true;
    for (let name in expectedBalances) {
        if (balances[name] !== expectedBalances[name]) {
            console.log(`❌ Balance Mismatch for ${name}! Got ${balances[name]}, Expected ${expectedBalances[name]}`);
            balancesPassed = false;
        }
    }

    // Assert transfers
    let debtsPassed = true;
    if (debts.length !== expectedDebts.length) {
        debtsPassed = false;
    } else {
        for (let idx = 0; idx < debts.length; idx++) {
            const got = debts[idx];
            const exp = expectedDebts[idx];
            if (got.from !== exp.from || got.to !== exp.to || Math.abs(got.amount - exp.amount) > 0.01) {
                debtsPassed = false;
            }
        }
    }

    if (!debtsPassed) {
        console.log(`❌ Debts Mismatch! Got:`, debts, `Expected:`, expectedDebts);
    }

    if (balancesPassed && debtsPassed) {
        console.log(`✅ PASSED`);
    } else {
        console.log(`❌ FAILED`);
    }
}

// --- RUN TESTS ---

// 1. Simple Equal Split
runTestCase(
    "1. Simple Equal Split (Harsha paid 900 split 3-ways)",
    () => {
        state.transactions = [{
            id: "t1",
            type: "expense",
            amount: 900,
            paidBy: "Harsha",
            splits: { "Harsha": 300, "Janaki": 300, "Sushman": 300 }
        }];
    },
    { "Harsha": 600, "Janaki": -300, "Sushman": -300 },
    [
        { from: "Janaki", to: "Harsha", amount: 300 },
        { from: "Sushman", to: "Harsha", amount: 300 }
    ]
);

// 2. Unequal/Excluded Payer Split
runTestCase(
    "2. Excluded Payer Split (Harsha paid 900 split between Janaki & Sushman only)",
    () => {
        state.transactions = [{
            id: "t2",
            type: "expense",
            amount: 900,
            paidBy: "Harsha",
            splits: { "Janaki": 450, "Sushman": 450 }
        }];
    },
    { "Harsha": 900, "Janaki": -450, "Sushman": -450 },
    [
        { from: "Janaki", to: "Harsha", amount: 450 },
        { from: "Sushman", to: "Harsha", amount: 450 }
    ]
);

// 3. Overlapping Expenses
runTestCase(
    "3. Multiple Overlapping Expenses (Direct Netting Check)",
    () => {
        state.transactions = [
            {
                id: "t2a",
                type: "expense",
                amount: 900,
                paidBy: "Harsha",
                splits: { "Janaki": 450, "Sushman": 450 }
            },
            {
                id: "t2b",
                type: "expense",
                amount: 300,
                paidBy: "Janaki",
                splits: { "Harsha": 100, "Janaki": 100, "Sushman": 100 }
            }
        ];
    },
    { "Harsha": 800, "Janaki": -250, "Sushman": -550 },
    [
        { from: "Janaki", to: "Harsha", amount: 350 },
        { from: "Sushman", to: "Harsha", amount: 450 },
        { from: "Sushman", to: "Janaki", amount: 100 }
    ]
);

// 4. Partial Settlement
runTestCase(
    "4. Partial Settlement",
    () => {
        state.transactions.push({
            id: "t4",
            type: "settlement",
            amount: 250,
            paidBy: "Janaki",
            receiver: "Harsha"
        });
    },
    { "Harsha": 550, "Janaki": 0, "Sushman": -550 },
    [
        { from: "Janaki", to: "Harsha", amount: 100 },
        { from: "Sushman", to: "Harsha", amount: 450 },
        { from: "Sushman", to: "Janaki", amount: 100 }
    ]
);

// 5. Penny Rounding Splits
runTestCase(
    "5. Penny Rounding (Harsha paid 100 split 3-ways)",
    () => {
        state.transactions = [{
            id: "t5",
            type: "expense",
            amount: 100,
            paidBy: "Harsha",
            splits: { "Harsha": 33.34, "Janaki": 33.33, "Sushman": 33.33 }
        }];
    },
    { "Harsha": 66.66, "Janaki": -33.33, "Sushman": -33.33 },
    [
        { from: "Janaki", to: "Harsha", amount: 33.33 },
        { from: "Sushman", to: "Harsha", amount: 33.33 }
    ]
);

// 6. Zero/Negative/Invalid Amounts
runTestCase(
    "6. Zero/Negative Amounts",
    () => {
        state.transactions = [
            {
                id: "t5",
                type: "expense",
                amount: 100,
                paidBy: "Harsha",
                splits: { "Harsha": 33.34, "Janaki": 33.33, "Sushman": 33.33 }
            },
            {
                id: "t6-zero",
                type: "expense",
                amount: 0,
                paidBy: "Janaki",
                splits: { "Harsha": 0, "Janaki": 0 }
            },
            {
                id: "t6-neg",
                type: "expense",
                amount: -50,
                paidBy: "Sushman",
                splits: { "Harsha": -25, "Sushman": -25 }
            }
        ];
    },
    { "Harsha": 66.66, "Janaki": -33.33, "Sushman": -33.33 },
    [
        { from: "Janaki", to: "Harsha", amount: 33.33 },
        { from: "Sushman", to: "Harsha", amount: 33.33 }
    ]
);

// 7. Full Settlement Exceeding Debt
runTestCase(
    "7. Full Settlement Exceeding Debt",
    () => {
        state.transactions = [
            {
                id: "t7-exp",
                type: "expense",
                amount: 900,
                paidBy: "Harsha",
                splits: { "Janaki": 450, "Sushman": 450 }
            },
            {
                id: "t7-settle",
                type: "settlement",
                amount: 500, // Janaki owes 450 but paid 500
                paidBy: "Janaki",
                receiver: "Harsha"
            }
        ];
    },
    { "Harsha": 400, "Janaki": 50, "Sushman": -450 },
    [
        { from: "Harsha", to: "Janaki", amount: 50 },
        { from: "Sushman", to: "Harsha", amount: 450 }
    ]
);

// 8. User's specific scenario
runTestCase(
    "8. User's Scenario (Harsha paid 3700 split 3-ways, Janaki paid 14000 split 3-ways)",
    () => {
        state.transactions = [
            {
                id: "user-t1",
                type: "expense",
                amount: 3700,
                paidBy: "Harsha",
                splits: { "Harsha": 1233.34, "Janaki": 1233.33, "Sushman": 1233.33 }
            },
            {
                id: "user-t2",
                type: "expense",
                amount: 14000,
                paidBy: "Janaki",
                splits: { "Harsha": 4666.66, "Janaki": 4666.67, "Sushman": 4666.67 }
            }
        ];
    },
    { "Harsha": -2200, "Janaki": 8100, "Sushman": -5900 },
    [
        { from: "Harsha", to: "Janaki", amount: 3433.33 },
        { from: "Sushman", to: "Harsha", amount: 1233.33 },
        { from: "Sushman", to: "Janaki", amount: 4666.67 }
    ]
);

// 9. Soft-deleted transactions
runTestCase(
    "9. Soft-deleted transactions (Harsha paid 900 split 3-ways, but then deleted)",
    () => {
        state.transactions = [
            {
                id: "t9-deleted",
                type: "expense",
                amount: 900,
                paidBy: "Harsha",
                splits: { "Harsha": 300, "Janaki": 300, "Sushman": 300 },
                deleted: true
            },
            {
                id: "t9-active",
                type: "expense",
                amount: 300,
                paidBy: "Janaki",
                splits: { "Harsha": 100, "Janaki": 100, "Sushman": 100 },
                deleted: false
            }
        ];
    },
    { "Harsha": -100, "Janaki": 200, "Sushman": -100 },
    [
        { from: "Harsha", to: "Janaki", amount: 100 },
        { from: "Sushman", to: "Janaki", amount: 100 }
    ]
);
