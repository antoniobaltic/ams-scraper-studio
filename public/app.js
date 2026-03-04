const runBtn = document.getElementById('run');
const statusEl = document.getElementById('status');
const resultCard = document.getElementById('resultCard');
const csvBtn = document.getElementById('csvBtn');
const xlsxBtn = document.getElementById('xlsxBtn');
const openResultsBtn = document.getElementById('openResults');

let latestRows = [];

function sammleFilter() {
  const filterMap = new Map();
  document.querySelectorAll('input[data-filter-key]').forEach((input) => {
    const key = input.dataset.filterKey;
    if (!key) return;
    if (input.type === 'checkbox' && !input.checked) return;
    if (input.type === 'radio' && !input.checked) return;
    const value = String(input.value || '').trim();
    if (!value) return;
    if (!filterMap.has(key)) filterMap.set(key, []);
    filterMap.get(key).push(value);
  });
  return [...filterMap.entries()].flatMap(([key, values]) => values.map((value) => ({ key, value })));
}

function downloadBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const value = String(v ?? '');
    if (value.includes('"') || value.includes(',') || value.includes('\n')) {
      return `"${value.replaceAll('"', '""')}"`;
    }
    return value;
  };
  const lines = [headers.join(',')];
  rows.forEach((row) => lines.push(headers.map((h) => esc(row[h])).join(',')));
  return lines.join('\n');
}

csvBtn.addEventListener('click', () => {
  downloadBlob(toCsv(latestRows), 'ams_jobs.csv', 'text/csv;charset=utf-8');
});

xlsxBtn.addEventListener('click', () => {
  if (!latestRows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(latestRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'jobs');
  XLSX.writeFile(workbook, 'ams_jobs.xlsx');
});

function openResultsTab() {
  window.open('/results.html', '_blank');
}

openResultsBtn.addEventListener('click', openResultsTab);

runBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Suche läuft …';
  runBtn.disabled = true;

  const payload = {
    query: document.getElementById('query').value,
    location: document.getElementById('location').value,
    radius: document.getElementById('radius').value,
    max_pages: Number(document.getElementById('maxPages').value),
    max_jobs: Number(document.getElementById('maxJobs').value),
    filters: sammleFilter(),
  };

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Suche fehlgeschlagen');

    latestRows = data.rows || [];

    // Persist to localStorage so results.html (new tab) can read it
    localStorage.setItem('ams_results', JSON.stringify({
      job_count: data.job_count,
      search_url: data.search_url,
      errors: data.errors || [],
      rows: latestRows,
    }));

    resultCard.hidden = false;
    document.getElementById('summary').textContent =
      `${data.job_count} Jobs gefunden.`;
    document.getElementById('searchUrl').textContent = data.search_url;

    const errorsEl = document.getElementById('errors');
    errorsEl.innerHTML = '';
    if (data.errors?.length) {
      errorsEl.innerHTML =
        `<p id="error"><strong>Hinweise:</strong><br>${data.errors.join('<br>')}</p>`;
    }

    csvBtn.disabled = latestRows.length === 0;
    xlsxBtn.disabled = latestRows.length === 0;
    statusEl.textContent = 'Fertig.';

    // Auto-open results in new tab
    openResultsTab();
  } catch (error) {
    statusEl.textContent = `Fehler: ${error.message}`;
  } finally {
    runBtn.disabled = false;
  }
});
