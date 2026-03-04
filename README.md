# AMS Scraper Studio

Minimal micro-SaaS styled web app that scrapes jobs from the Austrian AMS job portal and exports structured results as CSV + Excel.

## What this app does

- Recreates AMS search input behavior with:
  - `query` (job term)
  - `location`
  - `radius`
  - arbitrary raw AMS URL parameters (`key=value`, including repeated keys)
- Crawls paginated search result pages.
- Opens each job detail page and extracts structured job metadata (via JSON-LD `JobPosting` when available).
- Generates:
  - CSV export
  - XLSX export
- Shows a preview table in the UI.

## Scraping strategy (click-through across all pages)

1. Build AMS search URL using user-provided inputs and filters.
2. Download search result HTML.
3. Parse all job detail links (`/public/emps/job/...`).
4. Follow pagination:
   - Prefer `<a rel="next">` when present.
   - Fallback to incrementing `page` query parameter.
5. For every collected detail link:
   - Fetch detail page
   - Parse `application/ld+json`
   - Extract `JobPosting` fields like title, organization, location, date, employment type, description.
6. Write normalized rows to CSV and XLSX.

## Run locally

```bash
python3 server.py
```

Then open: `http://localhost:8000`

## Notes

- The app uses only Python standard library (no pip install required).
- If AMS changes HTML structure or parameter names, adjust parser rules in `server.py`.
