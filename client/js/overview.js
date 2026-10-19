// ============================================================
// SOLAR CONQUEST — Vue d'ensemble sans dézoomer
//  - « Mes planètes » : liste cliquable, avec alertes (combat, menace)
//  - Tab / Maj+Tab : planète suivante / précédente parmi les miennes
//  - Mini-carte du système, cliquable
//  - Flèches au bord de l'écran : missiles et modules ennemis qui arrivent
//    sur mes planètes, et mes planètes attaquées hors de l'écran
// ============================================================

// Planètes où j'ai au moins un territoire, les plus peuplées d'abord
function myPlanets() {
  const out = [];
  for (const p of G.planets) {
    let n = 0, pop = 0;
    for (const c of p.cells[0]) if (c.owner === G.me && !c.destroyed) { n++; pop += c.pop; }
    if (n) out.push({ planet: p, cells: n, pop });
  }
  return out.sort((a, b) => b.pop - a.pop);
}

// Menaces en vol vers mes planètes : missiles (point visé près d'une de mes
// planètes) et modules de colonisation (planète visée = une des miennes)
function incomingThreats() {
  const mine = new Set(myPlanets().map(m => m.planet));
  const out = [];
  for (const m of G.missiles) {
    if (!isHostile(G.me, m.owner) || !m.target) continue;
    for (const p of mine) {
      if (Math.hypot(m.target.x - p.x, m.target.y - p.y) < p.radius * 1.6 + 30) { out.push({ kind: 'missile', obj: m, planet: p }); break; }
    }
  }
  for (const m of G.modules) {
    if (isHostile(G.me, m.owner) && m.targetPlanet && mine.has(m.targetPlanet)) out.push({ kind: 'module', obj: m, planet: m.targetPlanet });
  }
  return out;
}

// Une de mes planètes où un de mes territoires est attaqué
function planetUnderAttack(p) {
  return p.cells[0].some(c => c.owner === G.me && c.contest && c.contest.attacker !== G.me);
}

// Aller sur une planète : verrouillage et caméra centrée
function focusPlanet(p) {
  lockPlanet(p);
  UI.camOffset.x = 0; UI.camOffset.y = 0;
}

function cycleMyPlanet(dir) {
  const list = myPlanets().map(m => m.planet);
  if (!list.length) return;
  const i = list.indexOf(UI.lock);
  focusPlanet(list[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + list.length) % list.length]);
}

// --- Liste « Mes planètes » --------------------------------------------------
function updateMyPlanets() {
  const box = el('myplanets');
  const show = G.phase === 'playing';
  box.hidden = !show;
  if (!show) return;
  const sb = el('scoreboard').getBoundingClientRect();
  box.style.top = (sb.bottom + 8) + 'px';
  const list = myPlanets();
  const threats = incomingThreats();
  const rows = list.map(({ planet: p, cells, pop }) => {
    const atk = planetUnderAttack(p);
    const inc = threats.filter(t => t.planet === p);
    const tags = (atk ? '<span class="mp-tag atk" title="Territoires attaqués">COMBAT</span>' : '') +
      (inc.length ? `<span class="mp-tag inc" title="Missiles ou modules ennemis en approche">${inc.length} EN APPROCHE</span>` : '');
    return `<div class="mp-row${UI.lock === p ? ' on' : ''}" data-pid="${p.id}"><span class="mp-name"></span>` +
      `<span class="mp-info">${cells} terr. · ${Math.floor(pop)}</span>${tags}</div>`;
  });
  const key = rows.join('') + list.map(m => m.planet.name).join();
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = '<div class="mp-head">MES PLANÈTES <span>Tab : suivante</span></div>' + (rows.join('') || '<div class="mp-empty">Aucune</div>');
    box.querySelectorAll('.mp-row').forEach((r, i) => {
      r.querySelector('.mp-name').textContent = list[i].planet.name;
      r.addEventListener('click', () => focusPlanet(G.planets[+r.dataset.pid]));
    });
  }
}

// --- Mini-carte ----------------------------------------------------------------
const Minimap = { scale: 1, size: 180 };

function minimapScale() {
  const maxR = G.planets.reduce((m, p) => Math.max(m, p.orbitRadius + p.radius), 200);
  return (Minimap.size / 2 - 6) / maxR;
}

