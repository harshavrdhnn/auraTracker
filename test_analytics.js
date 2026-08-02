const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalyticsData } = require('./analytics');

test('buildAnalyticsData ignores deleted expenses and aggregates real spend', () => {
  const dataSource = {
    roommates: [
      { name: 'Harsha', color: '#6366f1' },
      { name: 'Janaki', color: '#ec4899' },
      { name: 'Sushman', color: '#10b981' }
    ],
    transactions: [
      { id: '1', type: 'expense', amount: 900, paidBy: 'Harsha', category: 'Rent', deleted: false },
      { id: '2', type: 'expense', amount: 300, paidBy: 'Janaki', category: 'Utilities', deleted: false },
      { id: '3', type: 'expense', amount: 250, paidBy: 'Harsha', category: 'Groceries', deleted: true },
      { id: '4', type: 'expense', amount: 450, paidBy: 'Sushman', category: 'Dine Out', deleted: false },
      { id: '5', type: 'settlement', amount: 100, paidBy: 'Harsha', receiver: 'Janaki', deleted: false }
    ]
  };

  const analytics = buildAnalyticsData(dataSource);

  assert.deepEqual(analytics.payerLabels, ['Harsha', 'Janaki', 'Sushman']);
  assert.deepEqual(analytics.payerValues, [900, 300, 450]);
  assert.deepEqual(analytics.payerColors, ['#6366f1', '#ec4899', '#10b981']);
  assert.deepEqual(analytics.categoryLabels, ['Rent', 'Utilities', 'Dine Out']);
  assert.deepEqual(analytics.categoryValues, [900, 300, 450]);
});
