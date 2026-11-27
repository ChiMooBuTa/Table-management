// ธีมสี ชื่องาน และสัญลักษณ์ของงาน
import { EVENT_NAME, EVENT_ID } from '../config.js';
import { $, esc, clean } from './util.js';

export const PRESETS = {
  'เขียวทอง': { primary: '#2f5d50', accent: '#b8914a', bg: '#faf7f2' },
  'ชมพูกุหลาบ': { primary: '#a94f6b', accent: '#d4a373', bg: '#fff6f6' },
  'น้ำเงินกรมท่า': { primary: '#1f3a5f', accent: '#c9a54e', bg: '#f5f7fb' },
  'ม่วงลาเวนเดอร์': { primary: '#6b5290', accent: '#b9a0d0', bg: '#f9f6fc' },
  'แดงไวน์': { primary: '#7a2434', accent: '#c8a165', bg: '#fbf6f1' },
  'ครีมแชมเปญ': { primary: '#e8d5b0', accent: '#a8843f', bg: '#fffcf5' }
};
const DEFAULT = PRESETS['เขียวทอง'];
const SYMBOLS = ['💍', '💐', '🤍', '🌸', '🕊️', '🥂'];
const HEX = /^#[0-9a-f]{6}$/i;
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOGO = 300000;
const CACHE = 'wedding-theme:' + EVENT_ID;

export function normalizeSettings(s = {}) {
  const color = k => (HEX.test(s?.[k]) ? s[k].toLowerCase() : DEFAULT[k]);
  const logo = typeof s?.logo === 'string' && s.logo.length <= MAX_LOGO && LOGO.test(s.logo) ? s.logo : '';
  return { name: clean(s?.name).slice(0, 80), primary: color('primary'), accent: color('accent'), bg: color('bg'), symbol: clean(s?.symbol).slice(0, 12), logo };
}

/* ---------- ปรับสีให้อ่านออกเสมอ ---------- */
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const luminance = hex => rgb(hex).map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
function until(color, target, ok) {
  let c = color;
  for (let t = 0.05; !ok(c) && t <= 1.001; t += 0.05) c = mix(color, target, t);
  return c;
}

export const logoHtml = (s, cls = 'logo') => s.logo ? `<img class="${cls}" src="${s.logo}" alt="สัญลักษณ์งาน">` : s.symbol ? `<span class="${cls} text">${esc(s.symbol)}</span>` : '';

