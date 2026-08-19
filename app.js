/* Amy Gray Wall Art — Mock-Up Creator
   Everything runs in the browser; photos never leave this computer. */
'use strict';

/* ---------------- helpers ---------------- */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const money = v => '$' + Math.round(v).toLocaleString('en-US');
const FLOAT_ADD = (CATALOG.floating && CATALOG.floating.frame_add_in) || 0.75;
const STORE_URL = 'https://amygrayphotography.sproutstudio.com/pricing/price-guide';
const storeLink = product => STORE_URL + '#:~:text=' + encodeURIComponent(CATALOG[product].name);

function fmtIn(v) {
  const w = Math.round(v * 100) / 100;
  const ft = Math.floor(w / 12), inch = Math.round((w - ft * 12) * 10) / 10;
  if (ft && inch) return `${w}" (${ft}' ${inch}")`;
  if (ft) return `${ft} ft (${w}")`;
  return `${w}"`;
}

function parseSize(s) { const [a, b] = s.split('x').map(Number); return [a, b]; }

function sizeEntry(product, size) {
  const e = CATALOG[product].sizes[size];
  return typeof e === 'number' ? { price: e, print: null } : e;
}
function sizesFor(product) {
  return Object.keys(CATALOG[product].sizes)
    .sort((a, b) => { const [aw, ah] = parseSize(a), [bw, bh] = parseSize(b); return aw * ah - bw * bh; });
}

/* outer bounds of a piece in inches (includes float frame) */
function pieceDims(p) {
  let [w, h] = parseSize(p.size);
  if (p.rotate) [w, h] = [h, w];
  if (p.product === 'floating') { w += 2 * FLOAT_ADD; h += 2 * FLOAT_ADD; }
  return [w, h];
}
/* the printed/art area within the outer bounds: [x, y, w, h] inches */
function artRect(p) {
  const [ow, oh] = pieceDims(p);
  const kind = CATALOG[p.product].kind;
  if (kind === 'float') return [FLOAT_ADD, FLOAT_ADD, ow - 2 * FLOAT_ADD, oh - 2 * FLOAT_ADD];
  if (kind === 'framed' || kind === 'acrylic') {
    const e = sizeEntry(p.product, p.size);
    let [pw, ph] = parseSize(e.print);
    if (p.rotate) [pw, ph] = [ph, pw];
    return [(ow - pw) / 2, (oh - ph) / 2, pw, ph];
  }
  return [0, 0, ow, oh];
}
function pieceLabel(p) {
  const e = sizeEntry(p.product, p.size);
  const disp = p.rotate ? p.size.split('x').reverse().join('×') : p.size.replace('x', '×');
  let t = `${disp}″ ${CATALOG[p.product].name.replace(/s$/, '')}`;
  if (e.print) {
    const pd = p.rotate ? e.print.split('x').reverse().join('×') : e.print.replace('x', '×');
    t += ` (${pd}″ print)`;
  }
  return t;
}

/* ---------------- state ---------------- */
const state = {
  mode: 'wall',            // 'wall' | 'photo'
  wallKey: 'sofa',
  custom: { w: 120, h: 96 },
  pieces: [],              // {id, photoId, product, size, rotate, x, y, focus:[fx,fy]}
  photos: {},              // id -> {name, url, w, h, img}
  bg: null,                // {url, img, iw, ih, ppi}  image px per inch
  coupon: 0,
  client: '',
  zoom: 1,
  show: { dims: true, zone: true, person: false, labels: true },
  sel: null,
};
let nextId = 1;
const undoStack = [], redoStack = [];

function serialize(withPhotos) {
  const out = {
    app: 'agp-wallart-mockup', version: 1,
    mode: state.mode, wallKey: state.wallKey, custom: { ...state.custom },
    coupon: state.coupon, client: state.client, contact: state.contact || null,
    bg: state.bg ? { ppi: state.bg.ppi, origW: state.bg.iw } : null,
    pieces: state.pieces.map(p => ({ ...p, focus: [...p.focus] })),
  };
  if (withPhotos) {
    out.photos = {};
    for (const [id, ph] of Object.entries(state.photos)) out.photos[id] = { name: ph.name, data: downscale(ph.img) };
    if (state.bg) out.bg.data = downscale(state.bg.img, 1800);
  }
  return out;
}
function snapshot() { undoStack.push(JSON.stringify(serialize(false))); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
function restore(json) {
  const s = JSON.parse(json);
  state.mode = s.mode; state.wallKey = s.wallKey; state.custom = s.custom;
  state.coupon = s.coupon; state.client = s.client;
  state.pieces = s.pieces;
  if (state.bg && s.bg) state.bg.ppi = s.bg.ppi;
  if (!s.bg) state.bg = null;
  if (state.mode === 'photo' && !state.bg) state.mode = 'wall';
  state.sel = null;
  syncControls(); renderAll();
}
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(serialize(false))); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(serialize(false))); restore(redoStack.pop()); }

/* ---------------- wall geometry ---------------- */
function wallSpec() {
  if (state.mode === 'photo' && state.bg) {
    return { w: state.bg.iw / state.bg.ppi, h: state.bg.ih / state.bg.ppi, zone: null, furniture: null, name: 'Room photo' };
  }
  if (state.wallKey === 'custom') {
    return { w: state.custom.w, h: state.custom.h, name: 'Custom wall',
             zone: { w: state.custom.w * 0.8, h: state.custom.h * 0.55, center_aff: Math.min(62, state.custom.h * 0.62) },
             furniture: null };
  }
  return WALLS[state.wallKey];
}

const M = { l: 64, r: 92, t: 52, b: 74 };   // margins around the wall, screen px
let ppi = 6;                                 // screen px per inch (computed)

function fitPpi() {
  const vp = $('viewport'), spec = wallSpec();
  const availW = vp.clientWidth - 40 - M.l - M.r;
  const availH = vp.clientHeight - 40 - M.t - M.b;
  return Math.max(1.5, Math.min(availW / spec.w, availH / spec.h));
}

/* ---------------- scene render ---------------- */
function renderAll() {
  const spec = wallSpec();
  ppi = fitPpi() * state.zoom;
  const ww = spec.w * ppi, wh = spec.h * ppi;
  const scene = $('scene');
  scene.style.width = (ww + M.l + M.r) + 'px';
  scene.style.height = (wh + M.t + M.b) + 'px';

  const wb = $('wallbox');
  wb.style.left = M.l + 'px'; wb.style.top = M.t + 'px';
  wb.style.width = ww + 'px'; wb.style.height = wh + 'px';
  if (state.mode === 'photo' && state.bg) {
    wb.classList.add('photo-bg');
    wb.style.backgroundImage = `url(${state.bg.url})`;
  } else {
    wb.classList.remove('photo-bg');
    wb.style.backgroundImage = '';
  }

  // floor
  const floor = $('floor'), isWall = state.mode === 'wall';
  floor.classList.toggle('hidden', !isWall);
  if (isWall) {
    floor.style.left = (M.l - 24) + 'px'; floor.style.top = (M.t + wh) + 'px';
    floor.style.width = (ww + 48) + 'px'; floor.style.height = '42px';
  }

  renderZone(spec, ww, wh);
  renderFurniture(spec);
  renderPerson(spec, wh);
  renderRulers(spec, ww, wh);
  renderPieces();
  renderInspector();
  renderPricing();
  renderStatus();
  if (typeof cal !== 'undefined' && cal) renderCal();
}

function renderZone(spec, ww, wh) {
  const z = $('zone');
  const show = state.show.zone && spec.zone && state.mode === 'wall';
  z.classList.toggle('hidden', !show);
  if (!show) return;
  const zw = spec.zone.w * ppi, zh = spec.zone.h * ppi;
  const cy = (spec.h - spec.zone.center_aff) * ppi;   // zone centre, from wall top
  z.style.left = (ww - zw) / 2 + 'px';
  z.style.top = (cy - zh / 2) + 'px';
  z.style.width = zw + 'px'; z.style.height = zh + 'px';
}

function renderFurniture(spec) {
  const el = $('furniture');
  const f = state.mode === 'wall' ? spec.furniture : null;
  el.innerHTML = '';
  el.classList.toggle('hidden', !f);
  if (!f) return;
  const fw = f.w * ppi, fh = f.h * ppi;
  el.style.left = (spec.w * ppi - fw) / 2 + 'px';
  el.style.top = (spec.h * ppi - fh) + 'px';
  el.style.width = fw + 'px'; el.style.height = fh + 'px';
  let shapes;
  if (f.kind === 'sofa') {
    shapes = `<rect x="0" y="${fh * .35}" width="${fw}" height="${fh * .65}" rx="12" fill="var(--furn)"/>
              <rect x="8" y="0" width="${fw - 16}" height="${fh * .45}" rx="12" fill="var(--furn)"/>`;
  } else {
    shapes = `<rect x="0" y="0" width="${fw}" height="${fh * .18}" fill="#cec4ba"/>
              <rect x="-7" y="${fh * .18}" width="${fw + 14}" height="${fh * .82}" rx="9" fill="var(--furn)"/>`;
  }
  el.innerHTML = `<svg width="${fw}" height="${fh}">${shapes}
    <text x="4" y="${fh - 8}" class="furn-label" font-size="12">${f.kind}, ${f.w}&#8243; wide</text></svg>`;
}

