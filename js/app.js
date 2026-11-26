import { EVENT_NAME } from '../config.js';
import { store, isLocal } from './store.js';
import { createFloor } from './floor.js';
import { parseFile, buildGuests, toJson, toExcel, templateExcel, CHECKED_TEXT, UNCHECKED_TEXT } from './io.js';
import { $, esc, uid, num, clean, tableName, byTable, byGuest, matchScore, normalizeGuest, normalizeItem, normalizeRoom, TYPES } from './util.js';

const PAGES = {
  admin: { label: 'ผู้ดูแล', tabs: { checkin: 'เช็คอิน', layout: 'ผังโต๊ะ', guests: 'รายชื่อแขก', data: 'นำเข้า / ส่งออก' } },
  door: { label: 'หน้าประตู', tabs: { checkin: 'เช็คอิน', map: 'ผังโต๊ะ' } },
  viewer: { label: 'ดูข้อมูล', tabs: { list: 'รายชื่อแขก', map: 'ผังโต๊ะ' } }
};
const ACCESS = { admin: ['admin', 'door', 'viewer'], door: ['door', 'viewer'], viewer: ['viewer'] };
const LIMIT = 30;

let user, authReady = false, db = { guests: {}, items: {}, room: normalizeRoom() };
let page = 'door', tab = '', view = null; // view = { update() }
const lastTab = {};

/* ---------- ข้อมูล ---------- */
function onData(raw) {
  const map = (src, fn) => Object.fromEntries(Object.entries(src || {}).filter(([, v]) => v).map(([k, v]) => [k, fn(v)]));
  db = { guests: map(raw.guests, normalizeGuest), items: map(raw.layout?.items, normalizeItem), room: normalizeRoom(raw.layout?.room) };
  refresh();
}
const guestList = () => Object.entries(db.guests).map(([id, g]) => ({ id, ...g })).sort(byGuest);
const tables = () => Object.entries(db.items).filter(([, i]) => i.type === 'table');
function tableStats() {
  const stats = new Map();
  for (const g of Object.values(db.guests)) {
    if (!g.table) continue;
    const s = stats.get(g.table) || { total: 0, checked: 0 };
    s.total++; if (g.checked) s.checked++;
    stats.set(g.table, s);
  }
  return stats;
}
const tableNames = () => [...new Set([...tables().map(([, i]) => i.name), ...Object.values(db.guests).map(g => g.table)])].filter(Boolean).sort(byTable);

function save(patch, message) {
  // ไม่รอผลจากเซิร์ฟเวอร์ เพื่อให้ใช้งานต่อได้แม้เน็ตหลุดชั่วคราว
  store.update(patch).catch(e => toast(/permission/i.test(e.message) ? 'ไม่มีสิทธิ์บันทึกข้อมูลนี้' : 'บันทึกไม่สำเร็จ: ' + e.message, true));
  if (message) toast(message);
}

/* ---------- ส่วนประกอบ UI ---------- */
let toastTimer;
function toast(text, bad) {
  const t = $('#toast');
  t.textContent = text; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), bad ? 6000 : 2500);
}
const dialog = $('#dialog');
let dialogRender = null;
function openDialog(render) {
  dialogRender = render; dialog.innerHTML = render();
  if (!dialog.open) dialog.showModal();
}
const closeDialog = () => { dialogRender = null; dialog.close(); };
dialog.addEventListener('close', () => { dialogRender = null; });
dialog.addEventListener('click', e => { if (e.target === dialog || e.target.closest('[data-close]')) closeDialog(); });

