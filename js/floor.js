// แผนผังห้องจัดงาน (SVG) ใช้ร่วมกันทั้งโหมดดูและโหมดแก้ไข
import { esc, TYPES } from './util.js';

const ORDER = { aisle: 0, stage: 1, door: 2, table: 3, label: 4 };
const SNAP = 5;
const snap = v => Math.round(v / SNAP) * SNAP;

/** จุดที่นั่งรอบโต๊ะ: เขียว = เช็คอินแล้ว, แดง = ยังไม่เช็คอิน, เทา = ที่ว่าง */
function seatDots({ w, h, shape, seats }, { total, checked }) {
  const count = Math.min(60, Math.max(seats, total));
  if (!count) return '';
  const GAP = 9, rx = w / 2 + GAP, ry = h / 2 + GAP;
  const length = shape === 'round' ? Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) : 4 * (rx + ry);
  const r = Math.max(2.5, Math.min(7, length / count * 0.42));
  return Array.from({ length: count }, (_, n) => {
    let x, y;
    if (shape === 'round') {
      const a = n / count * 2 * Math.PI - Math.PI / 2;
      x = rx * Math.cos(a); y = ry * Math.sin(a);
    } else {
      // เดินตามขอบสี่เหลี่ยมตามเข็มนาฬิกา เริ่มจากมุมซ้ายบน
      let d = (n + 0.5) / count * length;
      if (d < 2 * rx) { x = d - rx; y = -ry; }
      else if ((d -= 2 * rx) < 2 * ry) { x = rx; y = d - ry; }
      else if ((d -= 2 * ry) < 2 * rx) { x = rx - d; y = ry; }
      else { d -= 2 * rx; x = -rx; y = ry - d; }
    }
    const state = n < checked ? 'in' : n < total ? 'wait' : 'free';
    return `<circle class="dot ${state}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/>`;
  }).join('');
}

/**
 * opts: { editable, getData() -> {room, items, stats}, onSelect(id), onCommit(id, item), onTable(name) }
 */
