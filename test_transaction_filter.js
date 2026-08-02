const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesStrictParticipantFilter } = require('./transactionFilter');

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
