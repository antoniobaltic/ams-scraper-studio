const { createHmac, randomBytes } = require('crypto');

const BASE_URL = 'https://jobs.ams.at';
const API_PATH = '/public/emps/api/search';
const HMAC_KEY = 'chn6bl40obysw581p33f98okhd3gm6185p791868cxfozkdko635r50xhh99v1kz';
const PAGE_SIZE = 30;

function buildRequest(urlPath, paramPairs) {
  const sorted = [...paramPairs].sort((a, b) => {
    const k = a[0].localeCompare(b[0]);
    return k !== 0 ? k : a[1].localeCompare(b[1]);
  });
  const sortedStr = sorted
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const random = randomBytes(8).toString('hex');
  const message = 'GET' + urlPath + sortedStr + 'X-AMS-ACCESS-TOKEN-RANDOM=' + random;
  const token = createHmac('sha512', HMAC_KEY).update(message, 'utf8').digest('hex');
  return {
    url: `${BASE_URL}${urlPath}?${sortedStr}`,
    headers: { 'x-ams-access-token': token, 'x-ams-access-token-random': random },
  };
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapJob(job) {
  const addr = job.company?.address || {};
  return {
    id: String(job.id || ''),
    title: String(job.title || ''),
    company: String(job.company?.name || ''),
    location: String(addr.municipality || ''),
    state: String(addr.federalState || ''),
    zip: String(addr.zipCode || ''),
    posted_at: String(job.lastUpdatedAt || '').split('T')[0],
    working_time: String(job.workingTime?.description || ''),
    employment_type: String(job.employmentRelationship?.description || ''),
    job_offer_type: String(job.jobOfferType?.description || ''),
    education: (job.educationLevels || []).map((e) => e.description).join(', '),
    description: stripHtml(job.summary),
    // Correct URL: Angular router uses /jobs/uuid/{uuid}, not /job/{id}
    url: `${BASE_URL}/public/emps/jobs/uuid/${job.uuid}`,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const query = String(body.query || '').trim();
  const location = String(body.location || '').trim();
  const locationId = String(body.locationId || '').trim();
  const radius = String(body.radius ?? '').trim();
  const page = Math.max(Number(body.page || 1), 1);

  const paramPairs = [
    ['page', String(page)],
    ['pageSize', String(PAGE_SIZE)],
    ['sortField', '_SCORE'],
  ];

  if (query) paramPairs.push(['query', query]);
  if (location) paramPairs.push(['location', location]);
  if (locationId) paramPairs.push(['locationId', locationId]);
  if (location && radius && radius !== '0') paramPairs.push(['vicinity', radius]);

  const filters = Array.isArray(body.filters) ? body.filters : [];
  for (const filter of filters) {
    const key = String(filter?.key || '').trim();
    const value = String(filter?.value || '').trim();
    if (key && value) paramPairs.push([key, value]);
  }

  try {
    const { url, headers } = buildRequest(API_PATH, paramPairs);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://jobs.ams.at/public/emps/jobs',
        ...headers,
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `AMS API Fehler: ${response.status}`, rows: [], errors: [] });
    }

    const data = await response.json();
    return res.json({
      page: data.page || page,
      totalPages: data.totalPages || 1,
      totalResults: data.totalResults || 0,
      rows: (data.results || []).map(mapJob),
      errors: [],
    });
  } catch (error) {
    return res.status(500).json({ error: error.message, rows: [], errors: [error.message] });
  }
};
