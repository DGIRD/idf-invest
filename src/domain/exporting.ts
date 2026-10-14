/**
 * Exports réels : CSV (UTF-8, séparateur « ; », décimales à virgule pour Excel en français),
 * Excel au format .xlsx (Office Open XML généré avec JSZip, pas de HTML renommé), JSON.
 */
import JSZip from 'jszip';

export type ExportKind = 'text' | 'money' | 'percent' | 'number' | 'date' | 'url';
export interface ExportColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
  kind?: ExportKind;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const esc = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const fmt = (v: unknown, kind?: ExportKind) => {
    if (v === null || v === undefined) return '';
    if (isNum(v)) {
      const fixed = kind === 'money' || kind === 'percent' ? v.toFixed(2) : String(Math.round(v * 1e6) / 1e6);
      return fixed.replace('.', ',');
    }
    // neutralise les formules (injection CSV)
    const s = String(v);
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map((c) => esc(fmt(c.value(r), c.kind))).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const xmlEsc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    // caractères de contrôle interdits en XML 1.0
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Date ISO → numéro de série Excel (calendrier 1900). */
export function excelSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return utc / 86400000 + 25569;
}

// styles : 0 normal, 1 en-tête, 2 monétaire, 3 date, 4 pourcentage (valeur déjà en %), 5 nombre
const STYLE: Record<ExportKind, number> = { text: 0, url: 0, money: 2, date: 3, percent: 4, number: 5 };

export interface Sheet<T> {
  name: string;
  columns: ExportColumn<T>[];
  rows: T[];
}

export async function toXlsx(sheets: Sheet<any>[]): Promise<Blob> {
  const zip = new JSZip();
  const names = sheets.map((s, i) => (s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Feuille${i + 1}`));
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>');
  zip.file('docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:creator>Immo-Zen</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
  zip.file('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>');
  zip.file('xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.00\\ &quot;%&quot;"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs></styleSheet>');

  sheets.forEach((sheet, si) => {
    const rowsXml: string[] = [];
    const header = sheet.columns.map((c, ci) => `<c r="${colName(ci)}1" t="inlineStr" s="1"><is><t>${xmlEsc(c.label)}</t></is></c>`).join('');
    rowsXml.push(`<row r="1">${header}</row>`);
    sheet.rows.forEach((row, ri) => {
      const r = ri + 2;
      const cells = sheet.columns.map((c, ci) => {
        const ref = `${colName(ci)}${r}`;
        const v = c.value(row);
        const kind = c.kind ?? 'text';
        if (v === null || v === undefined || v === '') return '';
        if (kind === 'date' && typeof v === 'string') {
          const serial = excelSerial(v);
          if (serial !== null) return `<c r="${ref}" s="3"><v>${serial}</v></c>`;
        }
        if (isNum(v)) return `<c r="${ref}" s="${STYLE[kind]}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
      }).join('');
      rowsXml.push(`<row r="${r}">${cells}</row>`);
    });
    const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(45, Math.max(10, c.label.length + 4))}" customWidth="1"/>`).join('');
    zip.file(`xl/worksheets/sheet${si + 1}.xml`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (cols ? `<cols>${cols}</cols>` : '') +
      `<sheetData>${rowsXml.join('')}</sheetData></worksheet>`);
  });

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp(d = new Date()): string {
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
}
