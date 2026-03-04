'use strict';

const runBtn = document.getElementById('run');
const clearBtn = document.getElementById('clear');
const statusEl = document.getElementById('status');
const resultCard = document.getElementById('resultCard');
const csvBtn = document.getElementById('csvBtn');
const xlsxBtn = document.getElementById('xlsxBtn');
const openResultsBtn = document.getElementById('openResults');
const locationInput = document.getElementById('location');
const locationList = document.getElementById('locationList');

let locationId = '';
let latestRows = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sammleFilter() {
  const map = new Map();
  document.querySelectorAll('input[data-filter-key]').forEach((el) => {
    if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
    const v = String(el.value || '').trim();
    if (!v) return;
    const k = el.dataset.filterKey;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  });
  return [...map.entries()].flatMap(([k, vs]) => vs.map((v) => ({ key: k, value: v })));
}

// ─── State persistence ────────────────────────────────────────────────────────

function saveState() {
  const filterStates = {};
  document.querySelectorAll('input[data-filter-key]').forEach((el) => {
    filterStates[`${el.dataset.filterKey}|${el.value}|${el.type}`] = el.checked;
  });
  try {
    localStorage.setItem('ams_search_state', JSON.stringify({
      query: document.getElementById('query').value,
      location: locationInput.value,
      locationId,
      radius: document.getElementById('radius').value,
      maxPages: document.getElementById('maxPages').value,
      maxJobs: document.getElementById('maxJobs').value,
      filterStates,
    }));
  } catch (_) {}
}

function restoreState() {
  try {
    const s = JSON.parse(localStorage.getItem('ams_search_state') || 'null');
    if (!s) return;
    if (s.query)    document.getElementById('query').value = s.query;
    if (s.location) locationInput.value = s.location;
    if (s.locationId) locationId = s.locationId;
    if (s.radius)   document.getElementById('radius').value = s.radius;
    if (s.maxPages) document.getElementById('maxPages').value = s.maxPages;
    if (s.maxJobs)  document.getElementById('maxJobs').value = s.maxJobs;
    if (s.filterStates) {
      document.querySelectorAll('input[data-filter-key]').forEach((el) => {
        const key = `${el.dataset.filterKey}|${el.value}|${el.type}`;
        if (key in s.filterStates) el.checked = s.filterStates[key];
      });
    }
  } catch (_) {}
}

// Persist on any form input/change (event bubbles up to layout)
document.querySelector('.layout').addEventListener('input', saveState);
document.querySelector('.layout').addEventListener('change', saveState);

// ─── Reset ────────────────────────────────────────────────────────────────────

function resetForm() {
  document.getElementById('query').value = '';
  locationInput.value = '';
  locationId = '';
  updateRadiusState();
  document.getElementById('maxPages').value = '10';
  document.getElementById('maxJobs').value = '120';

  // Restore default checkbox/radio states
  document.querySelectorAll('input[data-filter-key]').forEach((el) => {
    if (el.type === 'checkbox') {
      // Default: jobOfferTypes SB_WKO, IJ, BA checked; everything else unchecked
      el.checked = el.dataset.filterKey === 'jobOfferTypes' &&
        ['SB_WKO', 'IJ', 'BA'].includes(el.value);
    } else if (el.type === 'radio') {
      el.checked = el.value === ''; // "Alle" radio
    }
  });

  resultCard.hidden = true;
  latestRows = [];
  statusEl.textContent = '';
  statusEl.className = '';
  try { localStorage.removeItem('ams_search_state'); } catch (_) {}
}

clearBtn.addEventListener('click', resetForm);

// ─── Location autocomplete ────────────────────────────────────────────────────

let acTimeout = null;
let acActiveIndex = -1;

function updateRadiusState() {
  document.getElementById('radius').disabled = !locationInput.value.trim();
}

locationInput.addEventListener('input', () => {
  locationId = ''; // user typing → stored ID is stale
  updateRadiusState();
  const text = locationInput.value.trim();
  clearTimeout(acTimeout);
  if (text.length < 2) { hideAc(); return; }
  acTimeout = setTimeout(() => fetchAcSuggestions(text), 300);
});

async function fetchAcSuggestions(text) {
  try {
    const res = await fetch(`/api/location-suggest?text=${encodeURIComponent(text)}`);
    renderAcList(await res.json());
  } catch { hideAc(); }
}

function renderAcList(items) {
  if (!Array.isArray(items) || !items.length) { hideAc(); return; }
  acActiveIndex = -1;
  locationList.innerHTML = items
    .map((it) =>
      `<li data-id="${escHtml(it.locationId)}" data-text="${escHtml(it.text)}">${escHtml(it.text)}</li>`)
    .join('');
  locationList.hidden = false;
}

function hideAc() {
  locationList.hidden = true;
  locationList.innerHTML = '';
  acActiveIndex = -1;
}

function selectAcItem(li) {
  locationInput.value = li.dataset.text;
  locationId = li.dataset.id;
  hideAc();
  saveState();
}

locationList.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) selectAcItem(li);
});