/* the 5'5" person, from Amy's silhouette (embedded so nothing loads externally) */
const PERSON_IMG = 'data:image/png;base64,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';
const PERSON_AR = 174 / 600;   // width / height of the silhouette

function renderPerson(spec, wh) {
  const el = $('person');
  const show = state.show.person && state.mode === 'wall';
  el.innerHTML = '';
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const h = 65 * ppi;                       // 5'5"
  const w = h * PERSON_AR;
  el.style.left = (M.l + spec.w * ppi + 18) + 'px';
  el.style.top = (M.t + wh - h) + 'px';
  el.innerHTML = `<img src="${PERSON_IMG}" alt="" draggable="false"
      style="display:block;height:${h}px;width:${w}px;transform:scaleX(-1)">
    <div class="person-tag">5&#8242;5&#8243;</div>`;
}

function renderRulers(spec, ww, wh) {
  const rt = $('rulerTop'), rl = $('rulerLeft');
  const show = state.show.dims;
  rt.classList.toggle('hidden', !show); rl.classList.toggle('hidden', !show);
  if (!show) return;
  rt.innerHTML = `<div class="bar" style="left:0;top:8px;width:${ww}px;height:2px"></div>
    <div class="bar" style="left:0;top:1px;width:2px;height:16px"></div>
    <div class="bar" style="left:${ww - 2}px;top:1px;width:2px;height:16px"></div>
    <div class="lab" style="left:${ww / 2}px;top:0;transform:translateX(-50%)">${fmtIn(spec.w)}</div>`;
  rt.style.left = M.l + 'px'; rt.style.top = (M.t - 30) + 'px';
  rt.style.width = ww + 'px'; rt.style.height = '20px';
  rl.innerHTML = `<div class="bar" style="left:8px;top:0;width:2px;height:${wh}px"></div>
    <div class="bar" style="left:1px;top:0;width:16px;height:2px"></div>
    <div class="bar" style="left:1px;top:${wh - 2}px;width:16px;height:2px"></div>
    <div class="lab" style="left:9px;top:${wh / 2}px;translate:-50% -50%;">${fmtIn(spec.h)}</div>`;
  rl.style.left = (M.l - 34) + 'px'; rl.style.top = M.t + 'px';
  rl.style.width = '20px'; rl.style.height = wh + 'px';
}

/* ---------------- piece render ---------------- */
function renderPieces() {
  const layer = $('pieces');
  layer.innerHTML = '';
  for (const p of state.pieces) layer.appendChild(pieceEl(p));
  if (!state.pieces.length && !cal) {
    const hint = document.createElement('div');
    hint.className = 'wall-hint';
    hint.innerHTML = 'This wall is waiting for your favorites.<br><span>Drag a photo in, or start from Templates.</span>';
    layer.appendChild(hint);
  }
}

function pieceEl(p) {
  const [ow, oh] = pieceDims(p);
  const [ax, ay, aw, ah] = artRect(p);
  const kind = CATALOG[p.product].kind;
  const el = document.createElement('div');
  el.className = 'piece kind-' + kind + (state.sel === p.id ? ' selected' : '');
  el.dataset.id = p.id;
  el.style.left = p.x * ppi + 'px';
  el.style.top = p.y * ppi + 'px';
  el.style.width = ow * ppi + 'px';
  el.style.height = oh * ppi + 'px';
  el.style.zIndex = 1 + state.pieces.indexOf(p);
  el.style.filter = `drop-shadow(${.14 * ppi}px ${.5 * ppi}px ${.6 * ppi}px rgba(96,84,72,.5))`;

  // product chrome
  if (kind === 'float') {
    el.style.background = '#42403a';
  } else if (kind === 'framed') {
    const fr = Math.max(2, .9 * ppi);
    el.style.background = '#fcfbf9';
    el.style.border = fr + 'px solid #48423e';
  } else if (kind === 'acrylic') {
    el.style.background = '#fbfbfc';
    el.style.outline = '1.5px solid #c8c8cd';
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const dot = document.createElement('div');
      dot.style.cssText = `position:absolute;width:${.5 * ppi}px;height:${.5 * ppi}px;border-radius:50%;
        background:#96969e;left:${cx * 100}%;top:${cy * 100}%;margin:${.45 * ppi}px;
        transform:translate(${cx ? '-100%' : '0'},${cy ? '-100%' : '0'}) translate(${cx ? -0.9 * ppi : 0}px,${cy ? -0.9 * ppi : 0}px)`;
      el.appendChild(dot);
    }
  }

  const art = document.createElement('div');
  art.className = 'art';
  const isFramedKind = kind === 'framed' || kind === 'acrylic';
  if (isFramedKind) {
    const fr = kind === 'framed' ? Math.max(2, .9 * ppi) : 0;
    art.style.left = ax * ppi - fr + 'px';
    art.style.top = ay * ppi - fr + 'px';
  } else {
    art.style.left = ax * ppi + 'px';
    art.style.top = ay * ppi + 'px';
  }
  art.style.width = aw * ppi + 'px';
  art.style.height = ah * ppi + 'px';
  const edge = { framed: '#fff', acrylic: '#fff', metal: '#f6f8fa', float: '#f0ece8' }[kind] || '#968c84';
  art.style.boxShadow = `inset 0 0 0 1px ${edge}`;
  if (kind === 'float') art.style.boxShadow += `, 0 0 0 ${Math.max(1.5, .3 * ppi)}px #211e1b`;

  const ph = state.photos[p.photoId];
  if (ph) {
    const img = document.createElement('img');
    const c = coverCrop(ph.w, ph.h, aw, ah, p.focus[0], p.focus[1]);
    const s = (aw * ppi) / c.nw;
    img.src = ph.url;
    img.style.width = ph.w * s + 'px';
    img.style.height = ph.h * s + 'px';
    img.style.left = -c.left * s + 'px';
    img.style.top = -c.top * s + 'px';
    art.appendChild(img);
  }
  if (kind === 'metal') {
    const gloss = document.createElement('div');
    gloss.style.cssText = 'position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.16),rgba(255,255,255,0) 45%)';
    art.appendChild(gloss);
  }
  if (kind === 'wrap') {
    const wrapEdge = document.createElement('div');
    wrapEdge.style.cssText = 'position:absolute;inset:0;box-shadow:inset 2px -2px 4px rgba(0,0,0,.18), inset -1px 1px 2px rgba(255,255,255,.15)';
    art.appendChild(wrapEdge);
  }
  el.appendChild(art);

  if (state.show.labels) {
    const tag = document.createElement('div');
    tag.className = 'sizetag';
    tag.style.top = oh * ppi + .12 * ppi + 6 + 'px';
    const disp = p.rotate ? p.size.split('x').reverse().join('×') : p.size.replace('x', '×');
    tag.textContent = disp + '″';
    el.appendChild(tag);
  }
  return el;
}

function coverCrop(iw, ih, tw, th, fx, fy) {
  const target = tw / th, cur = iw / ih;
  let nw, nh;
  if (cur > target) { nh = ih; nw = ih * target; } else { nw = iw; nh = iw / target; }
  const left = clamp(fx * iw - nw / 2, 0, iw - nw);
  const top = clamp(fy * ih - nh / 2, 0, ih - nh);
  return { left, top, nw, nh };
}

/* ---------------- photos ---------------- */
function addPhotoFiles(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  for (const f of imgs) {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const id = 'p' + nextId++;
      state.photos[id] = { name: f.name.replace(/\.[^.]+$/, ''), url, w: img.naturalWidth, h: img.naturalHeight, img };
      renderTray();
    };
    img.src = url;
  }
}

function addPhotoData(id, name, dataUrl, cb) {
  const img = new Image();
  img.onload = () => {
    state.photos[id] = { name, url: dataUrl, w: img.naturalWidth, h: img.naturalHeight, img };
    cb && cb();
  };
  img.src = dataUrl;
}

