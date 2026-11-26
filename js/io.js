// นำเข้า/ส่งออก JSON และ Excel
import { readXlsx, readCsv, writeXlsx } from './xlsx.js';
import { clean, norm, num, byGuest, byTable, normalizeGuest, normalizeItem, normalizeRoom, toMap, TYPES, uid } from './util.js';

export const GUEST_HEADERS = ['ลำดับ', 'ชื่อสกุลไทย', 'ชื่อสกุลEng', 'ตำแหน่ง', 'ความสัมพันธ์', 'สถานะเช็คอิน', 'โต๊ะ'];
const GUEST_KEYS = ['no', 'th', 'en', 'pos', 'rel', 'checked', 'table'];
const LAYOUT_HEADERS = ['id', 'ประเภท', 'ชื่อ', 'คำอธิบาย', 'X', 'Y', 'กว้าง', 'สูง', 'หมุน', 'รูปทรง', 'ที่นั่ง'];
export const CHECKED_TEXT = 'เช็คอินแล้ว', UNCHECKED_TEXT = 'ยังไม่เช็คอิน';

const headerKey = s => norm(s).replace(/[\s\-_./]/g, '').replace(/เช็ก/g, 'เช็ค');

/** คืน true / false / null (ช่องว่าง = ไม่ระบุ) */
export function parseStatus(v) {
  const s = headerKey(v);
  if (!s) return null;
  if (/^(ยัง|ไม่|no|not|false|0|x|-|รอ|pending)/.test(s)) return false;
  return /^(เช็คอิน|มาแล้ว|แล้ว|yes|y|true|1|checked|✓|✔)/.test(s);
}

export function parseSheets(sheets) {
  const result = {};
  for (const { rows } of sheets) {
    const find = test => rows.slice(0, 10).findIndex(r => test(r.map(headerKey)));
    const gi = find(h => h.includes(headerKey('ชื่อสกุลไทย')) || h.includes(headerKey('ชื่อสกุลEng')));
    if (gi >= 0 && !result.guests) {
      const header = rows[gi].map(headerKey);
      const cols = GUEST_HEADERS.map(h => header.indexOf(headerKey(h)));
      result.missing = GUEST_HEADERS.filter((_, i) => cols[i] < 0);
      result.guests = rows.slice(gi + 1).map(r => {
        const g = Object.fromEntries(GUEST_KEYS.map((k, i) => [k, cols[i] < 0 ? '' : clean(r[cols[i]])]));
        const status = parseStatus(g.checked);
        return { ...normalizeGuest({ ...g, checked: status === true }), status };
      }).filter(g => g.th || g.en);
      continue;
    }
    const li = find(h => h.includes('ประเภท') && h.includes('x') && h.includes('y'));
    if (li >= 0 && !result.layout) {
      const header = rows[li].map(headerKey);
      const get = (r, name) => { const i = header.indexOf(headerKey(name)); return i < 0 ? '' : clean(r[i]); };
      let room = null; const items = [];
      for (const r of rows.slice(li + 1)) {
        const label = get(r, 'ประเภท');
        if (label === 'ห้อง') { room = { w: get(r, 'กว้าง'), h: get(r, 'สูง') }; continue; }
        const type = Object.keys(TYPES).find(k => k === label.toLowerCase() || TYPES[k].label === label);
        if (!type) continue;
        items.push({ id: get(r, 'id'), type, name: get(r, 'ชื่อ'), desc: get(r, 'คำอธิบาย'), x: get(r, 'X'), y: get(r, 'Y'), w: get(r, 'กว้าง'), h: get(r, 'สูง'), rot: get(r, 'หมุน'), shape: ['rect', 'เหลี่ยม'].includes(get(r, 'รูปทรง')) ? 'rect' : 'round', seats: get(r, 'ที่นั่ง') });
      }
      result.layout = { room: normalizeRoom(room), items: toMap(items, normalizeItem, 'i') };
    }
  }
  return result;
}

