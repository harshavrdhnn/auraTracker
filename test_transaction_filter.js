const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesStrictParticipantFilter } = require('./transactionFilter');

function matchesCommonSearch(tx, query) {
  const searchableText = [
    tx.description,
    tx.category,
    tx.paidBy,
    tx.receiver,
    tx.type,
    tx.id,
    tx.notes,
    tx.comment,
    tx.paymentMethod,
    tx.splitType,
    tx.amount,
    tx.date,
    ...(tx.splits ? Object.keys(tx.splits) : []),
    ...(tx.splits ? Object.values(tx.splits).map(String) : [])
  ]
    .filter(value => value !== undefined && value !== null && value !== '')
    .join(' ')
    .toLowerCase();

  return searchableText.includes(query.toLowerCase());
}

test('does not match a larger group when only two roommates are selected', () => {
  const tx = {
    id: 'tx-1',
    paidBy: 'Harsha',
    receiver: 'Janaki',
    splits: {
      Harsha: 100,
      Janaki: 100,
      Sushman: 100
    }
  };

  assert.equal(matchesStrictParticipantFilter(tx, ['Harsha', 'Janaki']), false);
});

test('matches when the transaction involves exactly the selected roommates', () => {
  const tx = {
    id: 'tx-2',
    paidBy: 'Harsha',
    receiver: 'Janaki',
    splits: {
      Harsha: 50,
      Janaki: 50
    }
  };

  assert.equal(matchesStrictParticipantFilter(tx, ['Harsha', 'Janaki']), true);
  assert.equal(matchesStrictParticipantFilter(tx, ['Janaki', 'Harsha']), true);
});

test('matches transaction search across description, category, payer and split names', () => {
  const tx = {
    id: 'tx-3',
    description: 'Groceries for the house',
    category: 'Groceries',
    paidBy: 'Harsha',
    receiver: 'Janaki',
    splits: {
      Harsha: 50,
      Janaki: 50
    }
  };

  assert.equal(matchesCommonSearch(tx, 'groceries'), true);
  assert.equal(matchesCommonSearch(tx, 'harsha'), true);
  assert.equal(matchesCommonSearch(tx, 'janaki'), true);
  assert.equal(matchesCommonSearch(tx, 'house'), true);
  assert.equal(matchesCommonSearch(tx, 'missing-term'), false);
});
