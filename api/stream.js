const { PAGE_SIZE, fetchSearchPageWithRetry, mapJob } = require('../lib/ams');
const { buildSearchParams, parseJsonBody, toBoundedInt } = require('../lib/request');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  let body;
  try {
    body = parseJsonBody(req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const maxPages = toBoundedInt(body.maxPages, { min: 1, max: 100, defaultValue: 5 });
  const maxJobs = toBoundedInt(body.maxJobs, { min: 1, max: 3000, defaultValue: 200 });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  function sendEvent(payload) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  let totalRows = 0;
  const errors = [];

  try {
    for (let page = 1; page <= maxPages && totalRows < maxJobs; page += 1) {
      const params = buildSearchParams({
        query: body.query,
        location: body.location,
        locationId: body.locationId,
        radius: body.radius,
        filters: body.filters,
        page,
        pageSize: PAGE_SIZE,
      });

      try {
        const data = await fetchSearchPageWithRetry(params, {
          maxRetries: 4,
          initialDelayMs: 1000,
          maxDelayMs: 16000,
        });
        const rows = data.results.map(mapJob).slice(0, maxJobs - totalRows);
        totalRows += rows.length;

        sendEvent({
          type: 'page',
          page,
          totalPages: data.totalPages || 1,
          totalResults: data.totalResults || 0,
          rows,
        });

        if (page >= (data.totalPages || 1)) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
        errors.push(`Seite ${page}: ${message}`);
        sendEvent({ type: 'error', page, message });
        break;
      }
    }
  } finally {
    sendEvent({ type: 'done', totalRows, errors });
    res.end();
  }
};