function downscale(img, max = 1400) {
  const s = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || img.width) * s);
  c.height = Math.round((img.naturalHeight || img.height) * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

function renderTray() {
  const t = $('thumbs');
  $('shotIdeas').classList.toggle('hidden', Object.keys(state.photos).length > 0);
  t.innerHTML = '';
  for (const [id, ph] of Object.entries(state.photos)) {
    const d = document.createElement('div');
    d.className = 'thumb'; d.draggable = true; d.dataset.id = id;
    d.innerHTML = `<img src="${ph.url}" alt=""><span class="tname">${ph.name}</span><button class="tdel" title="Remove from tray">×</button>`;
    d.addEventListener('dragstart', e => { e.dataTransfer.setData('text/agp-photo', id); e.dataTransfer.effectAllowed = 'copy'; });
    d.querySelector('.tdel').addEventListener('click', () => {
      snapshot();
      delete state.photos[id];
      state.pieces = state.pieces.filter(p => p.photoId !== id);
      if (state.sel && !state.pieces.find(p => p.id === state.sel)) state.sel = null;
      renderTray(); renderAll();
    });
    d.addEventListener('dblclick', () => addPieceFromPhoto(id));
    t.appendChild(d);
  }
}

/* ---------------- pieces: add / select / edit ---------------- */
function defaultPiece(photoId) {
  const spec = wallSpec();
  const ph = state.photos[photoId];
  const landscape = ph && ph.w > ph.h;
  const product = 'canvas';
  const size = '16x20';
  const p = { id: 'pc' + nextId++, photoId, product, size, rotate: !!landscape, x: 0, y: 0, focus: [0.5, 0.45] };
  const [w, h] = pieceDims(p);
  const cy = spec.zone ? spec.h - spec.zone.center_aff : spec.h / 2;
  p.x = (spec.w - w) / 2;
  p.y = clamp(cy - h / 2, 2, spec.h - h - 2);
  return p;
}
function addPieceFromPhoto(photoId, xIn, yIn) {
  snapshot();
  const p = defaultPiece(photoId);
  if (xIn != null) { const [w, h] = pieceDims(p); p.x = xIn - w / 2; p.y = yIn - h / 2; }
  const spec = wallSpec();
  const [w, h] = pieceDims(p);
  p.x = clamp(p.x, -w * .25, spec.w - w * .75);
  p.y = clamp(p.y, -h * .25, spec.h - h * .75);
  state.pieces.push(p);
  state.sel = p.id;
  renderAll();
}
const selected = () => state.pieces.find(p => p.id === state.sel) || null;

/* ---------------- inspector ---------------- */
function renderInspector() {
  const p = selected();
  $('inspEmpty').classList.toggle('hidden', !!p);
  $('inspBody').classList.toggle('hidden', !p);
  if (!p) return;
  const prod = $('pProduct');
  prod.innerHTML = Object.entries(CATALOG).map(([k, v]) => `<option value="${k}"${k === p.product ? ' selected' : ''}>${v.name}</option>`).join('');
  const sz = $('pSize');
  sz.innerHTML = sizesFor(p.product).map(s => {
    const e = sizeEntry(p.product, s);
    return `<option value="${s}"${s === p.size ? ' selected' : ''}>${s.replace('x', '×')}″${e.print ? ` (${e.print.replace('x', '×')}″ print)` : ''} — ${money(e.price)}</option>`;
  }).join('');
  $('pStore').href = storeLink(p.product);
  $('pFocusX').value = Math.round(p.focus[0] * 100);
  $('pFocusY').value = Math.round(p.focus[1] * 100);
  const [w, h] = pieceDims(p);
  const spec = wallSpec();
  const centreAff = spec.h - (p.y + h / 2);
  $('pInfo').innerHTML = `${w}″ × ${h}″ overall &middot; center ${Math.round(centreAff)}″ off the floor`;
}

function editSelected(fn) {
  const p = selected(); if (!p) return;
  snapshot(); fn(p);
  const spec = wallSpec(); const [w, h] = pieceDims(p);
  p.x = clamp(p.x, -w * .5, spec.w - w * .5);
  p.y = clamp(p.y, -h * .5, spec.h - h * .5);
  renderAll();
}

/* ---------------- pricing ---------------- */
function renderPricing() {
  const list = $('priceList');
  let sub = 0;
  list.innerHTML = '';
  for (const p of state.pieces) {
    const e = sizeEntry(p.product, p.size);
    sub += e.price;
    const ph = state.photos[p.photoId];
    const row = document.createElement('div');
    row.className = 'price-row price-item';
    row.innerHTML = `<span><a class="store-link" href="${storeLink(p.product)}" target="_blank" rel="noopener"
      title="See ${CATALOG[p.product].name} in the store">${pieceLabel(p)}</a><br><span class="sub">${ph ? ph.name : ''}</span></span><span>${money(e.price)}</span>`;
    list.appendChild(row);
  }
  const c = state.coupon / 100;
  const total = sub * (1 - c);
  $('priceTotal').textContent = money(total);
  $('priceNote').textContent = state.pieces.length
    ? (c ? `${money(sub)} before your ${state.coupon}% coupon. Prices are from Amy's collection — what you see is what it costs.` : `Prices are from Amy's collection — what you see is what it costs.`)
    : '';
}

function renderStatus() {
  const spec = wallSpec();
  const n = state.pieces.length;
  let s = `${spec.name || 'Wall'} — ${fmtIn(spec.w)} × ${fmtIn(spec.h)}`;
  if (state.mode === 'photo') s += ` (scaled from your photo)`;
  s += ` · ${n} piece${n === 1 ? '' : 's'}`;
  const p = selected();
  if (p) { const [w, h] = pieceDims(p); s += ` · selected: ${w}″×${h}″ at ${Math.round(p.x * 10) / 10}″, ${Math.round(p.y * 10) / 10}″ from top-left`; }
  $('statusbar').textContent = s;
}

/* ---------------- drag & snap ---------------- */
let drag = null;
$('pieces').addEventListener('pointerdown', e => {
  const el = e.target.closest('.piece'); if (!el) return;
  const p = state.pieces.find(q => q.id === el.dataset.id); if (!p) return;
  state.sel = p.id;
  drag = { p, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
  el.setPointerCapture(e.pointerId);
  renderAll();
  e.preventDefault();
});
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = (e.clientX - drag.sx) / ppi, dy = (e.clientY - drag.sy) / ppi;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) { snapshot(); drag.moved = true; }
  if (!drag.moved) return;
  const spec = wallSpec(); const [w, h] = pieceDims(drag.p);
  let nx = drag.ox + dx, ny = drag.oy + dy;
  if (!e.altKey) [nx, ny] = snapPos(drag.p, nx, ny, w, h, spec); else $('guides').innerHTML = '';
  drag.p.x = clamp(nx, -w * .5, spec.w - w * .5);
  drag.p.y = clamp(ny, -h * .5, spec.h - h * .5);
  const el = document.querySelector(`.piece[data-id="${drag.p.id}"]`);
  if (el) { el.style.left = drag.p.x * ppi + 'px'; el.style.top = drag.p.y * ppi + 'px'; }
  renderStatus();
});
window.addEventListener('pointerup', () => {
  if (!drag) return;
  $('guides').innerHTML = '';
  drag = null;
  renderAll();
});

function snapPos(p, nx, ny, w, h, spec) {
  const TH = 0.55, gap = parseFloat($('gapIn').value) || 0;
  const guides = [];
  const candX = [], candY = [];
  // wall / zone centres
  candX.push({ at: spec.w / 2 - w / 2, line: spec.w / 2 });
  if (spec.zone) {
    const zc = spec.h - spec.zone.center_aff;
    candY.push({ at: zc - h / 2, line: zc });
  }
  for (const q of state.pieces) {
    if (q === p) continue;
    const [qw, qh] = pieceDims(q);
    candX.push({ at: q.x, line: q.x });                                  // left-left
    candX.push({ at: q.x + qw - w, line: q.x + qw });                    // right-right
    candX.push({ at: q.x + qw / 2 - w / 2, line: q.x + qw / 2 });        // centre
    candX.push({ at: q.x + qw + gap, line: q.x + qw + gap });            // beside, with gap
    candX.push({ at: q.x - gap - w, line: q.x - gap });
    candY.push({ at: q.y, line: q.y });
    candY.push({ at: q.y + qh - h, line: q.y + qh });
    candY.push({ at: q.y + qh / 2 - h / 2, line: q.y + qh / 2 });
    candY.push({ at: q.y + qh + gap, line: q.y + qh + gap });
    candY.push({ at: q.y - gap - h, line: q.y - gap });
  }
  let bx = null, by = null;
  for (const c of candX) if (Math.abs(nx - c.at) < TH && (!bx || Math.abs(nx - c.at) < Math.abs(nx - bx.at))) bx = c;
  for (const c of candY) if (Math.abs(ny - c.at) < TH && (!by || Math.abs(ny - c.at) < Math.abs(ny - by.at))) by = c;
  if (bx) { nx = bx.at; guides.push(`<div class="guide v" style="left:${bx.line * ppi}px;top:0;bottom:0"></div>`); }
  if (by) { ny = by.at; guides.push(`<div class="guide h" style="top:${by.line * ppi}px;left:0;right:0"></div>`); }
  $('guides').innerHTML = guides.join('');
  return [nx, ny];
}

