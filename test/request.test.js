const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchParams, toBoundedInt } = require('../lib/request');

test('toBoundedInt enforces defaults and bounds', () => {
  assert.equal(toBoundedInt('abc', { min: 1, max: 10, defaultValue: 4 }), 4);
  assert.equal(toBoundedInt('-2', { min: 1, max: 10, defaultValue: 4 }), 1);
  assert.equal(toBoundedInt('50', { min: 1, max: 10, defaultValue: 4 }), 10);
  assert.equal(toBoundedInt('6', { min: 1, max: 10, defaultValue: 4 }), 6);
});

test('buildSearchParams adds vicinity only with location and locationId', () => {
  const withoutLocationId = buildSearchParams({
    query: 'dev',
    location: 'Wien',
    radius: '20',
    locationId: '',
    page: 1,
    pageSize: 30,
    filters: [{ key: 'workingTime', value: 'V' }],
  });
  assert.equal(withoutLocationId.some(([k]) => k === 'vicinity'), false);
  assert.equal(withoutLocationId.some(([k]) => k === 'locationId'), false);

  const withLocationId = buildSearchParams({
    query: 'dev',
    location: 'Wien',
    radius: '20',
    locationId: 'MUNICIPALITY_90001',
    page: 1,
    pageSize: 30,
    filters: [{ key: 'workingTime', value: 'V' }],
  });
  assert.equal(withLocationId.some(([k, v]) => k === 'locationId' && v === 'MUNICIPALITY_90001'), true);
  assert.equal(withLocationId.some(([k, v]) => k === 'vicinity' && v === '20'), true);
});