export function createFloor(host, opts) {
  host.innerHTML = `<div class="zoom"><button data-z="-1" aria-label="ย่อ">−</button><button data-z="0">พอดีจอ</button><button data-z="1" aria-label="ขยาย">+</button></div>
    <div class="floor-scroll"><svg class="floor ${opts.editable ? 'editing' : ''}" xmlns="http://www.w3.org/2000/svg"></svg></div>`;
  const svg = host.querySelector('svg');
  let zoom = 1, selected = null, drag = null;

  host.querySelector('.zoom').onclick = e => {
    const z = e.target.dataset.z;
    if (z === undefined) return;
    zoom = z === '0' ? 1 : Math.min(5, Math.max(1, zoom * (z === '1' ? 1.3 : 1 / 1.3)));
    svg.style.width = zoom * 100 + '%';
  };

  function itemSvg(id, i, stats) {
    const { w, h } = i, sel = opts.editable && id === selected;
    const round = i.type === 'table' && i.shape === 'round';
    const shape = round ? `<ellipse class="body" rx="${w / 2}" ry="${h / 2}"/>`
      : `<rect class="body" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${i.type === 'table' || i.type === 'stage' ? 8 : 2}"/>`;
    let cls = `item ${i.type}`, text = '', aria = '', dots = '';
    const pad = i.type === 'table' ? 18 : 4;
    // หมุนข้อความกลับให้อ่านง่าย
    const upright = i.type === 'table' ? -i.rot : (i.rot > 90 && i.rot < 270 ? 180 : 0);
    if (i.type === 'table') {
      const s = stats.get(i.name) || { total: 0, checked: 0 };
      dots = seatDots(i, s);
      if (i.seats && s.total > i.seats) cls += ' over';
      const fs = Math.max(9, Math.min(w, h) * 0.25);
      text = `<text y="${-fs * 0.35}" font-size="${fs}" class="tname">${esc(i.name)}</text><text y="${fs * 0.85}" font-size="${fs * 0.75}">${s.checked}/${s.total}</text>`;
      aria = `tabindex="0" role="button" aria-label="โต๊ะ ${esc(i.name)} เช็คอิน ${s.checked} จาก ${s.total} คน ว่าง ${Math.max(0, i.seats - s.total)} ที่"`;
    } else {
      const label = i.name || TYPES[i.type].label;
      const tall = i.type === 'aisle' && h > w * 1.5;
      const fs = Math.max(9, Math.min(Math.min(w, h) * 0.55, i.type === 'stage' ? 32 : 18));
      text = `<text font-size="${fs}" ${tall ? 'transform="rotate(-90)"' : ''}>${esc(label)}</text>`;
    }
    const handle = sel ? `<rect class="selbox" x="${-w / 2 - pad}" y="${-h / 2 - pad}" width="${w + 2 * pad}" height="${h + 2 * pad}"/><g class="handle" data-handle="1" transform="translate(${w / 2 + pad} ${h / 2 + pad})"><circle r="18" class="hit"/><circle r="9"/></g>` : '';
    return `<g class="${cls}${sel ? ' selected' : ''}" data-id="${esc(id)}" ${aria} transform="translate(${i.x} ${i.y}) rotate(${i.rot})">${shape}${dots}<g transform="rotate(${upright})">${text}</g>${handle}</g>`;
  }

  function render() {
    if (drag) return; // ไม่วาดทับระหว่างลาก
    const { room, items, stats } = opts.getData();
    if (selected && !items[selected]) { selected = null; opts.onSelect?.(null); }
    svg.setAttribute('viewBox', `0 0 ${room.w} ${room.h}`);
    const list = Object.entries(items).sort(([a, x], [b, y]) => (a === selected) - (b === selected) || ORDER[x.type] - ORDER[y.type]);
    svg.innerHTML = `<defs><pattern id="grid${opts.editable ? 'e' : 'v'}" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" class="gridline"/></pattern></defs>
      <rect class="room" width="${room.w}" height="${room.h}" ${opts.editable ? 'fill="url(#gride)"' : ''}/>${list.map(([id, i]) => itemSvg(id, i, stats)).join('')}`;
  }

  const point = e => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());

  if (opts.editable) {
    svg.addEventListener('pointerdown', e => {
      const g = e.target.closest('.item');
      const id = g?.dataset.id ?? null;
      if (id !== selected) { selected = id; opts.onSelect(id); render(); }
      if (!id) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const item = opts.getData().items[id];
      drag = { id, start: point(e), orig: { ...item }, item: { ...item }, resize: !!e.target.closest('[data-handle]'), moved: false, room: opts.getData().room };
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = point(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y, o = drag.orig, i = drag.item;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (drag.resize) {
        const a = -o.rot * Math.PI / 180;
        i.w = Math.max(20, snap(o.w + 2 * (dx * Math.cos(a) - dy * Math.sin(a))));
        i.h = Math.max(20, snap(o.h + 2 * (dx * Math.sin(a) + dy * Math.cos(a))));
      } else {
        i.x = Math.min(drag.room.w, Math.max(0, snap(o.x + dx)));
        i.y = Math.min(drag.room.h, Math.max(0, snap(o.y + dy)));
      }
      const node = [...svg.querySelectorAll('.item')].find(n => n.dataset.id === drag.id);
      if (node) node.outerHTML = itemSvg(drag.id, i, opts.getData().stats);
    });
    const finish = () => {
      if (!drag) return;
      const d = drag; drag = null;
      const current = opts.getData().items[d.id];
      if (d.moved && current) {
        const { x, y, w, h } = d.item;
        opts.onCommit(d.id, d.resize ? { w, h } : { x, y });
      } else render();
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', finish);
  } else {
    const open = e => {
      const g = e.target.closest('.item.table');
      const item = g && opts.getData().items[g.dataset.id];
      if (item) opts.onTable(item.name);
    };
    svg.addEventListener('click', open);
    svg.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  }

  return { render, select(id) { selected = id; render(); }, get selected() { return selected; } };
}