/* drop photos onto the wall */
const wallboxEl = $('wallbox');
wallboxEl.addEventListener('dragover', e => {
  if ([...e.dataTransfer.types].some(t => t === 'text/agp-photo' || t === 'Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
wallboxEl.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation();
  document.body.classList.remove('dragging');
  const r = wallboxEl.getBoundingClientRect();
  const xIn = (e.clientX - r.left) / ppi, yIn = (e.clientY - r.top) / ppi;
  const id = e.dataTransfer.getData('text/agp-photo');
  if (id) {
    const hit = e.target.closest('.piece');
    if (hit) {                       // swap photo on an existing piece
      const p = state.pieces.find(q => q.id === hit.dataset.id);
      if (p) { snapshot(); p.photoId = id; state.sel = p.id; renderAll(); return; }
    }
    addPieceFromPhoto(id, xIn, yIn);
  } else if (e.dataTransfer.files.length) {
    addPhotoFiles(e.dataTransfer.files);
  }
});

/* drag files anywhere */
let dragDepth = 0;
window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length && !e.target.closest('#wallbox')) addPhotoFiles(e.dataTransfer.files);
});

/* click empty wall to deselect */
wallboxEl.addEventListener('pointerdown', e => {
  if (!e.target.closest('.piece')) { state.sel = null; renderAll(); }
});

/* ---------------- arrange ---------------- */
function arrange(kind) {
  if (!state.pieces.length) return;
  snapshot();
  const spec = wallSpec();
  const gap = parseFloat($('gapIn').value) || 0;
  const cy = spec.zone ? spec.h - spec.zone.center_aff : spec.h / 2;
  const cx = spec.w / 2;
  const ps = [...state.pieces].sort((a, b) => (a.x + a.y * 4) - (b.x + b.y * 4));
  if (kind === 'row') {
    const totalW = ps.reduce((s, p) => s + pieceDims(p)[0], 0) + gap * (ps.length - 1);
    let x = cx - totalW / 2;
    for (const p of ps) {
      const [w, h] = pieceDims(p);
      p.x = x; p.y = cy - h / 2; x += w + gap;
    }
  } else if (kind === 'col') {
    const totalH = ps.reduce((s, p) => s + pieceDims(p)[1], 0) + gap * (ps.length - 1);
    let y = cy - totalH / 2;
    for (const p of ps) {
      const [w, h] = pieceDims(p);
      p.x = cx - w / 2; p.y = y; y += h + gap;
    }
  } else if (kind === 'grid') {
    const n = ps.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = Math.max(...ps.map(p => pieceDims(p)[0]));
    const cellH = Math.max(...ps.map(p => pieceDims(p)[1]));
    const totW = cols * cellW + (cols - 1) * gap;
    const totH = rows * cellH + (rows - 1) * gap;
    ps.forEach((p, i) => {
      const [w, h] = pieceDims(p);
      const c = i % cols, r = Math.floor(i / cols);
      p.x = cx - totW / 2 + c * (cellW + gap) + (cellW - w) / 2;
      p.y = cy - totH / 2 + r * (cellH + gap) + (cellH - h) / 2;
    });
  }
  renderAll();
}

/* ---------------- room photo & calibration ---------------- */
function setBgFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.bg = { url, img, iw: img.naturalWidth, ih: img.naturalHeight, ppi: img.naturalWidth / 120 };
    state.mode = 'photo';
    syncControls(); renderAll();
    startCalibration();
  };
  img.src = url;
}

/* Calibration: two draggable handles with a magnifier loupe.
   Points are stored as fractions of the wall, so canvas zoom stays usable. */
let cal = null;
const LOUPE_R = 75, LOUPE_MAG = 4;

function startCalibration() {
  if (!state.bg) return;
  cal = { pts: [], formEl: null };
  $('calOverlay').classList.remove('hidden');
  renderCal();
  setStatus('Click one end of the credit card / dollar bill, then the other. Then drag the handles to fine-tune — a magnifier appears while you drag. Esc cancels; the zoom buttons still work.');
}
function setStatus(t) { $('statusbar').textContent = t; }

function calFrac(e) {
  const r = wallboxEl.getBoundingClientRect();
  return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
}

function renderCal() {
  const ov = $('calOverlay');
  if (!cal) return;
  const spec = wallSpec();
  const ww = spec.w * ppi, wh = spec.h * ppi;
  const px = p => [M.l + p[0] * ww, M.t + p[1] * wh];
  const form = cal.formEl;
  ov.innerHTML = '';

  if (cal.pts.length === 2) {
    const [a, b] = cal.pts.map(px);
    const line = document.createElement('div');
    line.className = 'cal-line';
    line.style.left = a[0] + 'px'; line.style.top = a[1] + 'px';
    line.style.width = Math.hypot(b[0] - a[0], b[1] - a[1]) + 'px';
    line.style.transform = `rotate(${Math.atan2(b[1] - a[1], b[0] - a[0])}rad)`;
    ov.appendChild(line);
  }
  cal.pts.forEach((p, i) => {
    const [x, y] = px(p);
    const h = document.createElement('div');
    h.className = 'cal-handle';
    h.style.left = x + 'px'; h.style.top = y + 'px';
    h.addEventListener('pointerdown', ev => calDrag(ev, i));
    ov.appendChild(h);
  });
  if (cal.pts.length === 2) {
    if (!form) buildCalForm();
    const [a, b] = cal.pts.map(px);
    cal.formEl.style.left = clamp((a[0] + b[0]) / 2, 170, ov.clientWidth - 170) + 'px';
    cal.formEl.style.top = (Math.max(a[1], b[1]) + 14) + 'px';
    ov.appendChild(cal.formEl);
  }
  if (cal.loupeEl) ov.appendChild(cal.loupeEl);
}

function buildCalForm() {
  const form = document.createElement('div');
  form.id = 'calForm';
  form.innerHTML = `<span class="cal-refs">
      <button class="small ghost on" data-in="3.37" title="A credit card's long edge is 3.37 inches">Credit card</button>
      <button class="small ghost" data-in="6.14" title="A dollar bill's long edge is 6.14 inches">Dollar bill</button>
    </span>
    That line is <input id="calIn" type="number" min="0.5" max="480" step="0.01" value="3.37" style="width:64px"> inches
    <button id="calOk" class="small primary">Set</button>
    <button id="calRedo" class="small ghost" title="Clear both points and start over">Redo</button>
    <button id="calCancel" class="small ghost">Cancel</button>`;
  form.addEventListener('pointerdown', e => e.stopPropagation());
  for (const rb of form.querySelectorAll('.cal-refs button')) {
    rb.addEventListener('click', () => {
      form.querySelector('#calIn').value = rb.dataset.in;
      form.querySelectorAll('.cal-refs button').forEach(b => b.classList.toggle('on', b === rb));
    });
  }
  form.querySelector('#calOk').addEventListener('click', () => {
    const inches = parseFloat(form.querySelector('#calIn').value);
    const [a, b] = cal.pts;
    const imgPx = Math.hypot((b[0] - a[0]) * state.bg.iw, (b[1] - a[1]) * state.bg.ih);
    if (inches > 0 && imgPx > 2) {
      snapshot();
      state.bg.ppi = imgPx / inches;
    }
    endCalibration();
  });
  form.querySelector('#calRedo').addEventListener('click', () => {
    cal.pts = []; cal.formEl = null; renderCal();
    setStatus('Click one end of the reference, then the other.');
  });
  form.querySelector('#calCancel').addEventListener('click', endCalibration);
  cal.formEl = form;
}

function calDrag(ev, i) {
  ev.stopPropagation(); ev.preventDefault();
  const move = e => { cal.pts[i] = calFrac(e); showLoupe(i); renderCal(); };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    cal.loupeEl = null; renderCal();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  showLoupe(i); renderCal();
}

