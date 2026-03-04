from __future__ import annotations

import csv
import io
import json
import re
import uuid
import zipfile
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

BASE_URL = "https://jobs.ams.at"
SEARCH_PATH = "/public/emps/jobs"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
EXPORT_DIR = ROOT / "exports"
EXPORT_DIR.mkdir(exist_ok=True)


@dataclass
class JobRecord:
    id: str
    title: str = ""
    company: str = ""
    location: str = ""
    posted_at: str = ""
    employment_type: str = ""
    url: str = ""
    description: str = ""


def fetch_html(url: str) -> str:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=20) as response:
        return response.read().decode("utf-8", errors="ignore")


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.next_link: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        attrs_dict = {k: v or "" for k, v in attrs}
        href = attrs_dict.get("href", "")
        rel = attrs_dict.get("rel", "")
        if "/public/emps/job/" in href:
            self.links.append(href)
        if rel == "next" and href:
            self.next_link = href


def parse_job_links(html: str) -> tuple[list[str], str | None]:
    parser = LinkParser()
    parser.feed(html)
    links = parser.links
    if not links:
        links = re.findall(r'href=["\']([^"\']*/public/emps/job/[^"\']+)["\']', html)
    return links, parser.next_link


def parse_json_ld(html: str) -> dict[str, Any]:
    scripts = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )
    for script in scripts:
        cleaned = unescape(script).strip()
        if not cleaned:
            continue
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            for entry in data:
                if isinstance(entry, dict) and entry.get("@type") == "JobPosting":
                    return entry
        if isinstance(data, dict):
            if data.get("@type") == "JobPosting":
                return data
            graph = data.get("@graph")
            if isinstance(graph, list):
                for entry in graph:
                    if isinstance(entry, dict) and entry.get("@type") == "JobPosting":
                        return entry
    return {}


def extract_job_id(job_url: str) -> str:
    match = re.search(r"/job/(\d+)", job_url)
    return match.group(1) if match else ""


def parse_job_detail(url: str) -> JobRecord:
    html = fetch_html(url)
    payload = parse_json_ld(html)
    jid = extract_job_id(url)
    company = payload.get("hiringOrganization", {}) if isinstance(payload.get("hiringOrganization"), dict) else {}
    location = payload.get("jobLocation", {}) if isinstance(payload.get("jobLocation"), dict) else {}
    address = location.get("address", {}) if isinstance(location.get("address"), dict) else {}
    description = re.sub(r"<[^>]+>", " ", payload.get("description", ""))
    description = re.sub(r"\s+", " ", description).strip()
    return JobRecord(
        id=jid,
        title=str(payload.get("title", "")).strip(),
        company=str(company.get("name", "")).strip(),
        location=str(address.get("addressLocality", "")).strip(),
        posted_at=str(payload.get("datePosted", "")).strip(),
        employment_type=str(payload.get("employmentType", "")).strip(),
        url=url,
        description=description,
    )


def build_search_url(query: str, location: str, radius: str, raw_params: dict[str, list[str]]) -> str:
    params: list[tuple[str, str]] = []
    if query:
        params.append(("query", query))
    if location:
        params.append(("location", location))
    if radius:
        params.append(("radius", radius))
    for key, values in raw_params.items():
        for value in values:
            if value:
                params.append((key, value))
    query_string = urlencode(params, doseq=True)
    return f"{BASE_URL}{SEARCH_PATH}?{query_string}" if query_string else f"{BASE_URL}{SEARCH_PATH}"


def collect_jobs(search_url: str, max_pages: int = 20, max_jobs: int = 500) -> tuple[list[JobRecord], list[str]]:
    visited_pages: set[str] = set()
    collected_links: list[str] = []
    errors: list[str] = []
    current_url = search_url
    for _ in range(max_pages):
        if current_url in visited_pages:
            break
        visited_pages.add(current_url)
        try:
            html = fetch_html(current_url)
        except (URLError, HTTPError) as exc:
            errors.append(f"Could not fetch search page {current_url}: {exc}")
            break

        links, next_link = parse_job_links(html)
        for link in links:
            full = urljoin(BASE_URL, link)
            if full not in collected_links:
                collected_links.append(full)
            if len(collected_links) >= max_jobs:
                break
        if len(collected_links) >= max_jobs:
            break

        if next_link:
            current_url = urljoin(BASE_URL, next_link)
            continue

        parsed = urlparse(current_url)
        qs = parse_qs(parsed.query)
        page = int(qs.get("page", ["1"])[0])
        qs["page"] = [str(page + 1)]
        next_candidate = parsed._replace(query=urlencode(qs, doseq=True)).geturl()
        if next_candidate == current_url:
            break
        current_url = next_candidate

    jobs: list[JobRecord] = []
    for job_url in collected_links[:max_jobs]:
        try:
            jobs.append(parse_job_detail(job_url))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Failed to parse {job_url}: {exc}")

    return jobs, errors