function drawMinimap(t) {
  const cv = el('minimap');
  const show = G.phase === 'playing' || G.phase === 'placement';
  cv.hidden = !show;
  if (!show) return;
  // Toujours au-dessus du panneau de lancement (dont la hauteur varie)
  const mb = el('missilebar');
  cv.style.bottom = (mb.hidden ? 110 : Math.max(110, innerHeight - mb.getBoundingClientRect().top + 10)) + 'px';
  const S = Minimap.size;
  if (cv.width !== S * DPR) { cv.width = cv.height = S * DPR; cv.style.width = cv.style.height = S + 'px'; }
  const g = cv.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, S, S);
  const k = minimapScale(); Minimap.scale = k;
  const X = x => S / 2 + x * k, Y = y => S / 2 + y * k;
  // Orbites et soleil
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
  for (const p of G.planets) { g.beginPath(); g.arc(S / 2, S / 2, p.orbitRadius * k, 0, TAU()); g.stroke(); }
  g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(S / 2, S / 2, 4, 0, TAU()); g.fill();
  // Planètes : disque + anneau de propriété
  const mine = new Set(myPlanets().map(m => m.planet));
  for (const p of G.planets) {
    const r = Math.max(3.5, p.radius * k * 1.6);
    g.fillStyle = `hsl(${p.hue}, ${p.sat}%, ${p.light + 6}%)`;
    g.beginPath(); g.arc(X(p.x), Y(p.y), r, 0, TAU()); g.fill();
    const n = p.sectors, sa = p.sectorAngle;
    g.lineWidth = 2.2;
    for (let s = 0; s < n; s++) {
      const c = p.cells[0][s];
      if (c.destroyed || c.owner === null) continue;
      g.strokeStyle = G.players[c.owner].color;
      g.beginPath(); g.arc(X(p.x), Y(p.y), r + 1.6, p.rotation + s * sa, p.rotation + (s + 1) * sa + 0.01); g.stroke();
    }
    if (mine.has(p) && planetUnderAttack(p)) {
      g.strokeStyle = `rgba(255,60,40,${0.5 + 0.5 * Math.sin(t * 0.01)})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(X(p.x), Y(p.y), r + 5, 0, TAU()); g.stroke();
    }
    if (UI.lock === p) {
      g.strokeStyle = '#cdfb52'; g.lineWidth = 1.2; g.setLineDash([2, 2]);
      g.beginPath(); g.arc(X(p.x), Y(p.y), r + 4.5, 0, TAU()); g.stroke(); g.setLineDash([]);
    }
  }
  // Objets en vol : menaces vers moi en rouge / orange, le reste discret
  const threats = new Set(incomingThreats().map(x => x.obj));
  const dot = (o, color, r) => { g.fillStyle = color; g.beginPath(); g.arc(X(o.x), Y(o.y), r, 0, TAU()); g.fill(); };
  for (const m of G.missiles) dot(m, threats.has(m) ? '#ff3b30' : 'rgba(255,255,255,0.45)', threats.has(m) ? 2.2 : 1.2);
  for (const m of G.modules) dot(m, threats.has(m) ? '#ffb347' : 'rgba(140,220,255,0.6)', threats.has(m) ? 2.4 : 1.4);
  for (const m of G.cargos) dot(m, 'rgba(245,197,66,0.6)', 1.1);
  // Zone visible à l'écran
  const w0 = screenToWorld(0, 0), w1 = screenToWorld(W, H);
  const x0 = Math.max(1, X(w0.x)), y0 = Math.max(1, Y(w0.y)), x1 = Math.min(S - 1, X(w1.x)), y1 = Math.min(S - 1, Y(w1.y));
  const all = x0 <= 1 && y0 <= 1 && x1 >= S - 1 && y1 >= S - 1; // tout le système est déjà à l'écran
  if (!all && x1 > x0 && y1 > y0) {
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }
}

function initMinimap() {
  el('minimap').addEventListener('click', (e) => {
    const r = el('minimap').getBoundingClientRect();
    const k = Minimap.scale, S = Minimap.size;
    const wx = (e.clientX - r.left - S / 2) / k, wy = (e.clientY - r.top - S / 2) / k;
    // Près d'une planète : on s'y rend ; sinon la caméra va à ce point
    let best = null, bd = Infinity;
    for (const p of G.planets) {
      const d = Math.hypot(p.x - wx, p.y - wy) * k;
      if (d < Math.max(10, p.radius * k * 1.6 + 6) && d < bd) { best = p; bd = d; }
    }
    if (best) { focusPlanet(best); return; }
    unlockPlanet();
    UI.cam.x = wx; UI.cam.y = wy;
  });
}

// --- Flèches au bord de l'écran (espace écran) ------------------------------
function drawEdgeAlerts(t) {
  if (G.phase !== 'playing') return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // Cadre des flèches : en retrait des bords, sous le bandeau du haut et
  // au-dessus de la barre de construction
  const L = 40, R = W - 40, T = 96, B = H - 90;
  const cx = W / 2, cy = H / 2;
  const toScreen = (x, y) => ({ x: cx + (x - UI.cam.x) * UI.cam.zoom, y: cy + (y - UI.cam.y) * UI.cam.zoom });
  const onScreen = s => s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H;
  // Point du cadre dans la direction de s (depuis le centre de l'écran)
  const edge = s => {
    const dx = s.x - cx, dy = s.y - cy;
    const kx = dx > 0 ? (R - cx) / dx : dx < 0 ? (L - cx) / dx : Infinity;
    const ky = dy > 0 ? (B - cy) / dy : dy < 0 ? (T - cy) / dy : Infinity;
    const k = Math.min(kx, ky);
    return { x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx) };
  };
  const arrow = (e, color, label) => {
    ctx.save();
    ctx.translate(e.x, e.y); ctx.rotate(e.a);
    ctx.fillStyle = color; ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 0.012);
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, 9); ctx.lineTo(-2, 0); ctx.lineTo(-6, -9); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (label) {
      ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = color;
      ctx.fillText(label, e.x - Math.cos(e.a) * 20, e.y - Math.sin(e.a) * 20 + 3);
    }
  };
  for (const th of incomingThreats()) {
    const s = toScreen(th.obj.x, th.obj.y);
    if (onScreen(s)) continue;
    arrow(edge(s), th.kind === 'missile' ? '#ff3b30' : '#ffb347', th.kind === 'missile' ? 'MISSILE' : 'COLONS');
  }
  for (const { planet: p } of myPlanets()) {
    if (!planetUnderAttack(p)) continue;
    const s = toScreen(p.x, p.y);
    if (onScreen(s)) continue;
    const e = edge(s);
    arrow({ x: e.x + Math.cos(e.a) * 16, y: e.y + Math.sin(e.a) * 16, a: e.a }, '#ff3b30', null);
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 0.01);
    ctx.beginPath(); ctx.arc(e.x, e.y, 9, 0, TAU()); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff6b5e';
    ctx.fillText(p.name.toUpperCase(), e.x, e.y + 22);
  }
  ctx.globalAlpha = 1;
}