function showLoupe(i) {
  const spec = wallSpec();
  const ww = spec.w * ppi, wh = spec.h * ppi;
  const p = cal.pts[i];
  const x = M.l + p[0] * ww, y = M.t + p[1] * wh;
  let l = cal.loupeEl;
  if (!l) {
    l = document.createElement('div');
    l.className = 'cal-loupe';
    l.style.backgroundImage = `url(${state.bg.url})`;
    cal.loupeEl = l;
  }
  // place the loupe above-right of the handle, flipping if it would leave the scene
  const ox = x + LOUPE_R + 90 > M.l + ww + M.r ? -(LOUPE_R + 24) : LOUPE_R + 24;
  const oy = y - LOUPE_R - 24 < 0 ? LOUPE_R + 24 : -(LOUPE_R + 24);
  l.style.left = (x + ox) + 'px';
  l.style.top = (y + oy) + 'px';
  l.style.backgroundSize = `${ww * LOUPE_MAG}px ${wh * LOUPE_MAG}px`;
  l.style.backgroundPosition = `${-(p[0] * ww * LOUPE_MAG - LOUPE_R)}px ${-(p[1] * wh * LOUPE_MAG - LOUPE_R)}px`;
}

$('calOverlay').addEventListener('pointerdown', e => {
  if (!cal || cal.pts.length >= 2) return;
  if (e.target.closest('.cal-handle') || e.target.closest('#calForm')) return;
  cal.pts.push(calFrac(e));
  renderCal();
  if (cal.pts.length === 1) setStatus('Now click the other end. You can drag either handle afterwards to fine-tune.');
});

function endCalibration() {
  cal = null;
  $('calOverlay').classList.add('hidden');
  $('calOverlay').innerHTML = '';
  renderAll();
}

/* ---------------- export PNG ---------------- */
async function renderMockup() {
  await document.fonts.ready;
  const spec = wallSpec();
  const P = 12;                                   // export px per inch
  const pad = { l: 70, r: 96, t: 120, b: 90 };
  if (state.mode === 'photo') { pad.r = 70; }
  const ww = spec.w * P, wh = spec.h * P;
  const c = document.createElement('canvas');
  c.width = Math.round(ww + pad.l + pad.r);
  c.height = Math.round(wh + pad.t + pad.b + (state.mode === 'wall' ? 46 : 0));
  const x0 = pad.l, y0 = pad.t;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);

  // wall
  if (state.mode === 'photo' && state.bg) {
    ctx.drawImage(state.bg.img, x0, y0, ww, wh);
    ctx.strokeStyle = '#b9b2a9'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, ww, wh);
  } else {
    const g = ctx.createLinearGradient(0, y0, 0, y0 + wh);
    g.addColorStop(0, '#eee8e0'); g.addColorStop(1, '#e4dcd2');
    ctx.fillStyle = g; ctx.fillRect(x0, y0, ww, wh);
    ctx.strokeStyle = '#d4ccc3'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, ww, wh);
    // floor
    ctx.fillStyle = '#cbbdae'; ctx.fillRect(x0 - 26, y0 + wh, ww + 52, 46);
    ctx.strokeStyle = '#b2a394'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0 - 26, y0 + wh); ctx.lineTo(x0 + ww + 26, y0 + wh); ctx.stroke();
    // furniture
    const f = spec.furniture;
    if (f) {
      const fw = f.w * P, fh = f.h * P;
      const fx = x0 + (ww - fw) / 2, fy = y0 + wh - fh;
      ctx.fillStyle = '#ded6cd';
      if (f.kind === 'sofa') {
        rr(ctx, fx, fy + fh * .35, fw, fh * .65, 12); ctx.fill();
        rr(ctx, fx + 8, fy, fw - 16, fh * .45, 12); ctx.fill();
      } else {
        ctx.fillStyle = '#cec4ba'; ctx.fillRect(fx, fy, fw, fh * .18);
        ctx.fillStyle = '#ded6cd'; rr(ctx, fx - 7, fy + fh * .18, fw + 14, fh * .82, 9); ctx.fill();
      }
      ctx.fillStyle = '#908982'; ctx.font = '300 13px Jost, sans-serif';
      ctx.fillText(`${f.kind}, ${f.w}" wide`, fx + 4, y0 + wh - 8);
    }
  }

  // pieces
  for (const p of state.pieces) {
    const [ow, oh] = pieceDims(p);
    const [ax, ay, aw, ah] = artRect(p);
    const kind = CATALOG[p.product].kind;
    const px = x0 + p.x * P, py = y0 + p.y * P;
    const pw = ow * P, phh = oh * P;
    // shadow
    ctx.save();
    ctx.shadowColor = 'rgba(96,84,72,.5)'; ctx.shadowBlur = 9; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 6;
    ctx.fillStyle = kind === 'float' ? '#42403a' : kind === 'framed' ? '#48423e' : kind === 'acrylic' ? '#fbfbfc' : '#fff';
    ctx.fillRect(px, py, pw, phh);
    ctx.restore();
    if (kind === 'framed') {
      const fr = .9 * P;
      ctx.fillStyle = '#fcfbf9'; ctx.fillRect(px + fr, py + fr, pw - 2 * fr, phh - 2 * fr);
    }
    if (kind === 'float') {
      ctx.fillStyle = '#211e1b';
      ctx.fillRect(px + (ax - .3) * P, py + (ay - .3) * P, (aw + .6) * P, (ah + .6) * P);
    }
    // art
    const ph = state.photos[p.photoId];
    const dax = px + ax * P, day = py + ay * P, daw = aw * P, dah = ah * P;
    if (ph) {
      const cc = coverCrop(ph.w, ph.h, aw, ah, p.focus[0], p.focus[1]);
      ctx.drawImage(ph.img, cc.left, cc.top, cc.nw, cc.nh, dax, day, daw, dah);
    } else {
      ctx.fillStyle = '#ddd'; ctx.fillRect(dax, day, daw, dah);
    }
    if (kind === 'metal') {
      const gg = ctx.createLinearGradient(dax, day, dax + daw * .6, day + dah);
      gg.addColorStop(0, 'rgba(255,255,255,.16)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg; ctx.fillRect(dax, day, daw, dah);
    }
    if (kind === 'wrap') {
      const sg = ctx.createLinearGradient(dax, day, dax + 4, day);
      sg.addColorStop(0, 'rgba(0,0,0,.16)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.fillRect(dax, day, 4, dah);
    }
    const edge = { framed: '#fff', acrylic: '#fff', metal: '#f6f8fa', float: '#f0ece8' }[kind] || '#968c84';
    ctx.strokeStyle = edge; ctx.lineWidth = kind === 'metal' ? 2 : 1;
    ctx.strokeRect(dax + .5, day + .5, daw - 1, dah - 1);
    if (state.show.labels) {
      ctx.fillStyle = '#908982'; ctx.font = '300 12px Jost, sans-serif'; ctx.textAlign = 'center';
      const disp = p.rotate ? p.size.split('x').reverse().join('×') : p.size.replace('x', '×');
      ctx.fillText(disp + '"', px + pw / 2, py + phh + 16);
      ctx.textAlign = 'left';
    }
  }

  // dims
  if (state.show.dims) {
    ctx.strokeStyle = '#908982'; ctx.fillStyle = '#908982'; ctx.lineWidth = 2;
    ctx.font = '300 15px Jost, sans-serif';
    const yD = y0 - 24;
    line(ctx, x0, yD, x0 + ww, yD); line(ctx, x0, yD - 7, x0, yD + 7); line(ctx, x0 + ww, yD - 7, x0 + ww, yD + 7);
    const t = fmtIn(spec.w), tw = ctx.measureText(t).width;
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 + ww / 2 - tw / 2 - 8, yD - 11, tw + 16, 22);
    ctx.fillStyle = '#908982'; ctx.fillText(t, x0 + ww / 2 - tw / 2, yD + 5);
    const xD = x0 - 26;
    line(ctx, xD, y0, xD, y0 + wh); line(ctx, xD - 7, y0, xD + 7, y0); line(ctx, xD - 7, y0 + wh, xD + 7, y0 + wh);
    ctx.save();
    ctx.translate(xD - 8, y0 + wh / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
    const t2 = fmtIn(spec.h), tw2 = ctx.measureText(t2).width;
    ctx.fillStyle = '#fff'; ctx.fillRect(-tw2 / 2 - 8, -11, tw2 + 16, 22);
    ctx.fillStyle = '#908982'; ctx.fillText(t2, 0, 5);
    ctx.restore();
  }

  // header + footer
  const title = (state.client ? state.client + ' — ' : '') + (spec.name || 'Wall');
  ctx.fillStyle = '#4a4844'; ctx.font = '32px Lora, Georgia, serif';
  ctx.fillText(title, x0, 52);
  let sub = state.pieces.length + ' piece' + (state.pieces.length === 1 ? '' : 's');
  const subTotal = state.pieces.reduce((s, p) => s + sizeEntry(p.product, p.size).price, 0);
  if (subTotal) sub += ' · ' + money(subTotal * (1 - state.coupon / 100)) + (state.coupon ? ` after ${state.coupon}% coupon` : '');
  ctx.fillStyle = '#908982'; ctx.font = '300 17px Jost, sans-serif';
  ctx.fillText(sub, x0, 80);
  ctx.fillStyle = '#b5afa8'; ctx.font = '300 13px Jost, sans-serif';
  ctx.fillText('Amy Gray Photography · to scale · amygrayphotography.com', x0, c.height - 18);

  return c;
}
async function exportPNG() {
  const c = await renderMockup();
  const a = document.createElement('a');
  a.download = ((state.client || 'wall-art').replace(/\s+/g, '-') + '-mockup.png').toLowerCase();
  a.href = c.toDataURL('image/png');
  a.click();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

/* ---------------- save / open ---------------- */
function saveDesign() {
  const data = serialize(true);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = ((state.client || 'design').replace(/\s+/g, '-') + '.wallart.json').toLowerCase();
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function openDesign(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result);
      if (s.app !== 'agp-wallart-mockup') throw new Error('not a wall art file');
      state.pieces = []; state.photos = {}; state.bg = null; state.sel = null;
      state.mode = s.mode; state.wallKey = s.wallKey; state.custom = s.custom || state.custom;
      state.coupon = s.coupon || 0; state.client = s.client || '';
      state.contact = s.contact || null;
      const jobs = Object.entries(s.photos || {});
      let left = jobs.length + (s.bg && s.bg.data ? 1 : 0);
      const done = () => { if (--left <= 0) { syncControls(); renderTray(); renderAll(); } };
      if (!left) { state.pieces = s.pieces; syncControls(); renderTray(); renderAll(); return; }
      for (const [id, ph] of jobs) addPhotoData(id, ph.name, ph.data, done);
      if (s.bg && s.bg.data) {
        const img = new Image();
        img.onload = () => { state.bg = { url: img.src, img, iw: img.naturalWidth, ih: img.naturalHeight, ppi: 0 };
          state.bg.ppi = s.bg.ppi * (img.naturalWidth / (s.bg.origW || img.naturalWidth)); done(); };
        img.src = s.bg.data;
      } else if (s.mode === 'photo') { state.mode = 'wall'; }
      state.pieces = s.pieces;
      // photo ids referenced but missing get dropped
      state.pieces = state.pieces.filter(p => !p.photoId || s.photos && s.photos[p.photoId]);
    } catch (err) { alert("Couldn't open that file: " + err.message); }
  };
  rd.readAsText(file);
}

