// Comprehensive Test Suite for Aura Debt Board calculations & simplification
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

function simplifyDebts(balances) {
    let debtors = [];
    let creditors = [];

    for (let name in balances) {
        let bal = balances[name];
        if (bal < -0.01) {
            debtors.push({ name: name, amount: -bal });
        } else if (bal > 0.01) {
            creditors.push({ name: name, amount: bal });
        }
    }

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    let transfers = [];
    let i = 0, j = 0;

    while (i < debtors.length && j < creditors.length) {
        let debtor = debtors[i];
        let creditor = creditors[j];

        let amount = Math.min(debtor.amount, creditor.amount);
        amount = Math.round(amount * 100) / 100;

        if (amount > 0.01) {
            transfers.push({
                from: debtor.name,
                to: creditor.name,
                amount: amount
            });
        }

        debtor.amount -= amount;
        creditor.amount -= amount;

        if (debtor.amount < 0.01) i++;
        if (creditor.amount < 0.01) j++;
    }

    return transfers;
}

function runTestCase(title, action, expectedBalances, expectedDebts) {
    action();
    const balances = calculateBalances();
    const debts = simplifyDebts(balances);
    
    console.log(`\n========================================`);
    console.log(`TEST: ${title}`);
    console.log(`========================================`);
    console.log(`Balances:`, balances);
    console.log(`Debts Board:`, debts);

    // Assert balances
    let balancesPassed = true;
    for (let name in expectedBalances) {
        if (balances[name] !== expectedBalances[name]) {
            console.log(`❌ Balance Mismatch for ${name}! Got ${balances[name]}, Expected ${expectedBalances[name]}`);
            balancesPassed = false;
        }
    }

    // Assert simplified transfers
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
        console.log(`❌ Debts Board Mismatch! Got:`, debts, `Expected:`, expectedDebts);
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
    "3. Multiple Overlapping Expenses (Simplification Check)",
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
        { from: "Sushman", to: "Harsha", amount: 550 },
        { from: "Janaki", to: "Harsha", amount: 250 }
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
        { from: "Sushman", to: "Harsha", amount: 550 }
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
        { from: "Sushman", to: "Harsha", amount: 400 },
        { from: "Sushman", to: "Janaki", amount: 50 }
    ]
);
