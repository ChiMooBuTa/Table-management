export const $ = (s, el = document) => el.querySelector(s);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
export const num = (v, d = 0) => (v !== '' && v != null && Number.isFinite(+v) ? +v : d);
export const tableName = v => clean(v).replace(/^(โต๊ะ|table)\s*(ที่|no\.?)?\s*/i, '');
export const byTable = (a, b) => String(a).localeCompare(String(b), 'th', { numeric: true });
export const byGuest = (a, b) => (num(a.no, 1e9) - num(b.no, 1e9)) || a.th.localeCompare(b.th, 'th');

const TITLES = /^(นางสาว|นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|คุณ|ดร\.|(mr|mrs|ms|miss|dr|khun)(\.|\s))\s*/i;
export const norm = s => clean(s).normalize('NFC').replace(/ํา/g, 'ำ').replace(/[​-‍﻿]/g, '').toLowerCase();

/** คะแนนการค้นหาแบบคำขึ้นต้น: 0 = ขึ้นต้นชื่อ, 1 = ขึ้นต้นคำอื่น (เช่น นามสกุล), -1 = ไม่ตรง */
export function matchScore(guest, query) {
  const q = norm(query);
  if (!q) return -1;
  let best = -1;
  for (const raw of [guest.th, guest.en]) {
    const full = norm(raw);
    if (!full) continue;
    const bare = full.replace(TITLES, '');
    if (full.startsWith(q) || bare.startsWith(q)) return 0;
    const words = bare.split(' ');
    if (words.some((_, i) => i > 0 && words.slice(i).join(' ').startsWith(q))) best = 1;
  }
  return best;
}

export function normalizeGuest(g = {}) {
  return {
    no: clean(g.no), th: clean(g.th), en: clean(g.en), pos: clean(g.pos), rel: clean(g.rel),
    checked: g.checked === true, checkedAt: g.checked === true ? num(g.checkedAt) || null : null,
    table: tableName(g.table),
    giftAt: num(g.giftAt) > 0 ? num(g.giftAt) : null // เวลารับของชำร่วย (null = ยังไม่รับ)
  };
}

export const TYPES = {
  table: { label: 'โต๊ะ', w: 90, h: 90 },
  stage: { label: 'เวที', w: 360, h: 100 },
  aisle: { label: 'ทางเดิน', w: 80, h: 400 },
  door: { label: 'ประตู', w: 110, h: 30 },
  label: { label: 'ข้อความ', w: 160, h: 40 }
};
export const DEFAULT_ROOM = { w: 1200, h: 800 };

export function normalizeItem(i = {}) {
  const type = TYPES[i.type] ? i.type : 'label';
  const t = TYPES[type];
  return {
    type, name: type === 'table' ? tableName(i.name) : clean(i.name),
    desc: type === 'table' ? clean(i.desc).slice(0, 80) : '',
    x: num(i.x, 100), y: num(i.y, 100),
    w: Math.max(20, num(i.w, t.w)), h: Math.max(20, num(i.h, t.h)),
    rot: ((num(i.rot) % 360) + 360) % 360,
    shape: i.shape === 'rect' ? 'rect' : 'round',
    seats: Math.max(0, Math.round(num(i.seats, type === 'table' ? 10 : 0)))
  };
}
export const normalizeRoom = r => ({
  w: Math.min(6000, Math.max(300, num(r?.w, DEFAULT_ROOM.w))),
  h: Math.min(6000, Math.max(300, num(r?.h, DEFAULT_ROOM.h)))
});

const KEY_OK = /^[A-Za-z0-9_-]{1,80}$/;
/** แปลง array/object ที่นำเข้า ให้เป็น map ที่ใช้เป็นคีย์ Firebase ได้ */
export function toMap(source, normalize, prefix) {
  const out = {};
  const entries = Array.isArray(source) ? source.map(v => [v?.id, v]) : Object.entries(source || {});
  for (const [key, value] of entries) {
    if (!value) continue;
    const k = typeof key === 'string' && KEY_OK.test(key) && !Object.hasOwn(out, key) && key !== '__proto__' ? key : uid(prefix);
    out[k] = normalize(value);
  }
  return out;
}