const canCheck = () => page !== 'viewer';
const badge = g => `<span class="badge ${g.checked ? 'yes' : ''}">${g.checked ? '✓ ' + CHECKED_TEXT : UNCHECKED_TEXT}</span>`;
const timeText = t => (t ? new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.' : '');
const tableOptions = current => `<option value="">— ไม่ระบุ —</option>` + tableNames().map(n => {
  const s = tableStats().get(n), seat = tables().find(([, i]) => i.name === n)?.[1].seats;
  return `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)} (${s?.total || 0}${seat ? '/' + seat : ''} คน)</option>`;
}).join('');

function guestCard(g) {
  return `<article class="card ${g.checked ? 'in' : ''}">
    <div class="who"><h3>${esc(g.th || g.en)}</h3>${g.th && g.en ? `<p class="en">${esc(g.en)}</p>` : ''}
      <dl><div><dt>ตำแหน่ง</dt><dd>${esc(g.pos || '-')}</dd></div><div><dt>ความสัมพันธ์</dt><dd>${esc(g.rel || '-')}</dd></div></dl>
      ${badge(g)} <small>${g.checked ? timeText(g.checkedAt) : ''}</small></div>
    <div class="seat"><span>โต๊ะ</span><b>${esc(g.table || '-')}</b></div>
    ${canCheck() ? `<div class="actions">
      <button class="${g.checked ? 'ghost' : 'primary big'}" data-act="${g.checked ? 'uncheck' : 'check'}" data-id="${esc(g.id)}">${g.checked ? 'ยกเลิกเช็คอิน' : 'เช็คอิน'}</button>
      <label>แก้ไขโต๊ะ <select data-table="${esc(g.id)}">${tableOptions(g.table)}</select></label></div>` : ''}
  </article>`;
}

function setChecked(id, value) {
  const g = db.guests[id];
  if (!g || !canCheck()) return;
  if (!value && !confirm(`ยกเลิกเช็คอินของ ${g.th || g.en} ?`)) return;
  save({ [`guests/${id}/checked`]: value, [`guests/${id}/checkedAt`]: value ? Date.now() : null }, value ? `เช็คอิน ${g.th || g.en} แล้ว • โต๊ะ ${g.table || '-'}` : 'ยกเลิกเช็คอินแล้ว');
}
function setTable(id, name, select) {
  const g = db.guests[id];
  if (!g || !canCheck()) return;
  const seats = tables().find(([, i]) => i.name === name)?.[1].seats;
  const total = tableStats().get(name)?.total || 0;
  if (seats && total >= seats && !confirm(`โต๊ะ ${name} มีแขกครบ ${seats} ที่นั่งแล้ว ต้องการย้ายเข้าโต๊ะนี้หรือไม่?`)) { select.value = g.table; return; }
  select.blur();
  save({ [`guests/${id}/table`]: name }, `ย้าย ${g.th || g.en} ไปโต๊ะ ${name || '(ไม่ระบุ)'}`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) setChecked(b.dataset.id, b.dataset.act === 'check');
});
document.addEventListener('change', e => { if (e.target.dataset?.table !== undefined) setTable(e.target.dataset.table, e.target.value, e.target); });

/* ---------- เช็คอิน ---------- */
let query = '';
function checkinView(el) {
  el.innerHTML = `<div class="search"><input id="q" type="search" placeholder="พิมพ์คำขึ้นต้นชื่อหรือนามสกุล (ไทย / English)" autocomplete="off" aria-label="ค้นหาแขก" value="${esc(query)}"></div><div id="results" class="cards"></div>`;
  const input = $('#q', el);
  const update = () => {
    const box = $('#results', el);
    if (!clean(query)) { box.innerHTML = `<p class="note">${Object.keys(db.guests).length ? 'พิมพ์ชื่อแขกเพื่อค้นหา' : 'ยังไม่มีรายชื่อแขก ให้ผู้ดูแลนำเข้าไฟล์ Excel ก่อน'}</p>`; return; }
    const found = guestList().map(g => ({ g, s: matchScore(g, query) })).filter(x => x.s >= 0).sort((a, b) => a.s - b.s).map(x => x.g);
    box.innerHTML = found.length
      ? found.slice(0, LIMIT).map(guestCard).join('') + (found.length > LIMIT ? `<p class="note">พบ ${found.length} คน แสดง ${LIMIT} คนแรก พิมพ์เพิ่มเพื่อจำกัดผล</p>` : '')
      : `<p class="note">ไม่พบชื่อที่ขึ้นต้นด้วย “${esc(query)}”</p>`;
  };
  input.oninput = () => { query = input.value; update(); };
  if (matchMedia('(pointer:fine)').matches) input.focus();
  return { update };
}

