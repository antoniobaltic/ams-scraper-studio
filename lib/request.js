function parseJsonBody(req) {
  if (!req || req.body == null) {
    return {};
  }

  if (typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body !== 'string') {
    throw new Error('Request body must be an object or JSON string.');
  }

  try {
    return JSON.parse(req.body || '{}');
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

function toBoundedInt(value, options) {
  const min = options.min;
  const max = options.max;
  const defaultValue = options.defaultValue;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeFilterPairs(filters) {
  if (!Array.isArray(filters)) {
    return [];
  }

  const pairs = [];
  for (const filter of filters) {
    const key = String(filter && filter.key ? filter.key : '').trim();
    const value = String(filter && filter.value ? filter.value : '').trim();
    if (!key || !value) {
      continue;
    }
    pairs.push([key, value]);
  }
  return pairs;
}

function buildSearchParams(options) {
  const query = String(options.query || '').trim();
  const location = String(options.location || '').trim();
  const locationId = String(options.locationId || '').trim();
  const radius = String(options.radius == null ? '' : options.radius).trim();
  const page = toBoundedInt(options.page, { min: 1, max: 10000, defaultValue: 1 });
  const pageSize = toBoundedInt(options.pageSize, { min: 1, max: 100, defaultValue: 30 });
  const filters = normalizeFilterPairs(options.filters);

  const paramPairs = [
    ['page', String(page)],
    ['pageSize', String(pageSize)],
    ['sortField', '_SCORE'],
  ];

  if (query) {
    paramPairs.push(['query', query]);
  }

  if (location) {
    paramPairs.push(['location', location]);
  }

  if (location && locationId) {
    paramPairs.push(['locationId', locationId]);
  }

  if (location && locationId && radius && radius !== '0') {
    paramPairs.push(['vicinity', radius]);
  }

  for (const pair of filters) {
    paramPairs.push(pair);
  }

  return paramPairs;
}

module.exports = {
  buildSearchParams,
  normalizeFilterPairs,
  parseJsonBody,
  toBoundedInt,
};
