const { createHmac, randomBytes } = require('crypto');

const BASE_URL = 'https://jobs.ams.at';
const API_PATH = '/public/emps/api/search';
const HMAC_KEY = 'chn6bl40obysw581p33f98okhd3gm6185p791868cxfozkdko635r50xhh99v1kz';

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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const params = [
      ['keyword', 'a'],
      ['page', '1'],
      ['pageSize', '1'],
    ];
    const { url, headers } = buildRequest(API_PATH, params);

    const response = await fetch(url, {
      headers: {
        ...headers,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(500).json({ status: 'error', message: `AMS API returned ${response.status}` });
    }

    const data = await response.json();
    const hasResults = Array.isArray(data?.data) || typeof data?.totalCount === 'number';

    if (!hasResults) {
      return res.status(500).json({ status: 'error', message: 'Unexpected AMS API response shape' });
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};
