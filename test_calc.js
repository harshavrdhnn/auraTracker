// Test runner for AuraTracker balance calculations
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

// Greedily simplify debt settlements
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

// Scenario 1: Harsha paid 900, split equally between Janaki & Sushman (excluding Harsha)
state.transactions.push({
    id: "tx-1",
    type: "expense",
    amount: 900,
    paidBy: "Harsha",
    splitType: "equal",
    splits: { "Janaki": 450, "Sushman": 450 }
});

const bal1 = calculateBalances();
console.log("Scenario 1 Balances:");
console.log(bal1);
console.log("Scenario 1 Simplified Debts:");
console.log(simplifyDebts(bal1));

// Scenario 2: Janaki settles 450 to Harsha
state.transactions.push({
    id: "tx-2",
    type: "settlement",
    amount: 450,
    paidBy: "Janaki",
    receiver: "Harsha"
});

const bal2 = calculateBalances();
console.log("\nScenario 2 Balances:");
console.log(bal2);
console.log("Scenario 2 Simplified Debts:");
console.log(simplifyDebts(bal2));

