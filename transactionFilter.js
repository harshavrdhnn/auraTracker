(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.transactionFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function getTransactionParticipantNames(tx) {
        const names = new Set();

        if (tx && typeof tx === 'object') {
            if (tx.paidBy) names.add(tx.paidBy);
            if (tx.receiver) names.add(tx.receiver);
            if (tx.splits) {
                Object.keys(tx.splits).forEach((name) => {
                    if (name) names.add(name);
                });
            }
        }

        return Array.from(names).filter(Boolean).sort();
    }

    function matchesStrictParticipantFilter(tx, selectedParticipants) {
        const selected = (selectedParticipants || [])
            .filter(Boolean)
            .map((name) => String(name).trim())
            .filter(Boolean)
            .sort();

        if (selected.length === 0) return true;

        const transactionParticipants = getTransactionParticipantNames(tx);
        if (transactionParticipants.length !== selected.length) return false;

        const selectedSet = new Set(selected);
        return transactionParticipants.every((name) => selectedSet.has(name));
    }

    return {
        getTransactionParticipantNames,
        matchesStrictParticipantFilter
    };
});