export async function parseFile(file) {
  const buffer = await file.arrayBuffer();
  if (/\.json$/i.test(file.name)) {
    let data;
    try { data = JSON.parse(new TextDecoder().decode(buffer).replace(/^﻿/, '')); }
    catch { throw new Error('ไฟล์ JSON เสียหายหรือรูปแบบไม่ถูกต้อง'); }
    const result = {};
    if (data?.guests) result.guests = Object.values(toMap(data.guests, g => ({ ...normalizeGuest(g), status: typeof g.checked === 'boolean' ? g.checked : null }), 'g'));
    if (data?.layout) result.layout = { room: normalizeRoom(data.layout.room), items: toMap(data.layout.items, normalizeItem, 'i') };
    if (result.guests) result.guests = result.guests.filter(g => g.th || g.en);
    return result;
  }
  return parseSheets(/\.csv$/i.test(file.name) ? readCsv(buffer) : await readXlsx(buffer));
}

const identity = g => `${norm(g.th)}|${norm(g.en)}`;

/** สร้าง map รายชื่อใหม่จากข้อมูลนำเข้า
 *  merge: จับคู่ด้วยชื่อ (ถ้าชื่อซ้ำใช้ลำดับช่วย) ช่องสถานะ/โต๊ะที่ว่างจะคงค่าเดิม */
export function buildGuests(incoming, current, mode) {
  const out = mode === 'merge' ? structuredClone(current) : {};
  const used = new Set(); let added = 0, updated = 0;
  for (const { status, ...g } of incoming) {
    let id = null;
    if (mode === 'merge') {
      const same = Object.keys(current).filter(k => !used.has(k) && identity(current[k]) === identity(g));
      id = same.find(k => current[k].no === g.no) ?? same[0] ?? null;
    }
    const old = id ? current[id] : null;
    if (old) { used.add(id); updated++; } else { id = uid('g'); added++; }
    const checked = status ?? old?.checked ?? false;
    out[id] = normalizeGuest({
      ...g, table: g.table || old?.table || '', checked,
      checkedAt: checked ? g.checkedAt || old?.checkedAt || Date.now() : null
    });
  }
  return { guests: out, added, updated };
}

export function toJson(guests, room, items) {
  return JSON.stringify({
    version: 1, exportedAt: new Date().toISOString(),
    guests: Object.entries(guests).map(([id, g]) => ({ id, ...g })).sort(byGuest),
    layout: { room, items: Object.entries(items).map(([id, i]) => ({ id, ...i })) }
  }, null, 2);
}

export function toExcel(guests, room, items) {
  const asNum = v => (v !== '' && String(num(v, NaN)) === v ? +v : v);
  const guestRows = Object.values(guests).sort(byGuest).map(g => [asNum(g.no), g.th, g.en, g.pos, g.rel, g.checked ? CHECKED_TEXT : UNCHECKED_TEXT, asNum(g.table)]);
  const layoutRows = Object.entries(items)
    .sort(([, a], [, b]) => a.type.localeCompare(b.type) || byTable(a.name, b.name))
    .map(([id, i]) => [id, TYPES[i.type].label, i.name, i.desc, i.x, i.y, i.w, i.h, i.rot, i.shape === 'rect' ? 'เหลี่ยม' : 'กลม', i.seats]);
  return writeXlsx([
    { name: 'รายชื่อแขก', rows: [GUEST_HEADERS, ...guestRows], widths: [8, 28, 28, 22, 18, 16, 8] },
    { name: 'ผังโต๊ะ', rows: [LAYOUT_HEADERS, ['', 'ห้อง', '', '', '', '', room.w, room.h, '', '', ''], ...layoutRows], widths: [22, 10, 12, 28, 8, 8, 8, 8, 8, 10, 8] }
  ]);
}

export const templateExcel = () => writeXlsx([{
  name: 'รายชื่อแขก', widths: [8, 28, 28, 22, 18, 16, 8],
  rows: [GUEST_HEADERS,
    [1, 'นายสมชาย ใจดี', 'Mr. Somchai Jaidee', 'ผู้จัดการ', 'เพื่อนเจ้าบ่าว', UNCHECKED_TEXT, 1],
    [2, 'นางสาวสมหญิง รักไทย', 'Ms. Somying Rakthai', 'ครู', 'ญาติเจ้าสาว', UNCHECKED_TEXT, 2]]
}]);
