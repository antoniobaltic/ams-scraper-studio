const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { buildCsv, buildWorkbook } = require('../public/export');

test('buildCsv uses BOM, German headers, and semicolon delimiters', () => {
  const csv = buildCsv([
    {
      title: 'Softwareentwickler',
      company: 'Beispiel GmbH',
      location: 'Wien',
      state: 'Wien',
      zip: '1010',
      posted_at: '2026-03-06',
      working_time: 'Vollzeit',
      employment_type: 'Angestellt',
      job_offer_type: 'AMS',
      education: 'FH',
      id: '123',
      url: 'https://example.com/job',
      description: 'Beschreibung',
    },
  ]);

  const lines = csv.split('\r\n');
  assert.match(lines[0], /^\ufeffTitel;Unternehmen;Ort;Bundesland;PLZ;/);
  assert.match(lines[1], /^Softwareentwickler;Beispiel GmbH;Wien;/);
});

test('buildCsv neutralizes spreadsheet formula prefixes', () => {
  const csv = buildCsv([
    {
      title: '=cmd',
      company: '+unsafe',
      location: '@loc',
      state: '-state',
      zip: '1010',
      posted_at: '2026-03-06',
      working_time: 'Vollzeit',
      employment_type: 'Angestellt',
      job_offer_type: 'AMS',
      education: 'FH',
      id: '123',
      url: 'https://example.com/job',
      description: 'Beschreibung',
    },
  ]);

  assert.match(csv, /'=cmd/);
  assert.match(csv, /'\+unsafe/);
  assert.match(csv, /'@loc/);
  assert.match(csv, /'-state/);
});

test('buildWorkbook persists styling and hyperlink formatting in xlsx exports', async () => {
  const workbook = buildWorkbook([
    {
      title: 'Softwareentwickler',
      company: 'Beispiel GmbH',
      location: 'Wien',
      state: 'Wien',
      zip: '1010',
      posted_at: '2026-03-06',
      working_time: 'Vollzeit',
      employment_type: 'Angestellt',
      job_offer_type: 'AMS',
      education: 'FH',
      id: '123',
      url: 'https://example.com/job',
      description: 'Mehrzeilige Beschreibung',
    },
  ], 'AMS Jobs', ExcelJS);

  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);

  const sheet = reloaded.getWorksheet('AMS Jobs');
  assert.equal(sheet.getCell('A1').value, 'Titel');
  assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FF2563EB');
  assert.equal(sheet.getCell('A1').font.color.argb, 'FFFFFFFF');
  assert.equal(sheet.getCell('A2').fill.fgColor.argb, 'FFEEF4FF');
  assert.equal(sheet.getCell('L2').value.hyperlink, 'https://example.com/job');
  assert.equal(sheet.getCell('L2').font.color.argb, 'FF2563EB');
  assert.equal(sheet.getCell('M2').alignment.wrapText, true);
  assert.ok(sheet.getColumn(1).width >= 32);
});
