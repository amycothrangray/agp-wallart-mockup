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

function renderPerson(spec, wh) {
  const el = $('person');
  const show = state.show.person && state.mode === 'wall';
  el.innerHTML = '';
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const h = 65 * ppi;                       // 5'5"
  const hr = h * .062, bw = h * .115, lw = h * .043;
  const cx = bw + 10;
  el.style.left = (M.l + spec.w * ppi + 18) + 'px';
  el.style.top = (M.t + wh - h) + 'px';
  el.innerHTML = `<svg width="${cx + bw + 12}" height="${h + 4}">
    <ellipse cx="${cx}" cy="${hr}" rx="${hr}" ry="${hr}" fill="#cec6be"/>
    <rect x="${cx - bw}" y="${hr * 2 + h * .015}" width="${bw * 2}" height="${h - hr * 2 - h * .4}" rx="${h * .05}" fill="#cec6be"/>
    <rect x="${cx - bw + 2}" y="${h - h * .44}" width="${lw * 2}" height="${h * .44}" rx="${lw}" fill="#cec6be"/>
    <rect x="${cx + bw - 2 - lw * 2}" y="${h - h * .44}" width="${lw * 2}" height="${h * .44}" rx="${lw}" fill="#cec6be"/>
    <text x="${cx - bw}" y="${h / 2}" class="person-label" font-size="12">5&#8242;5&#8243;</text></svg>`;
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
  const { placed, totW, totH } = layoutTemplate(t);
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
    setStatus(`${t.name} — drag photos from the tray onto pieces to swap images.`);
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