/* ---------------- send to Amy ---------------- */
const AMY_EMAIL = 'amy@amygray.net';
/* The DigitalOcean backend: designs POST here and land in Amy's inbox in one
   click. Set to '' to fall back to the mail-app flow. */
const SUBMIT_URL = 'https://dolphin-app-f4t5q.ondigitalocean.app/api/submit';

function designSummaryText() {
  const spec = wallSpec();
  const lines = [
    `Design from: ${state.client || '(no name given)'}`,
    `Wall: ${spec.name || 'wall'} — ${Math.round(spec.w)}" wide x ${Math.round(spec.h)}" tall`,
    '',
  ];
  let sub = 0;
  state.pieces.forEach((p, i) => {
    const e = sizeEntry(p.product, p.size);
    sub += e.price;
    const ph = state.photos[p.photoId];
    lines.push(`${i + 1}. ${pieceLabel(p)} — ${money(e.price)}${ph ? ` — photo: ${ph.name}` : ''}`);
  });
  lines.push('', `Total: ${money(sub * (1 - state.coupon / 100))}${state.coupon ? ` (after ${state.coupon}% coupon)` : ''}`);
  return lines.join('\n');
}

function openMailto(url) { location.href = url; }

function sendToAmy() {
  if (!state.pieces.length) { alert('Put at least one piece on the wall first — try the Templates button!'); return; }
  $('sName').value = state.contact?.name || state.client || '';
  $('sEmail').value = state.contact?.email || '';
  $('sPhone').value = state.contact?.phone || '';
  $('sendErr').classList.add('hidden');
  $('sendGo').disabled = false;
  $('sendGo').textContent = 'Send design';
  $('sendModal').classList.remove('hidden');
  $('sName').focus();
}

async function doSend() {
  const contact = {
    name: $('sName').value.trim(),
    email: $('sEmail').value.trim(),
    phone: $('sPhone').value.trim(),
    note: $('sNote').value.trim(),
  };
  if (!contact.name || !/.+@.+\..+/.test(contact.email)) {
    $('sendErr').textContent = 'Please add your name and a valid email so Amy can reach you.';
    $('sendErr').classList.remove('hidden');
    return;
  }
  state.contact = contact;
  state.client = state.client || contact.name;
  $('clientName').value = state.client;

  const fname = ((state.client || 'design').replace(/\s+/g, '-') + '.wallart.json').toLowerCase();
  const design = serialize(true);
  const subject = `Wall art design — ${state.client}`;
  const contactLine = `\n\nFrom: ${contact.name} <${contact.email}>${contact.phone ? ' · ' + contact.phone : ''}`
    + (contact.note ? `\nNote: ${contact.note}` : '');
  const body = designSummaryText() + contactLine;

  // one-click delivery via the backend, when configured
  if (SUBMIT_URL) {
    $('sendGo').disabled = true;
    $('sendGo').textContent = 'Sending…';
    try {
      const png = (await renderMockup()).toDataURL('image/png').split(',')[1];
      const r = await fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design, summary: designSummaryText(), contact, png }),
      });
      if (!r.ok) throw new Error('server said ' + r.status);
      $('sendModal').classList.add('hidden');
      setStatus('Sent! Your design is in Amy’s inbox — she’ll be in touch soon. 🎉');
      return;
    } catch (err) {
      $('sendGo').disabled = false;
      $('sendGo').textContent = 'Send design';
      $('sendErr').textContent = "Couldn't reach the server — sending through your mail app instead.";
      $('sendErr').classList.remove('hidden');
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  $('sendModal').classList.add('hidden');
  const json = JSON.stringify(design);
  const file = new File([json], fname, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: subject, text: body + `\n\nPlease send to ${AMY_EMAIL}` });
      setStatus(`Thank you! If you picked Mail, address it to ${AMY_EMAIL} and hit send.`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;   // user closed the share sheet
    }
  }
  // fallback: download the design, then open a pre-addressed email
  const a = document.createElement('a');
  a.download = fname;
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  openMailto(`mailto:${AMY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    body + `\n\nIMPORTANT: the file "${fname}" just downloaded to this device — attach it to this email before sending, so Amy gets the design and photos.`)}`);
  setStatus(`Design saved as ${fname} — attach it to the email that just opened, then send.`);
}

/* ---------------- sample design ---------------- */
function placeholderPhoto(seed, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const hues = [[236, 225, 216], [216, 201, 190], [201, 186, 176], [227, 213, 202]];
  const [r, g, b] = hues[seed % hues.length];
  const grad = x.createLinearGradient(0, 0, w * .3, h);
  grad.addColorStop(0, `rgb(${r + 12},${g + 12},${b + 10})`);
  grad.addColorStop(1, `rgb(${r - 30},${g - 32},${b - 30})`);
  x.fillStyle = grad; x.fillRect(0, 0, w, h);
  // sun haze
  const rad = x.createRadialGradient(w * .68, h * .3, 10, w * .68, h * .3, w * .55);
  rad.addColorStop(0, 'rgba(255,246,235,.85)'); rad.addColorStop(1, 'rgba(255,246,235,0)');
  x.fillStyle = rad; x.fillRect(0, 0, w, h);
  // horizon
  x.fillStyle = `rgba(${r - 55},${g - 55},${b - 48},.55)`;
  x.fillRect(0, h * .72, w, h * .28);
  // figures
  x.fillStyle = `rgba(${r - 95},${g - 95},${b - 85},.9)`;
  const n = 1 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const fx = w * (.5 + (i - (n - 1) / 2) * .09), fh = h * (.16 - (i % 2) * .035), fy = h * .72;
    x.beginPath(); x.ellipse(fx, fy - fh + fh * .07, fh * .075, fh * .075, 0, 0, 7); x.fill();
    x.beginPath(); x.roundRect(fx - fh * .1, fy - fh * .86, fh * .2, fh * .86, fh * .08); x.fill();
  }
  return c.toDataURL('image/jpeg', .9);
}
function loadSample() {
  snapshot();
  state.pieces = []; state.sel = null; state.mode = 'wall'; state.wallKey = 'sofa';
  state.client = state.client || 'The Sample Family';
  const names = ['the whole family', 'mom & the littles', 'dad & the littles'];
  let left = 3;
  for (let i = 0; i < 3; i++) {
    addPhotoData('s' + i, names[i], placeholderPhoto(i + 2, 900, 1350), () => {
      if (--left === 0) {
        state.pieces = [0, 1, 2].map(i => ({
          id: 'sp' + i, photoId: 's' + i, product: 'floating', size: '20x30',
          rotate: false, x: 0, y: 0, focus: [0.5, 0.42],
        }));
        // order: left, centre, right — family in the middle
        const order = [1, 0, 2];
        state.pieces = order.map(i => state.pieces[i]);
        syncControls(); renderTray();
        arrange('row');
        undoStack.pop();          // arrange() pushed; keep sample load as one undo step
      }
    });
  }
  $('clientName').value = state.client;
}

