const { createHmac, randomBytes } = require('crypto');

const BASE_URL = 'https://jobs.ams.at';
const API_PATH = '/public/emps/api/search';
const HMAC_KEY = 'chn6bl40obysw581p33f98okhd3gm6185p791868cxfozkdko635r50xhh99v1kz';
const PAGE_SIZE = 30;

function buildRequest(urlPath, paramPairs) {
  const sorted = [...paramPairs].sort((a, b) => {
    const keyCmp = a[0].localeCompare(b[0]);
    return keyCmp !== 0 ? keyCmp : a[1].localeCompare(b[1]);
  });

  const sortedStr = sorted
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const random = randomBytes(8).toString('hex');
  const message = 'GET' + urlPath + sortedStr + 'X-AMS-ACCESS-TOKEN-RANDOM=' + random;
  const token = createHmac('sha512', HMAC_KEY).update(message, 'utf8').digest('hex');

  return {
    url: `${BASE_URL}${urlPath}?${sortedStr}`,
    headers: {
      'x-ams-access-token': token,
      'x-ams-access-token-random': random,
    },
  };
}

async function searchPage(baseParamPairs, page) {
  const paramPairs = [...baseParamPairs, ['page', String(page)]];
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
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    url: `${BASE_URL}/public/emps/job/${job.id}`,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const query = String(body.query || '').trim();
  const location = String(body.location || '').trim();
  const radius = String(body.radius ?? '').trim();
  const maxPages = Math.min(Math.max(Number(body.max_pages || 5), 1), 100);
  const maxJobs = Math.min(Math.max(Number(body.max_jobs || 200), 1), 3000);

  const baseParamPairs = [
    ['pageSize', String(Math.min(PAGE_SIZE, maxJobs))],
    ['sortField', '_SCORE'],
  ];

  if (query) baseParamPairs.push(['query', query]);
  if (location) baseParamPairs.push(['location', location]);
  if (radius && radius !== '0') baseParamPairs.push(['vicinity', radius]);

  const filters = Array.isArray(body.filters) ? body.filters : [];
  for (const filter of filters) {
    const key = String(filter?.key || '').trim();
    const value = String(filter?.value || '').trim();
    if (key && value) baseParamPairs.push([key, value]);
  }

  const displayParams = new URLSearchParams();
  if (query) displayParams.set('query', query);
  if (location) displayParams.set('location', location);
  if (radius && radius !== '0') displayParams.set('vicinity', radius);
  const searchUrl = `${BASE_URL}${API_PATH}?${displayParams.toString()}`;

  const allJobs = [];
  const errors = [];

  for (let page = 1; page <= maxPages && allJobs.length < maxJobs; page++) {
    try {
      const data = await searchPage(baseParamPairs, page);
      const results = Array.isArray(data.results) ? data.results : [];

      for (const job of results) {
        if (allJobs.length >= maxJobs) break;
        allJobs.push(mapJob(job));
      }

      if (results.length === 0 || page >= (data.totalPages || 1)) break;
    } catch (error) {
      errors.push(`Seite ${page} konnte nicht geladen werden: ${error.message}`);
      break;
    }
  }

  return res.status(200).json({
    search_url: searchUrl,
    job_count: allJobs.length,
    errors,
    preview: allJobs.slice(0, 20),
    rows: allJobs,
  });
};
