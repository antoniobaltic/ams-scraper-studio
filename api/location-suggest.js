const { DEFAULT_HEADERS, LOCATION_SUGGEST_URL } = require('../lib/ams');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  const text = String(req.query && req.query.text ? req.query.text : '').trim();
  if (text.length < 2) {
    return res.status(200).json([]);
  }

  const url = `${LOCATION_SUGGEST_URL}?text=${encodeURIComponent(text)}&count=8`;

  try {
    const response = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      return res.status(200).json([]);
    }
    const data = await response.json();
    return res.status(200).json(Array.isArray(data) ? data : []);
  } catch {
    return res.status(200).json([]);
  }
};
