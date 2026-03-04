const filtersEl   = document.getElementById('filters');
const addFilterBtn = document.getElementById('addFilter');
const clearBtn    = document.getElementById('clear');
const scrapeForm  = document.getElementById('scrapeForm');
const runBtn      = document.getElementById('run');
const statusEl    = document.getElementById('status');
const resultCard  = document.getElementById('resultCard');

const DEFAULT_FILTERS = [
  ['JOB_OFFER_TYPE', 'SB_WKO'],
  ['JOB_OFFER_TYPE', 'IJ'],
  ['JOB_OFFER_TYPE', 'BA'],
  ['JOB_OFFER_TYPE', 'BZ'],
  ['JOB_OFFER_TYPE', 'TN'],
];

function addFilterRow(key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'filterRow';
  row.innerHTML = `
    <input class="fKey" placeholder="Parametername (z.B. JOB_OFFER_TYPE)" value="${key}" />
    <input class="fValue" placeholder="Wert (z.B. SB_WKO)" value="${value}" />
    <button class="ghost remove" type="button">✕</button>
  `;
  row.querySelector('.remove').addEventListener('click', () => row.remove());
  filtersEl.appendChild(row);
}

function readFilters() {
  return [...filtersEl.querySelectorAll('.filterRow')].map((row) => ({
    key:   row.querySelector('.fKey').value,
    value: row.querySelector('.fValue').value,
  }));
}

function resetForm() {
  document.getElementById('query').value    = '';
  document.getElementById('location').value = '';
  document.getElementById('radius').value   = '0';
  document.getElementById('maxPages').value = '5';
  document.getElementById('maxJobs').value  = '200';
  filtersEl.innerHTML = '';
  DEFAULT_FILTERS.forEach(([k, v]) => addFilterRow(k, v));
  resultCard.hidden   = true;
  statusEl.textContent = '';
  statusEl.className  = '';
}

function setStatus(text, type = 'idle') {
  statusEl.textContent = text;
  statusEl.className   = type; // 'idle' | 'error'
}

function renderPreview(rows) {
  const table = document.getElementById('previewTable');
  table.innerHTML = '';
  if (!rows.length) {
    table.innerHTML = '<tr><td>Keine Treffer.</td></tr>';
    return;
  }
  const columns = Object.keys(rows[0]);
  const head = document.createElement('tr');
  head.innerHTML = columns.map((c) => `<th>${c}</th>`).join('');
  table.appendChild(head);
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = columns.map((c) => `<td>${row[c] ?? ''}</td>`).join('');
    table.appendChild(tr);
  });
}

addFilterBtn.addEventListener('click', () => addFilterRow());
clearBtn.addEventListener('click', resetForm);

scrapeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('Scrape läuft…');
  runBtn.disabled = true;
  runBtn.textContent = 'Scraping…';

  const payload = {
    query:     document.getElementById('query').value,
    location:  document.getElementById('location').value,
    radius:    document.getElementById('radius').value,
    max_pages: Number(document.getElementById('maxPages').value),
    max_jobs:  Number(document.getElementById('maxJobs').value),
    filters:   readFilters(),
  };

  try {
    const res  = await fetch('/api/scrape', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scrape fehlgeschlagen');

    resultCard.hidden = false;
    document.getElementById('summary').textContent = `${data.job_count} Jobs extrahiert.`;

    const searchUrlEl = document.getElementById('searchUrl');
    const url = data.search_url;
    searchUrlEl.innerHTML = url
      ? `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
      : '';

    document.getElementById('csvLink').href  = data.downloads.csv;
    document.getElementById('xlsxLink').href = data.downloads.xlsx;

    const errorsEl = document.getElementById('errors');
    errorsEl.innerHTML = '';
    if (data.errors?.length) {
      errorsEl.innerHTML = `<p class="errMsg"><strong>Warnungen:</strong><br>${data.errors.join('<br>')}</p>`;
    }

    renderPreview(data.preview || []);
    setStatus('Fertig.');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(`Fehler: ${err.message}`, 'error');
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Scrapen & Exportieren';
  }
});

// Seed default filters on load
DEFAULT_FILTERS.forEach(([k, v]) => addFilterRow(k, v));