/* ---------------- suggested templates ---------------- */
const TEMPLATES = [
  { key: 'gallery9', name: 'The Gallery Wall', wall: 'tall', product: 'framed', layout: 'columns', gap: 3,
    groups: [[{ s: '16x24' }, { s: '12x16', r: true }, { s: '16x24' }],
             [{ s: '16x24', r: true }, { s: '24x36' }, { s: '16x24', r: true }],
             [{ s: '16x24' }, { s: '12x16', r: true }, { s: '16x24' }]],
    sub: 'Nine Framed Fine Art Prints; the outer columns mirror each other.' },
  { key: 'gallery9w', name: 'The Gallery Wall — Wide', wall: 'sofa', product: 'framed', layout: 'rows', gap: 3,
    groups: [[{ s: '12x16', r: true }, { s: '8x10' }, { s: '12x16', r: true }],
             [{ s: '12x16' }, { s: '16x24', r: true }, { s: '12x16' }],
             [{ s: '12x16', r: true }, { s: '8x10' }, { s: '12x16', r: true }]],
    sub: 'Nine frames in a cozy mirrored cloud — sized to float over the sofa.' },
  { key: 'six', name: 'The Six', wall: 'tall', product: 'canvas', layout: 'rows', gap: 4,
    groups: [[{ s: '20x30' }, { s: '20x30' }, { s: '20x30' }],
             [{ s: '20x30' }, { s: '20x30' }, { s: '20x30' }]],
    sub: 'Six equal Canvas Gallery Wraps in one calm grid — nothing competes.' },
  { key: 'triptych', name: 'The Triptych', wall: 'sofa', product: 'floating', layout: 'rows', gap: 8,
    groups: [[{ s: '20x30' }, { s: '20x30' }, { s: '20x30' }]],
    sub: 'Three Floating Gallery Wraps over the sofa — the classic.' },
  { key: 'anchor4', name: 'Anchor & Four', wall: 'sofa', product: 'metal', layout: 'columns', gap: 4,
    groups: [[{ s: '16x16' }, { s: '16x16' }], [{ s: '24x36' }], [{ s: '16x16' }, { s: '16x16' }]],
    sub: 'A vertical Metal Print anchored by four squares — the pairs sit flush.' },
  { key: 'statement', name: 'The Statement', wall: 'sofa', product: 'canvas', layout: 'rows', gap: 0,
    groups: [[{ s: '30x40', r: true }]],
    sub: 'One oversized Canvas Gallery Wrap. Let it breathe.' },
  { key: 'bedrow', name: 'Over the Bed', wall: 'bed', product: 'canvas', layout: 'rows', gap: 4,
    groups: [[{ s: '12x16', r: true }, { s: '24x36', r: true }, { s: '12x16', r: true }]],
    sub: 'A landscape trio above the headboard — big center, small wings.' },
  { key: 'hall4', name: 'The Hallway Line', wall: 'hallway', product: 'framed', layout: 'rows', gap: 6,
    groups: [[{ s: '16x20' }, { s: '16x20' }, { s: '16x20' }, { s: '16x20' }]],
    sub: 'Four Framed Fine Art Prints marching down the hall.' },
  { key: 'pair', name: 'The Acrylic Pair', wall: 'sofa', product: 'acrylic', layout: 'rows', gap: 6,
    groups: [[{ s: '26x26' }, { s: '26x26' }]],
    sub: 'Two square Acrylic Float Frames, side by side. Square crops shine here.' },
];

function layoutTemplate(t) {
  const mk = it => ({ product: t.product, size: it.s, rotate: !!it.r });
  const placed = [];
  if (t.layout === 'columns') {
    const cols = t.groups.map(g => g.map(mk));
    const colW = cols.map(c => Math.max(...c.map(q => pieceDims(q)[0])));
    const colH = cols.map(c => c.reduce((s, q) => s + pieceDims(q)[1], 0) + t.gap * (c.length - 1));
    const totW = colW.reduce((a, b) => a + b, 0) + t.gap * (cols.length - 1);
    const totH = Math.max(...colH);
    let x = 0;
    cols.forEach((c, i) => {
      let y = (totH - colH[i]) / 2;
      for (const q of c) {
        const [w, h] = pieceDims(q);
        placed.push({ ...q, x: x + (colW[i] - w) / 2, y });
        y += h + t.gap;
      }
      x += colW[i] + t.gap;
    });
    return { placed, totW, totH };
  }
  const rows = t.groups.map(g => g.map(mk));
  const rowH = rows.map(r => Math.max(...r.map(q => pieceDims(q)[1])));
  const rowW = rows.map(r => r.reduce((s, q) => s + pieceDims(q)[0], 0) + t.gap * (r.length - 1));
  const totW = Math.max(...rowW), totH = rowH.reduce((a, b) => a + b, 0) + t.gap * (rows.length - 1);
  let y = 0;
  rows.forEach((r, i) => {
    let x = (totW - rowW[i]) / 2;
    for (const q of r) {
      const [w, h] = pieceDims(q);
      placed.push({ ...q, x, y: y + (rowH[i] - h) / 2 });
      x += w + t.gap;
    }
    y += rowH[i] + t.gap;
  });
  return { placed, totW, totH };
}

function templatePrice(t) {
  const { placed } = layoutTemplate(t);
  return placed.reduce((s, q) => s + sizeEntry(q.product, q.size).price, 0);
}

/* ---- auto-fit: shrink a template's sizes until the group fits the wall ---- */
function nextSmallerSize(product, size) {
  const [w, h] = parseSize(size);
  const area = w * h, asp = w / h;
  const square = Math.abs(Math.log(asp)) < 0.05;
  const pick = tol => {
    let best = null, bestArea = -1;
    for (const s of sizesFor(product)) {
      const [sw, sh] = parseSize(s);
      const a = sw * sh;
      if (a >= area) continue;
      if (tol != null && Math.abs(Math.log((sw / sh) / asp)) > tol) continue;
      if (a > bestArea) { bestArea = a; best = s; }
    }
    return best;
  };
  return pick(square ? 0.1 : 0.25) || pick(null);
}

function autofitTemplate(t, availW, availH) {
  let cur = JSON.parse(JSON.stringify(t));
  let fitted = false;
  for (let iter = 0; iter < 12; iter++) {
    const { totW, totH } = layoutTemplate(cur);
    if (totW <= availW && totH <= availH) return { t: cur, fitted };
    const map = {};
    let changed = false;
    for (const g of cur.groups) for (const it of g) {
      if (!(it.s in map)) map[it.s] = nextSmallerSize(cur.product, it.s);
      if (map[it.s]) { it.s = map[it.s]; changed = true; }
    }
    if (!changed) break;      // nothing smaller exists — place as-is
    fitted = true;
  }
  return { t: cur, fitted };
}

function templateSVG(t) {
  const spec = WALLS[t.wall];
  const { placed, totW, totH } = layoutTemplate(t);
  const cx = spec.w / 2;
  const cy = t.aff ? spec.h - t.aff : spec.zone ? spec.h - spec.zone.center_aff : spec.h / 2;
  let rects = '';
  if (spec.furniture) {
    const f = spec.furniture;
    rects += `<rect x="${(spec.w - f.w) / 2}" y="${spec.h - f.h * .65}" width="${f.w}" height="${f.h * .65}" rx="3" fill="#ded6cd"/>`;
  }
  for (const q of placed) {
    const [w, h] = pieceDims(q);
    rects += `<rect x="${cx - totW / 2 + q.x}" y="${cy - totH / 2 + q.y}" width="${w}" height="${h}" fill="#8f867e" stroke="#fff" stroke-width="1"/>`;
  }
  return `<svg viewBox="0 0 ${spec.w} ${spec.h}" preserveAspectRatio="xMidYMid meet" style="background:#eee8e0;aspect-ratio:${spec.w}/${spec.h}">${rects}</svg>`;
}

function ensurePhotos(n, cb) {
  const have = Object.keys(state.photos);
  if (have.length) { cb(have); return; }
  const want = Math.min(n, 6);
  let left = want;
  const ids = [];
  for (let i = 0; i < want; i++) {
    const id = 'ph' + nextId++;
    ids.push(id);
    addPhotoData(id, 'placeholder ' + (i + 1), placeholderPhoto(i + 1, 900, 1350), () => { if (--left === 0) cb(ids); });
  }
}

