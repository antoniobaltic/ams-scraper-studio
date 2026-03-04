const filtersEl = document.getElementById('filters');
const addFilterBtn = document.getElementById('addFilter');
const runBtn = document.getElementById('run');
const statusEl = document.getElementById('status');
const resultCard = document.getElementById('resultCard');

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
    key: row.querySelector('.fKey').value,
    value: row.querySelector('.fValue').value,
  }));
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
runBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Scrape läuft...';
  runBtn.disabled = true;

  const payload = {
    query: document.getElementById('query').value,
    location: document.getElementById('location').value,
    radius: document.getElementById('radius').value,
    max_pages: Number(document.getElementById('maxPages').value),
    max_jobs: Number(document.getElementById('maxJobs').value),
    filters: readFilters(),
  };

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scrape fehlgeschlagen');

    resultCard.hidden = false;
    document.getElementById('summary').textContent = `${data.job_count} Jobs extrahiert.`;
    document.getElementById('searchUrl').textContent = data.search_url;
    document.getElementById('csvLink').href = data.downloads.csv;
    document.getElementById('xlsxLink').href = data.downloads.xlsx;

    const errorsEl = document.getElementById('errors');
    errorsEl.innerHTML = '';
    if (data.errors?.length) {
      const html = `<p id="error"><strong>Warnungen:</strong><br>${data.errors.join('<br>')}</p>`;
      errorsEl.innerHTML = html;
    }

    renderPreview(data.preview || []);
    statusEl.textContent = 'Fertig.';
  } catch (err) {
    statusEl.textContent = `Fehler: ${err.message}`;
  } finally {
    runBtn.disabled = false;
  }
});

addFilterRow('JOB_OFFER_TYPE', 'SB_WKO');
addFilterRow('JOB_OFFER_TYPE', 'IJ');
addFilterRow('JOB_OFFER_TYPE', 'BA');
addFilterRow('JOB_OFFER_TYPE', 'BZ');
addFilterRow('JOB_OFFER_TYPE', 'TN');