/* ---------- รายชื่อ (viewer / admin) ---------- */
const filters = { text: '', status: '' };
function listView(el, editable) {
  el.innerHTML = `<div class="toolbar"><input id="f" type="search" placeholder="กรองชื่อ ตำแหน่ง ความสัมพันธ์ โต๊ะ" value="${esc(filters.text)}" aria-label="กรองรายชื่อ">
    <select id="st" aria-label="สถานะ"><option value="">ทุกสถานะ</option><option value="1">${CHECKED_TEXT}</option><option value="0">${UNCHECKED_TEXT}</option></select>
    ${editable ? '<button class="primary" id="add">+ เพิ่มแขก</button>' : ''}</div><p id="count" class="muted"></p>
    <div class="tablewrap"><table><thead><tr><th>ลำดับ</th><th>ชื่อสกุลไทย</th><th>ชื่อสกุล Eng</th><th>ตำแหน่ง</th><th>ความสัมพันธ์</th><th>สถานะเช็คอิน</th><th>โต๊ะ</th>${editable ? '<th></th>' : ''}</tr></thead><tbody></tbody></table></div>`;
  $('#st', el).value = filters.status;
  const update = () => {
    const q = filters.text.toLowerCase().trim();
    const rows = guestList().filter(g => (!filters.status || g.checked === (filters.status === '1')) && (!q || [g.th, g.en, g.pos, g.rel, g.table].some(v => v.toLowerCase().includes(q))));
    $('#count', el).textContent = `แสดง ${rows.length} จาก ${Object.keys(db.guests).length} คน`;
    $('tbody', el).innerHTML = rows.map(g => `<tr><td data-l="ลำดับ">${esc(g.no)}</td><td data-l="ชื่อ" class="name">${esc(g.th)}</td><td data-l="Eng">${esc(g.en)}</td><td data-l="ตำแหน่ง">${esc(g.pos)}</td><td data-l="ความสัมพันธ์">${esc(g.rel)}</td><td data-l="สถานะ">${badge(g)}</td><td data-l="โต๊ะ">${esc(g.table || '-')}</td>${editable ? `<td><button class="ghost" data-edit="${esc(g.id)}">แก้ไข</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="8" class="note">ไม่มีรายชื่อ</td></tr>`;
  };
  $('#f', el).oninput = e => { filters.text = e.target.value; update(); };
  $('#st', el).onchange = e => { filters.status = e.target.value; update(); };
  if (editable) el.onclick = e => {
    if (e.target.id === 'add') editGuest(null);
    else if (e.target.dataset.edit) editGuest(e.target.dataset.edit);
  };
  return { update };
}

function editGuest(id) {
  const g = id ? db.guests[id] : normalizeGuest({ no: String(Math.max(0, ...Object.values(db.guests).map(x => num(x.no))) + 1) });
  const field = (k, label) => `<label>${label}<input name="${k}" value="${esc(g[k])}" maxlength="200"></label>`;
  openDialog(() => `<form id="gform"><h2>${id ? 'แก้ไขข้อมูลแขก' : 'เพิ่มแขก'}</h2>${field('no', 'ลำดับ')}${field('th', 'ชื่อสกุลไทย')}${field('en', 'ชื่อสกุล Eng')}${field('pos', 'ตำแหน่ง')}${field('rel', 'ความสัมพันธ์')}${field('table', 'โต๊ะ')}
    <label class="inline"><input type="checkbox" name="checked" ${g.checked ? 'checked' : ''}> ${CHECKED_TEXT}</label>
    <div class="row"><button class="primary">บันทึก</button><button type="button" data-close>ยกเลิก</button>${id ? '<button type="button" class="danger" id="del">ลบ</button>' : ''}</div></form>`);
  dialogRender = null; // ไม่ให้ข้อมูลที่ซิงก์มาเขียนทับฟอร์มระหว่างพิมพ์
  $('#gform').onsubmit = e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const checked = !!data.checked, latest = id ? db.guests[id] : null;
    const next = normalizeGuest({ ...data, checked, checkedAt: latest?.checkedAt || Date.now() });
    if (!next.th && !next.en) return toast('กรุณากรอกชื่ออย่างน้อยหนึ่งภาษา', true);
    if (!latest) save({ [`guests/${id || uid('g')}`]: next }, 'บันทึกแล้ว');
    else {
      // บันทึกเฉพาะช่องที่ผู้ใช้แก้ เพื่อไม่ทับการเช็คอินจากเครื่องอื่น
      const patch = {};
      for (const k of ['no', 'th', 'en', 'pos', 'rel', 'table', 'checked']) if (next[k] !== g[k]) patch[`guests/${id}/${k}`] = next[k];
      if (next.checked !== g.checked) patch[`guests/${id}/checkedAt`] = next.checkedAt;
      if (Object.keys(patch).length) save(patch, 'บันทึกแล้ว');
    }
    closeDialog();
  };
  const del = $('#del');
  if (del) del.onclick = () => { if (confirm('ลบแขกคนนี้?')) { save({ [`guests/${id}`]: null }, 'ลบแล้ว'); closeDialog(); } };
}

/* ---------- ผังโต๊ะ (ดูอย่างเดียว) ---------- */
function showTable(name) {
  openDialog(() => {
    const members = guestList().filter(g => g.table === name);
    const seats = tables().find(([, i]) => i.name === name)?.[1].seats || 0;
    const checked = members.filter(g => g.checked).length, free = Math.max(0, seats - members.length);
    return `<div class="dhead"><h2>โต๊ะ ${esc(name)}</h2><button data-close>ปิด</button></div>
      <p class="legend"><span class="k in">เช็คอินแล้ว ${checked}</span><span class="k wait">ยังไม่เช็คอิน ${members.length - checked}</span>${seats ? `<span class="k free">ว่าง ${free}</span>` : ''}</p>
      <ul class="members">${members.map(g => `<li><i class="seatdot ${g.checked ? 'in' : 'wait'}"></i><div><b>${esc(g.th || g.en)}</b><small>${esc([g.th && g.en, g.pos, g.rel].filter(Boolean).join(' • '))}</small></div>${badge(g)}</li>`).join('') || '<li>ยังไม่มีแขกในโต๊ะนี้</li>'}${'<li class="vacant"><i class="seatdot free"></i><div>ที่นั่งว่าง</div></li>'.repeat(Math.min(free, 60))}</ul>`;
  });
}
const legend = `<p class="legend"><span class="k in">เช็คอินแล้ว</span><span class="k wait">ยังไม่เช็คอิน</span><span class="k free">ที่นั่งว่าง</span><span>ตัวเลข = เช็คอิน/แขกในโต๊ะ</span></p>`;
const orphanText = () => {
  const names = new Set(tables().map(([, i]) => i.name));
  const missing = [...tableStats().keys()].filter(n => !names.has(n)).sort(byTable);
  return missing.length ? `โต๊ะที่มีในรายชื่อแต่ยังไม่มีในผัง: ${missing.join(', ')}` : '';
};
function mapView(el) {
  el.innerHTML = `${legend}<div id="map"></div><div id="orphans" class="orphans"></div>`;
  const floor = createFloor($('#map', el), { editable: false, getData: () => ({ room: db.room, items: db.items, stats: tableStats() }), onTable: showTable });
  return {
    update() {
      floor.render();
      const names = new Set(tables().map(([, i]) => i.name));
      const missing = [...tableStats().keys()].filter(n => !names.has(n)).sort(byTable);
      $('#orphans', el).innerHTML = (Object.keys(db.items).length ? '' : '<p class="note">ยังไม่ได้จัดผังห้อง</p>') +
        (missing.length ? `<p>โต๊ะที่ยังไม่อยู่ในผัง: ${missing.map(n => `<button data-open="${esc(n)}">${esc(n)}</button>`).join(' ')}</p>` : '');
    }
  };
}
document.addEventListener('click', e => { if (e.target.dataset?.open !== undefined) showTable(e.target.dataset.open); });

/* ---------- แก้ไขผัง ---------- */
function freeSpot(items, i) {
  const clash = (x, y) => Object.values(items).some(o => Math.abs(o.x - x) < (o.w + i.w) / 2 && Math.abs(o.y - y) < (o.h + i.h) / 2);
  for (let y = i.h / 2 + 20; y <= db.room.h - i.h / 2; y += 20)
    for (let x = i.w / 2 + 20; x <= db.room.w - i.w / 2; x += 20) if (!clash(x, y)) return { x: Math.round(x), y: Math.round(y) };
  return { x: db.room.w / 2, y: db.room.h / 2 };
}
function nextTableName(items) {
  const used = new Set(Object.values(items).filter(i => i.type === 'table').map(i => i.name));
  let n = 1; while (used.has(String(n))) n++;
  return String(n);
}
function layoutView(el) {
  el.innerHTML = `<div class="toolbar">${Object.entries(TYPES).map(([k, t]) => `<button data-add="${k}">+ ${t.label}</button>`).join('')}<button id="auto">สร้างโต๊ะจากรายชื่อ</button></div>
    <div class="editor"><div>${legend}<div id="map"></div><p class="muted">ลากเพื่อย้าย • ลากจุดกลมมุมขวาล่างเพื่อปรับขนาด • ปุ่มลูกศรเลื่อนทีละ 5 • บันทึกอัตโนมัติ</p><p id="orphans" class="orphans"></p></div><aside id="props"></aside></div>`;
  let shown;
  const floor = createFloor($('#map', el), {
    editable: true,
    getData: () => ({ room: db.room, items: db.items, stats: tableStats() }),
    onSelect: id => drawProps(id),
    onCommit: (id, change) => save(Object.fromEntries(Object.entries(change).map(([k, v]) => [`layout/items/${id}/${k}`, v])))
  });
  const props = $('#props', el);
  function drawProps(id = floor.selected) {
    shown = id;
    const i = db.items[id];
    const input = (k, label, v, type = 'number') => `<label>${label}<input data-prop="${k}" type="${type}" value="${esc(v)}" ${type === 'number' ? 'step="5"' : 'maxlength="80"'}></label>`;
    props.innerHTML = i ? `<h2>${TYPES[i.type].label}</h2>${input('name', i.type === 'table' ? 'ชื่อ / เบอร์โต๊ะ' : 'ข้อความ', i.name, 'text')}
      <div class="grid2">${input('x', 'ตำแหน่ง X', i.x)}${input('y', 'ตำแหน่ง Y', i.y)}${input('w', 'กว้าง', i.w)}${input('h', 'สูง', i.h)}${input('rot', 'หมุน (องศา)', i.rot)}${i.type === 'table' ? input('seats', 'จำนวนที่นั่ง', i.seats) : ''}</div>
      ${i.type === 'table' ? `<label>รูปทรง<select data-prop="shape"><option value="round">กลม</option><option value="rect" ${i.shape === 'rect' ? 'selected' : ''}>เหลี่ยม</option></select></label>` : ''}
      <div class="row"><button data-do="rotate">หมุน 90°</button><button data-do="copy">คัดลอก</button><button data-do="delete" class="danger">ลบ</button></div>`
      : `<h2>ขนาดห้อง</h2><div class="grid2">${input('room.w', 'กว้าง', db.room.w)}${input('room.h', 'ยาว', db.room.h)}</div><p class="muted">แตะวัตถุในผังเพื่อแก้ไขรายละเอียด</p>`;
  }
  props.onchange = e => {
    const k = e.target.dataset.prop, id = floor.selected;
    if (!k) return;
    if (k.startsWith('room.')) { save({ 'layout/room': normalizeRoom({ ...db.room, [k.slice(5)]: e.target.value }) }); e.target.blur(); return drawProps(); }
    const i = db.items[id];
    if (!i) return;
    const next = normalizeItem({ ...i, [k]: e.target.value === '' && k !== 'name' ? i[k] : e.target.value });
    const patch = { [`layout/items/${id}/${k}`]: next[k] };
    if (k === 'name' && i.type === 'table' && next.name !== i.name) {
      if (!next.name || tables().some(([other, t]) => other !== id && t.name === next.name)) { toast('เบอร์โต๊ะว่างหรือซ้ำกับโต๊ะอื่น', true); e.target.value = i.name; return; }
      const members = Object.entries(db.guests).filter(([, g]) => g.table === i.name);
      if (members.length && !tableStats().has(next.name) && confirm(`ย้ายแขก ${members.length} คนจากโต๊ะ ${i.name} ไปใช้ชื่อโต๊ะ ${next.name} ด้วยหรือไม่?`))
        for (const [gid] of members) patch[`guests/${gid}/table`] = next.name;
    }
    save(patch);
    e.target.value = next[k];
  };
  function duplicate(source) {
    const copy = { ...source };
    if (copy.type === 'table') copy.name = nextTableName(db.items);
    return { ...copy, ...freeSpot(db.items, copy) };
  }
  const remove = id => {
    const i = db.items[id];
    if (i && confirm(`ลบ${TYPES[i.type].label} ${i.name}?`)) { save({ [`layout/items/${id}`]: null }); floor.select(null); drawProps(null); }
  };
  props.onclick = e => {
    const action = e.target.dataset.do, id = floor.selected, i = db.items[id];
    if (!action || !i) return;
    if (action === 'rotate') { save({ [`layout/items/${id}/rot`]: (i.rot + 90) % 360 }); drawProps(); }
    if (action === 'copy') { const nid = uid('i'); save({ [`layout/items/${nid}`]: duplicate(i) }); floor.select(nid); drawProps(nid); }
    if (action === 'delete') remove(id);
  };
  el.onclick = e => {
    const type = e.target.dataset.add;
    if (type) {
      const base = normalizeItem({ type, name: type === 'table' ? nextTableName(db.items) : TYPES[type].label });
      const id = uid('i');
      save({ [`layout/items/${id}`]: { ...base, ...freeSpot(db.items, base) } });
      floor.select(id); drawProps(id);
    }
    if (e.target.id === 'auto') {
      const have = new Set(tables().map(([, i]) => i.name));
      const names = [...tableStats().keys()].filter(n => !have.has(n)).sort(byTable);
      if (!names.length) return toast('ทุกโต๊ะในรายชื่อมีอยู่ในผังแล้ว');
      const items = { ...db.items }, patch = {};
      let room = { ...db.room };
      const cols = Math.max(1, Math.floor((room.w - 40) / 130));
      let top = Math.max(0, ...Object.values(items).map(i => i.y + i.h / 2)) + 20;
      names.forEach((name, n) => {
        const id = uid('i');
        patch[`layout/items/${id}`] = normalizeItem({ type: 'table', name, x: 80 + (n % cols) * 130, y: top + 55 + Math.floor(n / cols) * 130 });
      });
      const needed = top + Math.ceil(names.length / cols) * 130 + 20;
      if (needed > room.h) patch['layout/room'] = normalizeRoom({ ...room, h: needed });
      save(patch, `สร้าง ${names.length} โต๊ะแล้ว`);
    }
  };
  const keys = e => {
    const id = floor.selected, i = db.items[id];
    if (!i || dialog.open || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const d = { ArrowLeft: ['x', -5], ArrowRight: ['x', 5], ArrowUp: ['y', -5], ArrowDown: ['y', 5] }[e.key];
    if (d) { e.preventDefault(); save({ [`layout/items/${id}/${d[0]}`]: i[d[0]] + d[1] }); drawProps(); }
    if (e.key === 'Delete') remove(id);
  };
  document.addEventListener('keydown', keys);
  drawProps(null);
  return {
    update() {
      floor.render();
      if (!props.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON' || shown !== floor.selected) drawProps();
      $('#orphans', el).textContent = orphanText();
    },
    destroy() { document.removeEventListener('keydown', keys); }
  };
}

/* ---------- นำเข้า / ส่งออก ---------- */
function download(content, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const exportJson = (prefix = 'wedding') => download(toJson(db.guests, db.room, db.items), `${prefix}-${stamp()}.json`);

function dataView(el) {
  el.innerHTML = `<div class="panels">
    <section><h2>นำเข้าข้อมูล</h2><p>รองรับ .xlsx, .csv และ .json</p><p class="muted">หัวคอลัมน์: ลำดับ, ชื่อสกุลไทย, ชื่อสกุลEng, ตำแหน่ง, ความสัมพันธ์, สถานะเช็คอิน, โต๊ะ</p>
      <label class="filebtn">เลือกไฟล์<input id="file" type="file" accept=".xlsx,.csv,.json"></label><button id="tpl">ดาวน์โหลดไฟล์ตัวอย่าง</button></section>
    <section><h2>ส่งออกข้อมูล</h2><p>รวมรายชื่อ สถานะเช็คอิน และผังโต๊ะ</p><button class="primary" id="xlsx">ส่งออก Excel</button><button class="primary" id="json">ส่งออก JSON</button></section>
    <section><h2>ล้างข้อมูล</h2><p class="muted">ระบบจะดาวน์โหลดไฟล์สำรอง .json ให้ก่อนลบ</p><button class="danger" data-clear="checks">รีเซ็ตสถานะเช็คอิน</button><button class="danger" data-clear="guests">ลบรายชื่อทั้งหมด</button><button class="danger" data-clear="layout">ลบผังทั้งหมด</button></section></div>`;
  $('#tpl', el).onclick = () => download(templateExcel(), 'guest-template.xlsx');
  $('#xlsx', el).onclick = () => download(toExcel(db.guests, db.room, db.items), `wedding-${stamp()}.xlsx`);
  $('#json', el).onclick = () => exportJson();
  $('#file', el).onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try { confirmImport(await parseFile(file), file.name); }
    catch (err) { toast(err.message, true); }
  };
  el.onclick = e => {
    const what = e.target.dataset.clear;
    if (!what || !confirm(`ยืนยัน: ${e.target.textContent}? ทุกเครื่องจะเห็นการเปลี่ยนแปลงนี้`)) return;
    exportJson('backup');
    if (what === 'checks') {
      const patch = {};
      for (const id of Object.keys(db.guests)) { patch[`guests/${id}/checked`] = false; patch[`guests/${id}/checkedAt`] = null; }
      save(patch, 'รีเซ็ตแล้ว');
    } else save({ [what]: null }, 'ลบแล้ว');
  };
  return { update() {} };
}

function confirmImport(result, fileName) {
  const guests = result.guests?.length ? result.guests : null;
  const layout = result.layout && Object.keys(result.layout.items).length ? result.layout : null;
  if (!guests && !layout) return toast('ไม่พบข้อมูล ตรวจสอบว่ามีหัวคอลัมน์ “ชื่อสกุลไทย” หรือ “ชื่อสกุลEng”', true);
  openDialog(() => `<form id="iform"><h2>ตรวจสอบก่อนนำเข้า</h2><p class="muted">${esc(fileName)}</p>
    ${guests ? `<fieldset><legend><label class="inline"><input type="checkbox" name="guests" checked> รายชื่อแขก ${guests.length} คน</label></legend>
      ${result.missing?.length ? `<p class="warn">ไม่พบคอลัมน์: ${esc(result.missing.join(', '))}</p>` : ''}
      <label class="inline"><input type="radio" name="mode" value="merge" checked> รวมกับข้อมูลเดิม (ชื่อตรงกันจะอัปเดต ช่องสถานะ/โต๊ะที่ว่างคงค่าเดิม)</label>
      <label class="inline"><input type="radio" name="mode" value="replace"> แทนที่รายชื่อทั้งหมด</label>
      <div class="preview"><table>${guests.slice(0, 5).map(g => `<tr><td>${esc(g.no)}</td><td>${esc(g.th || g.en)}</td><td>โต๊ะ ${esc(g.table || '-')}</td></tr>`).join('')}</table></div></fieldset>` : ''}
    ${layout ? `<fieldset><legend><label class="inline"><input type="checkbox" name="layout" checked> ผังห้อง ${Object.keys(layout.items).length} ชิ้น (แทนที่ผังเดิม)</label></legend></fieldset>` : ''}
    <label class="inline"><input type="checkbox" name="backup" checked> ดาวน์โหลดข้อมูลเดิมเก็บไว้ก่อน (.json)</label>
    <div class="row"><button class="primary">นำเข้า</button><button type="button" data-close>ยกเลิก</button></div></form>`);
  dialogRender = null;
  $('#iform').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target), patch = {}, done = [];
    if (f.get('backup') && (Object.keys(db.guests).length || Object.keys(db.items).length)) exportJson('backup');
    if (guests && f.get('guests')) {
      const mode = f.get('mode'), r = buildGuests(guests, db.guests, mode);
      if (mode === 'replace') patch.guests = r.guests;
      else for (const [id, g] of Object.entries(r.guests)) {
        const old = db.guests[id];
        if (!old) patch[`guests/${id}`] = g;
        else for (const k of Object.keys(g)) if (g[k] !== old[k]) patch[`guests/${id}/${k}`] = g[k];
      }
      done.push(`เพิ่ม ${r.added} อัปเดต ${r.updated} คน`);
    }
    if (layout && f.get('layout')) { patch.layout = layout; done.push('ผังห้อง'); }
    closeDialog();
    if (Object.keys(patch).length) save(patch, 'นำเข้าแล้ว: ' + done.join(', '));
    else toast('ไม่มีข้อมูลที่เปลี่ยนแปลง');
  };
}

/* ---------- โครงหน้า / สิทธิ์ ---------- */
const VIEWS = { checkin: checkinView, list: el => listView(el, false), guests: el => listView(el, true), map: mapView, layout: layoutView, data: dataView };

function route() {
  const [p, t] = location.hash.slice(1).split('/');
  const fallback = user?.role && PAGES[user.role] ? user.role : 'door';
  page = Object.hasOwn(PAGES, p) ? p : fallback;
  tab = Object.hasOwn(PAGES[page].tabs, t) ? t : lastTab[page] || Object.keys(PAGES[page].tabs)[0];
  lastTab[page] = tab;
  if (dialog.open) closeDialog();
  build();
}

function build() {
  view?.destroy?.(); view = null;
  const main = $('#main'), allowed = ACCESS[user?.role] || [];
  $('#roles').innerHTML = allowed.map(p => `<a href="#${p}" class="${p === page ? 'on' : ''}">${PAGES[p].label}</a>`).join('');
  $('#user').innerHTML = user && !isLocal ? `<small>${esc(user.email)}</small> <button id="logout">ออกจากระบบ</button>` : '';
  const logout = $('#logout'); if (logout) logout.onclick = () => store.logout();
  const ok = allowed.includes(page);
  $('#tabs').innerHTML = ok ? Object.entries(PAGES[page].tabs).map(([k, v]) => `<a href="#${page}/${k}" class="${k === tab ? 'on' : ''}">${v}</a>`).join('') : '';
  $('#summary').hidden = !ok;
  main.innerHTML = '';
  if (!authReady) main.innerHTML = '<p class="note">กำลังเชื่อมต่อ…</p>';
  else if (!user) loginForm(main);
  else if (!user.role) main.innerHTML = `<p class="note">บัญชีนี้ยังไม่ได้กำหนดสิทธิ์<br>ให้ผู้ดูแลเพิ่มใน Realtime Database ที่ <code>roles/${esc(user.uid)}</code> เป็น admin, door หรือ viewer</p>`;
  else if (!ok) main.innerHTML = `<p class="note">บัญชีนี้ไม่มีสิทธิ์เปิดหน้า ${PAGES[page].label}<br><a href="#${esc(user.role)}">ไปหน้าของคุณ</a></p>`;
  else {
    const el = document.createElement('div'); main.append(el);
    view = VIEWS[tab](el);
    refresh();
  }
}

function refresh() {
  const all = Object.values(db.guests), checked = all.filter(g => g.checked).length;
  $('#summary').innerHTML = `<span>แขกทั้งหมด <b>${all.length}</b></span><span class="ok">เช็คอินแล้ว <b>${checked}</b></span><span>ยังไม่มา <b>${all.length - checked}</b></span><i style="width:${all.length ? checked / all.length * 100 : 0}%"></i>`;
  // ไม่วาดทับขณะผู้ใช้กำลังเลือกโต๊ะ
  if (document.activeElement?.dataset?.table !== undefined) {
    document.activeElement.addEventListener('blur', () => setTimeout(() => view?.update()), { once: true });
  } else view?.update();
  if (dialog.open && dialogRender) dialog.innerHTML = dialogRender();
}

function loginForm(main) {
  main.innerHTML = `<form class="login"><h2>เข้าสู่ระบบ</h2><label>อีเมล<input name="email" type="email" required autocomplete="username"></label><label>รหัสผ่าน<input name="password" type="password" required autocomplete="current-password"></label><button class="primary big">เข้าสู่ระบบ</button></form>`;
  $('form', main).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await store.login(f.get('email'), f.get('password')); }
    catch { toast('เข้าสู่ระบบไม่สำเร็จ ตรวจสอบอีเมล รหัสผ่าน และอินเทอร์เน็ต', true); }
  };
}

$('#title').textContent = EVENT_NAME;
if (isLocal) { $('#banner').hidden = false; $('#banner').textContent = 'โหมดทดลอง: ข้อมูลเก็บในเครื่องนี้เท่านั้น ใส่ค่า Firebase ใน config.js เพื่อแชร์ข้ามเครื่อง'; }
addEventListener('hashchange', route);
route();
store.init({
  onData,
  onAuth(next) {
    const same = authReady && user?.uid === next?.uid && user?.role === next?.role;
    if (user && user.uid !== next?.uid) { query = ''; filters.text = filters.status = ''; $('#toast').textContent = ''; $('#toast').className = ''; dialog.innerHTML = ''; }
    user = next; authReady = true;
    if (!same) route();
  },
  onStatus(s) { const el = $('#status'); el.className = 'status ' + s; el.textContent = { online: '● ออนไลน์', offline: '● ออฟไลน์ (อย่าปิดหน้าจนกว่าจะออนไลน์)', local: '● โหมดทดลอง' }[s]; },
  onError(e) { toast('อ่านข้อมูลไม่ได้: ' + e.message, true); }
}).catch(e => { $('#main').innerHTML = `<p class="note">เชื่อมต่อ Firebase ไม่สำเร็จ: ${esc(e.message)}<br>ตรวจสอบ config.js และอินเทอร์เน็ต แล้วรีเฟรชหน้า</p>`; });