function applyTemplate(t) {
  snapshot();
  if (state.mode !== 'photo') { state.wallKey = t.wall; state.mode = 'wall'; }
  const spec = wallSpec();
  const avail = spec.zone ? { w: spec.zone.w, h: spec.zone.h }
    : { w: spec.w * 0.85, h: spec.h * 0.75 };
  const fit = autofitTemplate(t, avail.w, avail.h);
  const { placed, totW, totH } = layoutTemplate(fit.t);
  const cx = spec.w / 2;
  const cy = t.aff && state.mode !== 'photo' ? spec.h - t.aff
    : spec.zone ? spec.h - spec.zone.center_aff : spec.h / 2;
  ensurePhotos(placed.length, ids => {
    state.pieces = placed.map((q, i) => ({
      id: 'tp' + nextId++, photoId: ids[i % ids.length],
      product: q.product, size: q.size, rotate: q.rotate,
      x: cx - totW / 2 + q.x, y: cy - totH / 2 + q.y, focus: [0.5, 0.45],
    }));
    state.sel = null;
    $('tplModal').classList.add('hidden');
    syncControls(); renderTray(); renderAll();
    setStatus(fit.fitted
      ? `${t.name} — sized down to fit this wall. Drag photos from the tray onto pieces to swap images.`
      : `${t.name} — drag photos from the tray onto pieces to swap images.`);
  });
}

function renderTplGrid() {
  const grid = $('tplGrid');
  grid.innerHTML = '';
  for (const t of TEMPLATES) {
    const n = t.groups.flat().length;
    const card = document.createElement('button');
    card.className = 'tpl-card';
    card.innerHTML = `${templateSVG(t)}
      <div class="tpl-name">${t.name}</div>
      <div class="tpl-sub">${t.sub}</div>
      <div class="tpl-price">${n} piece${n === 1 ? '' : 's'} · ${money(templatePrice(t))}</div>`;
    card.addEventListener('click', () => applyTemplate(t));
    grid.appendChild(card);
  }
}

$('btnTemplates').addEventListener('click', () => { renderTplGrid(); $('tplModal').classList.remove('hidden'); });
$('tplClose').addEventListener('click', () => $('tplModal').classList.add('hidden'));
$('tplModal').addEventListener('pointerdown', e => { if (e.target.id === 'tplModal') $('tplModal').classList.add('hidden'); });

/* ---------------- controls wiring ---------------- */
function syncControls() {
  const sel = $('wallSelect');
  sel.innerHTML = Object.entries(WALLS).map(([k, w]) => `<option value="${k}">${w.name}</option>`).join('')
    + '<option value="custom">Custom…</option>';
  sel.value = state.wallKey;
  $('customWallInputs').classList.toggle('hidden', state.wallKey !== 'custom');
  $('customW').value = state.custom.w; $('customH').value = state.custom.h;
  $('coupon').value = state.coupon;
  $('clientName').value = state.client;
  $('btnCalibrate').classList.toggle('hidden', !state.bg);
  $('btnBgOff').classList.toggle('hidden', !state.bg);
  for (const k of ['dims', 'zone', 'person', 'labels'])
    $('tgl' + k[0].toUpperCase() + k.slice(1)).classList.toggle('on', state.show[k]);
}

$('wallSelect').addEventListener('change', e => {
  snapshot();
  state.wallKey = e.target.value;
  state.mode = 'wall';
  $('customWallInputs').classList.toggle('hidden', state.wallKey !== 'custom');
  renderAll();
});
$('customW').addEventListener('change', e => { snapshot(); state.custom.w = clamp(+e.target.value || 120, 24, 480); renderAll(); });
$('customH').addEventListener('change', e => { snapshot(); state.custom.h = clamp(+e.target.value || 96, 24, 240); renderAll(); });

$('btnAddPhotos').addEventListener('click', () => $('filePhotos').click());
$('filePhotos').addEventListener('change', e => { addPhotoFiles(e.target.files); e.target.value = ''; });

$('btnBg').addEventListener('click', () => $('fileBg').click());
$('fileBg').addEventListener('change', e => { if (e.target.files[0]) { snapshot(); setBgFile(e.target.files[0]); } e.target.value = ''; });
$('btnCalibrate').addEventListener('click', startCalibration);
$('btnBgOff').addEventListener('click', () => { snapshot(); state.bg = null; state.mode = 'wall'; syncControls(); renderAll(); });

$('arrRow').addEventListener('click', () => arrange('row'));
$('arrCol').addEventListener('click', () => arrange('col'));
$('arrGrid').addEventListener('click', () => arrange('grid'));
$('gapIn').addEventListener('change', () => renderAll());

for (const k of ['dims', 'zone', 'person', 'labels']) {
  $('tgl' + k[0].toUpperCase() + k.slice(1)).addEventListener('click', e => {
    state.show[k] = !state.show[k];
    e.target.classList.toggle('on', state.show[k]);
    renderAll();
  });
}

$('zoomIn').addEventListener('click', () => { state.zoom = clamp(state.zoom * 1.25, .3, 6); renderAll(); });
$('zoomOut').addEventListener('click', () => { state.zoom = clamp(state.zoom / 1.25, .3, 6); renderAll(); });
$('zoomFit').addEventListener('click', () => { state.zoom = 1; renderAll(); });

$('pProduct').addEventListener('change', e => editSelected(p => {
  p.product = e.target.value;
  if (!CATALOG[p.product].sizes[p.size]) p.size = sizesFor(p.product)[Math.floor(sizesFor(p.product).length / 2)];
}));
$('pSize').addEventListener('change', e => editSelected(p => { p.size = e.target.value; }));
$('pRotate').addEventListener('click', () => editSelected(p => { p.rotate = !p.rotate; }));
$('pDup').addEventListener('click', () => {
  const p = selected(); if (!p) return;
  snapshot();
  const q = { ...p, focus: [...p.focus], id: 'pc' + nextId++, x: p.x + 3, y: p.y + 3 };
  state.pieces.push(q); state.sel = q.id; renderAll();
});
$('pDelete').addEventListener('click', () => {
  const p = selected(); if (!p) return;
  snapshot();
  state.pieces = state.pieces.filter(q => q !== p); state.sel = null; renderAll();
});
$('pBack').addEventListener('click', () => {
  const p = selected(); if (!p) return;
  snapshot(); state.pieces = [p, ...state.pieces.filter(q => q !== p)]; renderAll();
});
$('pFront').addEventListener('click', () => {
  const p = selected(); if (!p) return;
  snapshot(); state.pieces = [...state.pieces.filter(q => q !== p), p]; renderAll();
});
$('pFocusX').addEventListener('input', e => { const p = selected(); if (p) { p.focus[0] = e.target.value / 100; renderAll(); } });
$('pFocusY').addEventListener('input', e => { const p = selected(); if (p) { p.focus[1] = e.target.value / 100; renderAll(); } });

$('coupon').addEventListener('change', e => { state.coupon = clamp(+e.target.value || 0, 0, 100); renderPricing(); });
$('clientName').addEventListener('input', e => { state.client = e.target.value; });

$('btnExport').addEventListener('click', exportPNG);
$('btnSend').addEventListener('click', sendToAmy);
$('sendGo').addEventListener('click', doSend);
$('sendCancel').addEventListener('click', () => $('sendModal').classList.add('hidden'));
$('sendModal').addEventListener('pointerdown', e => { if (e.target.id === 'sendModal') $('sendModal').classList.add('hidden'); });
$('welcomeGo').addEventListener('click', () => {
  $('welcome').classList.add('hidden');
  try { localStorage.setItem('agpWelcomeSeen', '1'); } catch (e) {}
});
$('btnSave').addEventListener('click', saveDesign);
$('btnSample').addEventListener('click', loadSample);
$('btnLoad').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.addEventListener('change', () => inp.files[0] && openDesign(inp.files[0]));
  inp.click();
});

/* keyboard */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && cal) { endCalibration(); return; }
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); redo(); return; }
  const p = selected();
  if (!p) return;
  if (mod && e.key === 'd') { e.preventDefault(); $('pDup').click(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); $('pDelete').click(); return; }
  const step = e.shiftKey ? 0.25 : 1;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir) {
    e.preventDefault();
    snapshot();
    p.x += dir[0] * step; p.y += dir[1] * step;
    renderAll();
  }
});

window.addEventListener('resize', renderAll);

/* ---------------- boot ---------------- */
syncControls();
renderAll();
try {
  if (!localStorage.getItem('agpWelcomeSeen')) $('welcome').classList.remove('hidden');
} catch (e) {}
