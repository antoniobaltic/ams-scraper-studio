(function (root) {
  'use strict';

  const BLUE = 'FF2563EB';
  const BLUE_LIGHT = 'FFEEF4FF';
  const LINE = 'FFD6DCE4';
  const TEXT = 'FF0F1720';
  const WHITE = 'FFFFFFFF';
  const EXPORT_COLUMNS = [
    { key: 'title', label: 'Titel', width: 32 },
    { key: 'company', label: 'Unternehmen', width: 26 },
    { key: 'location', label: 'Ort', width: 16 },
    { key: 'state', label: 'Bundesland', width: 14 },
    { key: 'zip', label: 'PLZ', width: 9 },
    { key: 'posted_at', label: 'Datum', width: 13 },
    { key: 'working_time', label: 'Arbeitszeit', width: 14 },
    { key: 'employment_type', label: 'Dienstverhältnis', width: 20 },
    { key: 'job_offer_type', label: 'Quelle', width: 18 },
    { key: 'education', label: 'Ausbildung', width: 22 },
    { key: 'id', label: 'AMS ID', width: 12 },
    { key: 'url', label: 'Link', width: 34 },
    { key: 'description', label: 'Beschreibung', width: 58, wrap: true },
  ];

  const LIGHT_BORDER = {
    top: { style: 'thin', color: { argb: LINE } },
    right: { style: 'thin', color: { argb: LINE } },
    bottom: { style: 'thin', color: { argb: LINE } },
    left: { style: 'thin', color: { argb: LINE } },
  };
  const HEADER_BORDER = {
    top: { style: 'thin', color: { argb: BLUE } },
    right: { style: 'thin', color: { argb: BLUE } },
    bottom: { style: 'thin', color: { argb: BLUE } },
    left: { style: 'thin', color: { argb: BLUE } },
  };

  function sanitizeValue(value) {
    const text = String(value == null ? '' : value).replace(/\r\n/g, '\n');
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  function getColumnValues(row) {
    return EXPORT_COLUMNS.map((column) => sanitizeValue(row[column.key]));
  }

  function escapeCsvValue(value) {
    const text = sanitizeValue(value);
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildCsv(rows) {
    const header = EXPORT_COLUMNS.map((column) => escapeCsvValue(column.label)).join(';');
    const lines = rows.map((row) => getColumnValues(row).map(escapeCsvValue).join(';'));
    return `\ufeff${[header, ...lines].join('\r\n')}`;
  }

  function downloadBlob(blob, fileName) {
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: fileName,
    });
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function downloadCsv(rows, fileName) {
    downloadBlob(
      new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' }),
      fileName
    );
  }

  function getExcelJs(excelJsLib) {
    if (excelJsLib) {
      return excelJsLib;
    }
    if (root.ExcelJS) {
      return root.ExcelJS;
    }
    if (typeof require === 'function') {
      try {
        return require('exceljs');
      } catch (_) {}
    }
    throw new Error('ExcelJS library is not available.');
  }

  function lastColumnRef() {
    return EXPORT_COLUMNS.reduce((label, _, index) => {
      let current = index + 1;
      let value = '';
      while (current > 0) {
        const remainder = (current - 1) % 26;
        value = String.fromCharCode(65 + remainder) + value;
        current = Math.floor((current - 1) / 26);
      }
      return value;
    }, 'A');
  }

  function mapRowForWorkbook(row) {
    return EXPORT_COLUMNS.reduce((mapped, column) => {
      const value = sanitizeValue(row[column.key]);
      if (column.key === 'url' && value) {
        mapped[column.key] = { text: value, hyperlink: value };
      } else {
        mapped[column.key] = value;
      }
      return mapped;
    }, {});
  }

  function buildWorkbook(rows, sheetName, excelJsLib) {
    const ExcelJSLib = getExcelJs(excelJsLib);
    const workbook = new ExcelJSLib.Workbook();
    const worksheet = workbook.addWorksheet(sheetName || 'AMS Jobs', {
      properties: { defaultRowHeight: 20 },
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    workbook.creator = 'AMS Scraper Studio';
    workbook.lastModifiedBy = 'AMS Scraper Studio';
    workbook.created = new Date();
    workbook.modified = new Date();

    worksheet.columns = EXPORT_COLUMNS.map((column) => ({
      header: column.label,
      key: column.key,
      width: column.width,
    }));
    worksheet.autoFilter = `A1:${lastColumnRef()}1`;

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: WHITE } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = HEADER_BORDER;
    });

    rows.forEach((row) => {
      const excelRow = worksheet.addRow(mapRowForWorkbook(row));
      excelRow.height = 20;
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const striped = rowNumber % 2 === 0;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const column = EXPORT_COLUMNS[colNumber - 1];
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: striped ? BLUE_LIGHT : WHITE },
        };
        cell.font = {
          size: 11,
          color: { argb: column.key === 'url' ? BLUE : TEXT },
          underline: column.key === 'url',
        };
        cell.alignment = {
          vertical: 'top',
          wrapText: Boolean(column.wrap || column.key === 'url'),
        };
        cell.border = LIGHT_BORDER;
      });
    });

    return workbook;
  }

  async function downloadXlsx(rows, fileName, excelJsLib) {
    const workbook = buildWorkbook(rows, 'AMS Jobs', getExcelJs(excelJsLib));
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName
    );
  }

  const api = {
    EXPORT_COLUMNS,
    buildCsv,
    buildWorkbook,
    downloadCsv,
    downloadXlsx,
  };

  root.AmsExport = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof window !== 'undefined' ? window : globalThis));