locationInput.addEventListener('keydown', (e) => {
  const items = [...locationList.querySelectorAll('li')];

  if (locationList.hidden || !items.length) {
    if (e.key === 'Enter') runBtn.click();
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acActiveIndex = Math.min(acActiveIndex + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acActiveIndex = Math.max(acActiveIndex - 1, -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (acActiveIndex >= 0 && items[acActiveIndex]) {
      selectAcItem(items[acActiveIndex]);
    } else {
      hideAc();
      runBtn.click();
    }
    return;
  } else if (e.key === 'Escape') {
    hideAc();
    return;
  } else {
    return;
  }

  items.forEach((li, i) => li.classList.toggle('ac-active', i === acActiveIndex));
  if (acActiveIndex >= 0) items[acActiveIndex].scrollIntoView({ block: 'nearest' });
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.autocomplete-wrap')) hideAc();
});

// ─── Enter to submit ──────────────────────────────────────────────────────────

document.getElementById('query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runBtn.click();
});

// ─── Downloads ────────────────────────────────────────────────────────────────

function downloadBlob(content, name, type) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type })),
    download: name,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const hs = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? '');
    return s.includes('"') || s.includes(',') || s.includes('\n')
      ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [hs.join(','), ...rows.map((r) => hs.map((h) => esc(r[h])).join(','))].join('\n');
}

csvBtn.addEventListener('click', () =>
  downloadBlob(toCsv(latestRows), 'ams_jobs.csv', 'text/csv;charset=utf-8'));

xlsxBtn.addEventListener('click', () => {
  if (!latestRows.length) return;
  const ws = XLSX.utils.json_to_sheet(latestRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'jobs');
  XLSX.writeFile(wb, 'ams_jobs.xlsx');
});

// ─── Results tab ──────────────────────────────────────────────────────────────

function openResultsTab() {
  const w = window.open('/results.html', 'ams_results');
  if (w) w.focus();
}
openResultsBtn.addEventListener('click', openResultsTab);

// ─── Main search ──────────────────────────────────────────────────────────────

runBtn.addEventListener('click', async () => {
  saveState();
  statusEl.textContent = 'Suche läuft …';
  statusEl.className = '';
  runBtn.disabled = true;
  runBtn.textContent = 'Suche läuft …';
  resultCard.hidden = true;

  // Open the results tab now while we still have the user gesture context,
  // otherwise popup blockers will prevent window.open() after the first await.
  const resultsWin = window.open('/results.html', 'ams_results');

  const query    = document.getElementById('query').value.trim();
  const location = locationInput.value.trim();
  const radius   = document.getElementById('radius').value;
  const maxPages = Math.min(Math.max(Number(document.getElementById('maxPages').value), 1), 100);
  const maxJobs  = Math.min(Math.max(Number(document.getElementById('maxJobs').value), 1), 3000);
  const filters  = sammleFilter();

  // Build a human-readable search URL up front (needed for incremental persist)
  const dp = new URLSearchParams({ sortField: '_SCORE' });
  if (query)              dp.set('query', query);
  if (location)           dp.set('location', location);
  if (location && radius) dp.set('vicinity', radius);
  const searchUrl = `https://jobs.ams.at/public/emps/api/search?${dp}`;

  const payload = {
    query, location, filters,
    locationId: locationId || undefined,
    radius, maxPages, maxJobs,
  };

  const allRows = [];
  const errors  = [];
  let totalResults = 0;

  function persistResults(streaming) {
    localStorage.setItem('ams_results', JSON.stringify({
      job_count:     allRows.length,
      total_results: totalResults,
      search_url:    searchUrl,
      errors,
      rows:          allRows,
      streaming,
    }));
  }

  try {
    const res = await fetch('/api/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Suche fehlgeschlagen');
    }

    // Read Server-Sent Events incrementally
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop(); // keep any incomplete trailing chunk

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }

        if (event.type === 'page') {
          totalResults = event.totalResults || totalResults;
          allRows.push(...event.rows);
          persistResults(true); // streaming still in progress

          statusEl.textContent =
            `${allRows.length}` +
            (totalResults ? ` von ${totalResults.toLocaleString('de-AT')}` : '') +
            ` Jobs geladen (Seite ${event.page}` +
            (event.totalPages > 1 ? ` von ${Math.min(maxPages, event.totalPages)}` : '') +
            ') …';

        } else if (event.type === 'error') {
          errors.push(`Seite ${event.page}: ${event.message}`);
        }
      }
    }

    latestRows = allRows;
    persistResults(false); // mark stream complete
    if (resultsWin) resultsWin.focus(); else openResultsTab();

    resultCard.hidden = false;
    document.getElementById('summary').textContent =
      `${allRows.length} Jobs geladen` +
      (totalResults ? ` (${totalResults.toLocaleString('de-AT')} gesamt gefunden)` : '') + '.';
    document.getElementById('searchUrl').textContent = searchUrl;
    document.getElementById('errors').innerHTML = errors.length
      ? `<p id="error"><strong>Hinweise:</strong> ${errors.join(' · ')}</p>`
      : '';

    csvBtn.disabled  = !allRows.length;
    xlsxBtn.disabled = !allRows.length;
    statusEl.textContent = 'Fertig.';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    statusEl.textContent = `Fehler: ${err.message}`;
    statusEl.className = 'error';
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Jetzt suchen \u0026 exportieren';
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
restoreState();
updateRadiusState();
