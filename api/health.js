const { fetchSearchPageWithRetry } = require('../lib/ams');
const { buildSearchParams } = require('../lib/request');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const params = buildSearchParams({
      query: 'a',
      page: 1,
      pageSize: 1,
      filters: [],
    });

    const data = await fetchSearchPageWithRetry(params, {
      maxRetries: 1,
      initialDelayMs: 400,
      maxDelayMs: 1000,
    });

    if (!Array.isArray(data.results) || typeof data.totalResults !== 'number') {
      return res.status(500).json({ status: 'error', message: 'Unexpected AMS API response shape' });
    }

    return res.status(200).json({
      status: 'ok',
      totalResults: data.totalResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ status: 'error', message });
  }
};
