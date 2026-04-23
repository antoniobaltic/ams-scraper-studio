# AMS Scraper Studio

A lightweight web app for searching AMS jobs and exporting results to CSV/XLSX.

## Architecture

- Frontend: static files in `public/`
- Backend: serverless handlers in `api/`
- Shared backend logic: `lib/`
- Local development server: `scripts/dev-server.js`
- Test suite: `test/`

## Main Features

- Search AMS jobs with query, location, radius, and filters
- Live streaming of paginated results (SSE)
- Location autocomplete via AMS suggestion API proxy
- Export to CSV and Excel (`.xlsx`) in the browser
- Result table view in a dedicated tab
- Cancel running searches from the UI
- Auto-healing HMAC key extraction when AMS rotates their signing key

## API Endpoints

- `POST /api/stream`
  - Primary endpoint used by the UI
  - Streams search progress as Server-Sent Events: `page`, `error`, `done`
- `POST /api/scrape`
  - Single-page non-streaming fetch (useful for integration/testing)
- `GET /api/location-suggest?text=...`
  - Proxy endpoint for AMS location suggestions
- `GET /api/health`
  - Health check for AMS connectivity and response shape

## Local Development

```bash
npm install
npm run dev
```

Open: `http://localhost:3000`

This default local server does not require Vercel login.

If you want to run with Vercel tooling:

```bash
npm run dev:vercel
```

`dev:vercel` may require `vercel login`.

## Testing

```bash
npm test
```

Current tests cover:

- request parsing and numeric bounds
- location/radius parameter rules
- invalid JSON handling
- stream retry behavior on non-retryable AMS errors
- health endpoint response validation
- location-suggest method guard

## Deployment

Deploy to Vercel:

```bash
vercel
vercel --prod
```

No environment variables are required.

## HMAC Key Auto-Refresh

AMS signs API requests with an HMAC-SHA512 key embedded in their frontend JavaScript. They rotate this key periodically.

When a request returns 401, the scraper automatically:
1. Downloads AMS's current frontend JS bundle
2. Extracts the new signing key via a VM sandbox
3. Caches it in memory and retries the request

To manually check or update the hardcoded default key:

```bash
node scripts/update-ams-key.js          # extract and verify
node scripts/update-ams-key.js --write  # also update lib/ams.js
```

## Notes

- Radius filtering is only sent when a valid `locationId` exists (selected from suggestions).
- If outbound access to `https://jobs.ams.at` is blocked, API endpoints will return corresponding errors.
