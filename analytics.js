(function (root) {
    const CATEGORY_COLOR_MAP = {
        Rent: '#3b82f6',
        Groceries: '#10b981',
        Utilities: '#f59e0b',
        'Dine Out': '#ef4444',
        Travel: '#8b5cf6',
        Misc: '#6b7280'
    };

    function normalizeAmount(value) {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function normalizeCategory(category) {
        if (typeof category === 'string' && category.trim()) {
            return category.trim();
        }
        return 'Misc';
    }

    function buildAnalyticsData(dataSource) {
        const roommates = Array.isArray(dataSource && dataSource.roommates) ? dataSource.roommates : [];
        const transactions = Array.isArray(dataSource && dataSource.transactions) ? dataSource.transactions : [];
        const expenseTransactions = transactions.filter(tx => tx && tx.type === 'expense' && !tx.deleted);

        const payerLabels = roommates.map(rm => rm && rm.name ? rm.name : '').filter(Boolean);
        const payerColors = roommates.map(rm => rm && rm.color ? rm.color : '#6b7280');
        const payerValues = payerLabels.map(() => 0);

        expenseTransactions.forEach(tx => {
            const payerIndex = payerLabels.indexOf(tx.paidBy);
            if (payerIndex >= 0) {
                payerValues[payerIndex] += normalizeAmount(tx.amount);
            }
        });

        const categoryTotals = {};
        expenseTransactions.forEach(tx => {
            const category = normalizeCategory(tx.category);
            const amount = normalizeAmount(tx.amount);
            categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        });

        const categoryLabels = Object.keys(categoryTotals);
        const categoryValues = categoryLabels.map(category => categoryTotals[category]);
        const categoryColors = categoryLabels.map(category => CATEGORY_COLOR_MAP[category] || '#6b7280');

        const hasData = expenseTransactions.length > 0 && (payerValues.some(value => value > 0.01) || categoryValues.some(value => value > 0.01));

        return {
            expenseTransactions,
            payerLabels,
            payerValues,
            payerColors,
            categoryLabels,
            categoryValues,
            categoryColors,
            hasData
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildAnalyticsData };
    }

    root.AuraAnalytics = { buildAnalyticsData };
})(typeof globalThis !== 'undefined' ? globalThis : this);
