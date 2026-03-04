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
  // HMAC message is signed with raw (unencoded) values — the server decodes
  // query params before verifying, so encoding them would break the signature
  // for any non-ASCII characters (Umlauts, etc.)
  const rawStr  = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  const urlStr  = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const random = randomBytes(8).toString('hex');
  const message = 'GET' + urlPath + rawStr + 'X-AMS-ACCESS-TOKEN-RANDOM=' + random;
  const token = createHmac('sha512', HMAC_KEY).update(message, 'utf8').digest('hex');
  return {
    url: `${BASE_URL}${urlPath}?${urlStr}`,
    headers: { 'x-ams-access-token': token, 'x-ams-access-token-random': random },
  };
}

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function stripHtml(value) {
  return decodeEntities(
    String(value || '').replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
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
    url: `${BASE_URL}/public/emps/jobs/uuid/${job.uuid}`,
  };
}

// Fetch one AMS page; retries on 429 with exponential backoff (1s → 2s → 4s → 8s).
async function fetchPageWithRetry(paramPairs, maxRetries = 4) {
  let delay = 1000;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const { url, headers } = buildRequest(API_PATH, paramPairs);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://jobs.ams.at/public/emps/jobs',
          ...headers,
        },
      });
      if (!response.ok) {
        const hints = {
          400: 'Ungültige Suchanfrage (400) – wahrscheinlich wurde ein Ort eingetippt statt aus der Vorschlagsliste gewählt, oder der Umkreis ist ohne gültigen Ort gesetzt.',
          401: 'Keine Berechtigung (401) – kurzzeitiger API-Fehler oder der interne Schlüssel ist abgelaufen. Bei wiederholtem Auftreten den Betreiber informieren.',
          403: 'Zugriff verweigert (403) – die Anfrage wurde vom AMS-Server blockiert.',
          429: 'Zu viele Anfragen (429) – Anfrage wird wiederholt …',
          500: 'AMS-Server-Fehler (500) – vorübergehender Fehler auf der AMS-Seite, wird wiederholt …',
          502: 'AMS nicht erreichbar (502) – vorübergehender Netzwerkfehler, wird wiederholt …',
          503: 'AMS nicht verfügbar (503) – Server vorübergehend überlastet, wird wiederholt …',
          504: 'AMS-Timeout (504) – der AMS-Server antwortet nicht, wird wiederholt …',
        };
        const msg = hints[response.status] ?? `AMS API Fehler: ${response.status}`;
        // 400 and 403 won't succeed on retry; everything else might
        if (response.status === 400 || response.status === 403) throw new Error(msg);
        lastErr = new Error(msg);
        delay = Math.min(delay * 2, 16000);
        continue;
      }
      return await response.json();
    } catch (err) {
      lastErr = err;
      delay = Math.min(delay * 2, 16000);
    }
  }
  throw lastErr;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const query      = String(body.query      || '').trim();
  const location   = String(body.location   || '').trim();
  const locationId = String(body.locationId || '').trim();
  const radius     = String(body.radius     ?? '').trim();
  const maxPages   = Math.min(Math.max(Number(body.maxPages || 5),   1), 100);
  const maxJobs    = Math.min(Math.max(Number(body.maxJobs  || 200), 1), 3000);
  const filters    = Array.isArray(body.filters) ? body.filters : [];

  // Server-Sent Events headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/proxy buffering
  res.flushHeaders?.();

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  let totalRows = 0;
  const allErrors = [];

  try {
    for (let page = 1; page <= maxPages && totalRows < maxJobs; page++) {
      const paramPairs = [
        ['page',      String(page)],
        ['pageSize',  String(PAGE_SIZE)],
        ['sortField', '_SCORE'],
      ];
      if (query)                                    paramPairs.push(['query',    query]);
      if (location)                                 paramPairs.push(['location', location]);
      if (locationId)                               paramPairs.push(['locationId', locationId]);
      if (location && radius && radius !== '0')     paramPairs.push(['vicinity', radius]);
      for (const f of filters) {
        const k = String(f?.key   || '').trim();
        const v = String(f?.value || '').trim();
        if (k && v) paramPairs.push([k, v]);
      }

      try {
        const data = await fetchPageWithRetry(paramPairs);
        const rows = (data.results || []).map(mapJob).slice(0, maxJobs - totalRows);
        totalRows += rows.length;

        send({
          type:         'page',
          page,
          totalPages:   data.totalPages   || 1,
          totalResults: data.totalResults || 0,
          rows,
        });

        if (page >= (data.totalPages || 1)) break;
      } catch (err) {
        allErrors.push(`Seite ${page}: ${err.message}`);
        send({ type: 'error', page, message: err.message });
        break;
      }
    }
  } finally {
    send({ type: 'done', totalRows, errors: allErrors });
    res.end();
  }
};