export function applyTheme(settings) {
  const s = normalizeSettings(settings), root = document.documentElement.style;
  const bg = until(s.bg, '#ffffff', c => luminance(c) >= 0.82); // พื้นหลังต้องสว่าง
  const ink = until(s.primary, '#000000', c => contrast(c, bg) >= 4.5 && contrast(c, '#ffffff') >= 4.5);
  const dark = '#1f2723';
  const onBrand = contrast(s.primary, '#ffffff') >= contrast(s.primary, dark) ? '#ffffff' : dark;
  for (const [k, v] of Object.entries({ '--brand': s.primary, '--gold': s.accent, '--bg': bg, '--brand-ink': ink, '--on-brand': onBrand })) root.setProperty(k, v);
  const name = s.name || EVENT_NAME;
  $('#title').textContent = name;
  document.title = name + ' • เช็คอิน';
  $('#brandlogo')?.remove();
  $('#title').insertAdjacentHTML('beforebegin', logoHtml(s).replace('class="logo', 'id="brandlogo" class="logo'));
  const icon = $('link[rel=icon]');
  if (icon) icon.href = s.logo || (s.symbol ? 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="54" font-size="${s.symbol.length > 2 ? 40 : 76}" text-anchor="middle" dominant-baseline="middle">${esc(s.symbol)}</text></svg>`) : 'data:,');
  return s;
}

// จำธีมล่าสุดไว้ในเครื่อง เพื่อให้หน้าเข้าสู่ระบบแสดงธีมเดียวกัน
export const cacheTheme = s => { try { localStorage.setItem(CACHE, JSON.stringify(s)); } catch {} };
export const cachedTheme = () => { try { return normalizeSettings(JSON.parse(localStorage.getItem(CACHE)) || {}); } catch { return normalizeSettings(); } };

/** ย่อรูปให้เล็กพอจะเก็บในฐานข้อมูล */
async function readLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('เปิดรูปนี้ไม่ได้ ให้ใช้ไฟล์ PNG หรือ JPG'); }
    for (const size of [256, 192, 128, 96]) {
      const w = img.naturalWidth || size, h = img.naturalHeight || size, k = Math.min(1, size / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png');
      if (data.length <= MAX_LOGO) return data;
    }
    throw new Error('รูปมีรายละเอียดมากเกินไป ลองใช้รูปอื่น');
  } finally { URL.revokeObjectURL(url); }
}

/** หน้าตั้งค่า: แสดงตัวอย่างทันที และซิงก์ทุกเครื่องเมื่อกดบันทึก */
export function themeView(el, { current, onSave, toast }) {
  let draft = { ...current() };
  const color = (k, label) => `<label>${label}<input type="color" name="${k}"></label>`;
  el.innerHTML = `<form class="panels theme">
    <section><h2>ธีมสี</h2><div class="presets">${Object.entries(PRESETS).map(([n, p]) => `<button type="button" data-preset="${n}"><i style="background:${p.primary}"></i><i style="background:${p.accent}"></i><i style="background:${p.bg}"></i> ${n}</button>`).join('')}</div>
      <div class="colors">${color('primary', 'สีหลัก')}${color('accent', 'สีเน้น')}${color('bg', 'สีพื้นหลัง')}</div><p class="muted">สีสถานะที่นั่ง เขียว แดง เทา คงเดิม</p></section>
    <section><h2>สัญลักษณ์ของงาน</h2><label>ชื่องาน<input name="name" maxlength="80" placeholder="${esc(EVENT_NAME)}"></label>
      <div id="logopreview"></div><label class="filebtn">อัปโหลดโลโก้<input type="file" id="logofile" accept="image/png,image/jpeg,image/webp"></label><button type="button" id="logoremove">ลบรูป</button>
      <label>หรือใช้ข้อความ / อีโมจิ (เช่น A&amp;B)<input name="symbol" maxlength="12"></label><div class="presets">${SYMBOLS.map(x => `<button type="button" data-symbol="${x}">${x}</button>`).join('')}</div></section>
    <section><h2>บันทึก</h2><p class="muted">ตอนนี้เห็นตัวอย่างเฉพาะเครื่องนี้ กดบันทึกเพื่อใช้กับทุกเครื่อง</p><button class="primary">บันทึกธีม</button><button type="button" id="themeundo">ยกเลิกการแก้ไข</button></section></form>`;
  const form = $('form', el);
  const show = () => {
    for (const k of ['name', 'primary', 'accent', 'bg', 'symbol']) if (form.elements[k] !== document.activeElement) form.elements[k].value = draft[k];
    $('#logopreview', el).innerHTML = logoHtml(draft, 'logo big') || '<p class="muted">ยังไม่มีสัญลักษณ์</p>';
    $('#logoremove', el).hidden = !draft.logo;
    applyTheme(draft);
  };
  let dirty = false;
  const change = patch => { dirty = true; draft = { ...draft, ...patch }; show(); };
  form.oninput = e => {
    const { name, value } = e.target;
    if (name) change(name === 'symbol' && value ? { symbol: value, logo: '' } : { [name]: value });
  };
  form.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.preset) change(PRESETS[b.dataset.preset]);
    if (b.dataset.symbol) change({ symbol: b.dataset.symbol, logo: '' });
    if (b.id === 'logoremove') change({ logo: '' });
    if (b.id === 'themeundo') { dirty = false; draft = { ...current() }; show(); }
  };
  $('#logofile', el).onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try { change({ logo: await readLogo(file) }); } catch (err) { toast(err.message, true); }
  };
  form.onsubmit = e => { e.preventDefault(); draft = normalizeSettings(draft); dirty = false; onSave(draft); show(); };
  show();
  return {
    update() { if (!dirty) draft = { ...current() }; show(); },
    destroy() { applyTheme(current()); }
  };
}
