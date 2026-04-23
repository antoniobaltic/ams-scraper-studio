const { createHmac, randomBytes } = require('crypto');

const BASE_URL = 'https://jobs.ams.at';
const SEARCH_API_PATH = '/public/emps/api/search';
const LOCATION_SUGGEST_URL = `${BASE_URL}/public/emps/api/open/suggestions/location`;
const HMAC_KEY = 'nj9i0gfg5f2jugig6mk8z102d5mmyl1lxcyqh5oc5txfi3lhdexl7fgezepugp5j';
const PAGE_SIZE = 30;

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://jobs.ams.at/public/emps/jobs',
};

const STATUS_HINTS = {
  400: 'Ungueltige Suchanfrage (400) - wahrscheinlich wurde ein Ort eingetippt statt aus der Vorschlagsliste gewaehlt, oder der Umkreis ist ohne gueltigen Ort gesetzt.',
  401: 'Keine Berechtigung (401) - API-Zugriff abgelehnt.',
  403: 'Zugriff verweigert (403) - die Anfrage wurde vom AMS-Server blockiert.',
  429: 'Zu viele Anfragen (429) - AMS hat die Anfrage temporaer limitiert.',
  500: 'AMS-Server-Fehler (500) - voruebergehender Fehler auf der AMS-Seite.',
  502: 'AMS nicht erreichbar (502) - voruebergehender Netzwerkfehler.',
  503: 'AMS nicht verfuegbar (503) - Server voruebergehend ueberlastet.',
  504: 'AMS-Timeout (504) - der AMS-Server antwortet nicht rechtzeitig.',
};

class AmsApiError extends Error {
  constructor(message, status, retryable) {
    super(message);
    this.name = 'AmsApiError';
    this.status = status;
    this.retryable = Boolean(retryable);
  }
}

function statusToMessage(status) {
  return STATUS_HINTS[status] || `AMS API Fehler: ${status}`;
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function sortPairs(paramPairs) {
  return [...paramPairs].sort((a, b) => {
    const keyCompare = a[0].localeCompare(b[0]);
    return keyCompare !== 0 ? keyCompare : a[1].localeCompare(b[1]);
  });
}

function buildSignedSearchRequest(paramPairs) {
  const sorted = sortPairs(paramPairs);

  // AMS validates the signature on the decoded query string.
  const rawString = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  const encodedString = sorted
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const random = randomBytes(8).toString('hex');
  const message = `GET${SEARCH_API_PATH}${rawString}X-AMS-ACCESS-TOKEN-RANDOM=${random}`;
  const token = createHmac('sha512', HMAC_KEY).update(message, 'utf8').digest('hex');

  return {
    url: `${BASE_URL}${SEARCH_API_PATH}?${encodedString}`,
    headers: {
      ...DEFAULT_HEADERS,
      'x-ams-access-token': token,
      'x-ams-access-token-random': random,
    },
  };
}

async function fetchSearchPageOnce(paramPairs) {
  const { url, headers } = buildSignedSearchRequest(paramPairs);
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const status = response.status;
    throw new AmsApiError(statusToMessage(status), status, isRetryableStatus(status));
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new AmsApiError('AMS API lieferte ungueltiges JSON.', 502, false);
  }

  if (!data || !Array.isArray(data.results)) {
    throw new AmsApiError('Unerwartetes AMS API-Antwortformat.', 502, false);
  }

  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSearchPageWithRetry(paramPairs, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 0;
  const maxDelayMs = Number.isInteger(options.maxDelayMs) ? options.maxDelayMs : 16000;
  let delayMs = Number.isInteger(options.initialDelayMs) ? options.initialDelayMs : 1000;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(delayMs);
    }

    try {
      return await fetchSearchPageOnce(paramPairs);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err instanceof AmsApiError && !err.retryable) {
        throw err;
      }
      lastError = err;
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }

  throw lastError || new Error('AMS request failed.');
}

function decodeEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripHtml(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function mapJob(job) {
  const address = job && job.company && job.company.address ? job.company.address : {};
  const education = Array.isArray(job && job.educationLevels)
    ? job.educationLevels
        .map((entry) => (entry && entry.description ? String(entry.description) : ''))
        .filter(Boolean)
        .join(', ')
    : '';

  return {
    id: String((job && job.id) || ''),
    title: String((job && job.title) || ''),
    company: String((job && job.company && job.company.name) || ''),
    location: String(address.municipality || ''),
    state: String(address.federalState || ''),
    zip: String(address.zipCode || ''),
    posted_at: String((job && job.lastUpdatedAt) || '').split('T')[0],
    working_time: String((job && job.workingTime && job.workingTime.description) || ''),
    employment_type: String((job && job.employmentRelationship && job.employmentRelationship.description) || ''),
    job_offer_type: String((job && job.jobOfferType && job.jobOfferType.description) || ''),
    education,
    description: stripHtml(job && job.summary),
    url: `${BASE_URL}/public/emps/jobs/${job && job.uuid ? job.uuid : ''}`,
  };
}

module.exports = {
  AmsApiError,
  BASE_URL,
  DEFAULT_HEADERS,
  LOCATION_SUGGEST_URL,
  PAGE_SIZE,
  fetchSearchPageWithRetry,
  mapJob,
  statusToMessage,
};
