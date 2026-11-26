// อ่าน/เขียนไฟล์ .xlsx และ .csv โดยไม่ใช้ไลบรารีภายนอก
const enc = new TextEncoder();
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = b => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };

function zip(files) {
  const parts = [], central = []; let offset = 0;
  const rec = (...fields) => {
    const out = new Uint8Array(fields.reduce((n, f) => n + f[0], 0)), v = new DataView(out.buffer); let p = 0;
    for (const [size, val] of fields) { size === 2 ? v.setUint16(p, val, true) : v.setUint32(p, val, true); p += size; }
    return out;
  };
  for (const [name, text] of files) {
    const n = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const common = [[2, 20], [2, 0x800], [2, 0], [2, 0], [2, 0x21], [4, crc], [4, data.length], [4, data.length], [2, n.length], [2, 0]];
    const local = rec([4, 0x04034b50], ...common);
    central.push(rec([4, 0x02014b50], [2, 20], ...common, [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]), n);
    parts.push(local, n, data); offset += local.length + n.length + data.length;
  }
  const size = central.reduce((s, a) => s + a.length, 0);
  const end = rec([4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length], [4, size], [4, offset], [2, 0]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function unzip(buffer) {
  const b = new Uint8Array(buffer), v = new DataView(buffer);
  let e = b.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ไฟล์นี้ไม่ใช่ .xlsx ที่ถูกต้อง (ถ้าเป็น .xls หรือมีรหัสผ่าน ให้บันทึกใหม่เป็น .xlsx)');
  const entries = new Map(); let p = v.getUint32(e + 16, true);
  for (let i = 0; i < v.getUint16(e + 10, true); i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
    entries.set(name, { method, data: b.subarray(start, start + size) });
    p += 46 + nl + xl + cl;
  }
  return async name => {
    const f = entries.get(name);
    if (!f) return null;
    if (f.method === 0) return new TextDecoder().decode(f.data);
    return new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const tags = (el, name) => [...el.getElementsByTagNameNS('*', name)];
const richText = el => tags(el, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('');
const colIndex = ref => [...ref.match(/^[A-Z]*/)[0]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** คืนค่า [{ name, rows: string[][] }] */
export async function readXlsx(buffer) {
  const get = await unzip(buffer);
  const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('ไม่พบชีตในไฟล์ Excel');
  const targets = Object.fromEntries(tags(xml(rels), 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sst = await get('xl/sharedStrings.xml');
  const shared = sst ? tags(xml(sst), 'si').map(richText) : [];
  const sheets = [];
  for (const s of tags(xml(wb), 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets[rid] || '';
    const content = await get(target.startsWith('/') ? target.slice(1) : 'xl/' + target);
    if (!content) continue;
    const rows = tags(xml(content), 'row').map(row => {
      const out = []; let next = 0;
      for (const c of tags(row, 'c')) {
        const ref = c.getAttribute('r'), i = ref ? colIndex(ref) : next;
        next = i + 1;
        const type = c.getAttribute('t'), val = tags(c, 'v')[0]?.textContent ?? '';
        out[i] = type === 's' ? shared[+val] ?? '' : type === 'inlineStr' ? richText(c) : type === 'b' ? (val === '1' ? 'TRUE' : 'FALSE') : val;
      }
      return Array.from(out, x => x ?? '');
    });
    sheets.push({ name: s.getAttribute('name'), rows });
  }
  return sheets;
}

export function readCsv(buffer) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder('windows-874').decode(buffer); } // CSV จาก Excel ภาษาไทย
  const rows = [[]]; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"' && !cell) quoted = true;
    else if (c === ',') { rows.at(-1).push(cell); cell = ''; }
    else if (c === '\n') { rows.at(-1).push(cell.replace(/\r$/, '')); cell = ''; rows.push([]); }
    else cell += c;
  }
  rows.at(-1).push(cell.replace(/\r$/, ''));
  return [{ name: 'CSV', rows }];
}

const xesc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/** sheets: [{ name, rows: (string|number)[][], widths?: number[] }] แถวแรกเป็นหัวตาราง */
export function writeXlsx(sheets) {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  const sheetXml = ({ rows, widths = [] }) => `${head}<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    (widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '') +
    `<sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const a = `r="${colName(c)}${r + 1}"${r === 0 ? ' s="1"' : ''}`;
      return typeof v === 'number' && Number.isFinite(v) ? `<c ${a}><v>${v}</v></c>` : `<c ${a} t="inlineStr"><is><t xml:space="preserve">${xesc(v ?? '')}</t></is></c>`;
    }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return zip([
    ['[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${head}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${head}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="${pkg}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `${head}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)])
  ]);
}