def jobs_to_csv(jobs: list[JobRecord]) -> bytes:
    columns = ["id", "title", "company", "location", "posted_at", "employment_type", "url", "description"]
    sio = io.StringIO()
    writer = csv.DictWriter(sio, fieldnames=columns)
    writer.writeheader()
    for job in jobs:
        writer.writerow(job.__dict__)
    return sio.getvalue().encode("utf-8")


def column_label(col_index: int) -> str:
    result = ""
    while col_index:
        col_index, rem = divmod(col_index - 1, 26)
        result = chr(65 + rem) + result
    return result


def escape_xml(text: Any) -> str:
    value = str(text if text is not None else "")
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def jobs_to_xlsx(jobs: list[JobRecord]) -> bytes:
    columns = ["id", "title", "company", "location", "posted_at", "employment_type", "url", "description"]
    rows = [columns] + [[getattr(job, col) for col in columns] for job in jobs]

    sheet_rows: list[str] = []
    for r_idx, row in enumerate(rows, start=1):
        cells: list[str] = []
        for c_idx, value in enumerate(row, start=1):
            ref = f"{column_label(c_idx)}{r_idx}"
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape_xml(value)}</t></is></c>')
        sheet_rows.append(f'<row r="{r_idx}">{"".join(cells)}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="jobs" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )

    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/></Relationships>'
    )

    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)

    return out.getvalue()


def parse_filters(raw_filters: list[dict[str, str]]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for item in raw_filters:
        key = item.get("key", "").strip()
        value = item.get("value", "").strip()
        if not key:
            continue
        grouped.setdefault(key, []).append(value)
    return grouped


class Handler(BaseHTTPRequestHandler):
    def _json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path: Path, content_type: str) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ["/", "/index.html"]:
            self._serve_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return
        if self.path == "/styles.css":
            self._serve_file(WEB_DIR / "styles.css", "text/css; charset=utf-8")
            return
        if self.path == "/app.js":
            self._serve_file(WEB_DIR / "app.js", "application/javascript; charset=utf-8")
            return
        if self.path.startswith("/exports/"):
            rel = self.path[len("/exports/"):]
            target = EXPORT_DIR / rel
            if target.suffix == ".csv":
                ctype = "text/csv"
            elif target.suffix == ".xlsx":
                ctype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            else:
                ctype = "application/octet-stream"
            self._serve_file(target, ctype)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/scrape":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._json({"error": "Invalid JSON body."}, status=400)
            return

        query = str(payload.get("query", "")).strip()
        location = str(payload.get("location", "")).strip()
        radius = str(payload.get("radius", "")).strip()
        max_pages = min(max(int(payload.get("max_pages", 5)), 1), 100)
        max_jobs = min(max(int(payload.get("max_jobs", 200)), 1), 2000)
        filters = parse_filters(payload.get("filters", []))

        search_url = build_search_url(query, location, radius, filters)
        jobs, errors = collect_jobs(search_url, max_pages=max_pages, max_jobs=max_jobs)

        export_id = uuid.uuid4().hex
        csv_name = f"{export_id}.csv"
        xlsx_name = f"{export_id}.xlsx"
        (EXPORT_DIR / csv_name).write_bytes(jobs_to_csv(jobs))
        (EXPORT_DIR / xlsx_name).write_bytes(jobs_to_xlsx(jobs))

        self._json(
            {
                "search_url": search_url,
                "job_count": len(jobs),
                "errors": errors,
                "preview": [job.__dict__ for job in jobs[:15]],
                "downloads": {
                    "csv": f"/exports/{csv_name}",
                    "xlsx": f"/exports/{xlsx_name}",
                },
            }
        )


def run() -> None:
    host = "0.0.0.0"
    port = 8000
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"AMS scraper running on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
