const { AmsApiError, PAGE_SIZE, fetchSearchPageWithRetry, mapJob } = require('../lib/ams');
const { buildSearchParams, parseJsonBody, toBoundedInt } = require('../lib/request');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt', rows: [], errors: [] });
  }

  let body;
  try {
    body = parseJsonBody(req);
  } catch (error) {
    return res.status(400).json({ error: error.message, rows: [], errors: [error.message] });
  }

  const page = toBoundedInt(body.page, { min: 1, max: 10000, defaultValue: 1 });
  const paramPairs = buildSearchParams({
    query: body.query,
    location: body.location,
    locationId: body.locationId,
    radius: body.radius,
    filters: body.filters,
    page,
    pageSize: PAGE_SIZE,
  });

  try {
    const data = await fetchSearchPageWithRetry(paramPairs, {
      maxRetries: 2,
      initialDelayMs: 600,
      maxDelayMs: 5000,
    });

    return res.status(200).json({
      page: data.page || page,
      totalPages: data.totalPages || 1,
      totalResults: data.totalResults || 0,
      rows: data.results.map(mapJob),
      errors: [],
    });
  } catch (error) {
    const isClientError = error instanceof AmsApiError && error.status === 400;
    const status = isClientError ? 400 : 502;
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    return res.status(status).json({ error: message, rows: [], errors: [message] });
  }
};
