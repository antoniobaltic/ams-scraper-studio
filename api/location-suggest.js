// Proxy for the AMS open location suggestions endpoint (no auth needed).
// Called from the frontend autocomplete; we proxy here to avoid CORS issues.
module.exports = async function handler(req, res) {
  const text = String(req.query.text || '').trim();
  if (text.length < 2) return res.json([]);

  const url =
    `https://jobs.ams.at/public/emps/api/open/suggestions/location` +
    `?text=${encodeURIComponent(text)}&count=8`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://jobs.ams.at/public/emps/jobs',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) return res.json([]);
    const data = await response.json();
    return res.json(Array.isArray(data) ? data : []);
  } catch {
    return res.json([]);
  }
};
