// ============================================================
// SOLAR CONQUEST — Rendu canvas
// ============================================================

const UI = {
  cam: { x: 0, y: 0, zoom: 1 },
  hover: null,        // cellule survolée
  hoverPlanet: null,  // planète survolée
  lock: null,         // planète verrouillée (caméra la suit)
  targetZoom: null,   // zoom cible lors du verrouillage
  camOffset: { x: 0, y: 0 }, // décalage caméra/planète verrouillée (drag libre)
  placing: null,      // bâtiment en cours de pose ('city' | 'industry' | 'silo' | 'shield' | 'colony' | 'tradeport' | 'military' | 'aa' | 'spaceport')
  aiming: false,      // mode visée missile
  aimingColony: false,// mode visée module de colonisation
  snap: null,         // viseur aimanté { planet, ang (repère planète), wx, wy, a }
  aimingFleet: null,  // visée flotte : { mode: 'launch' } ou { mode: 'retarget', fleet }
  fleetCount: null,   // vaisseaux à lancer (null = tous)
  missileCount: 1,    // nombre de missiles du tir groupé
  colonyShare: 0.25,  // pourcentage de la pop planétaire embarquée dans le module
  mouse: { x: 0, y: 0 },
};

let canvas, ctx, W = 0, H = 0, DPR = 1;
let stars = [];

function initRender() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext("2d");
  makeBuildingIcons();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  // Champ d'étoiles
  stars = [];
  for (let i = 0; i < 260; i++) {
    stars.push({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.3 + 0.2,
      a: Math.random() * 0.55 + 0.1,
      tw: Math.random() * 3,
    });
  }
}

function fitCamera() {
  const maxOrbit = G.planets.reduce((m, p) => Math.max(m, p.orbitRadius + p.radius), 200);
  UI.cam.x = 0; UI.cam.y = 0;
  UI.cam.zoom = (Math.min(W, H) * 0.5) / (maxOrbit * 1.12);
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - W / 2) / UI.cam.zoom + UI.cam.x,
    y: (sy - H / 2) / UI.cam.zoom + UI.cam.y,
  };
}

// --- Vue stratégique ----------------------------------------------------
// De loin, une planète reste assez grande pour être lisible et cliquable
// (au moins STRAT_MIN_PX de rayon à l'écran) : elle est dessinée agrandie
// autour de son centre, sans chevaucher ses voisines ni le soleil. Les
// positions réelles (orbites, objets en vol) ne changent pas.
const STRAT_MIN_PX = 46;
function planetScale(p) { return p._k || 1; }
function strategic(p) { return (p._k || 1) > 1.05; }

function computePlanetScales() {
  const z = UI.cam.zoom;
  for (const p of G.planets) {
    const want = STRAT_MIN_PX / (p.radius * z);
    if (want <= 1) { p._k = 1; continue; }
    let cap = (Math.hypot(p.x, p.y) - CONFIG.system.sunRadius * 1.4) / p.radius;
    for (const q of G.planets) {
      if (q !== p) cap = Math.min(cap, 0.48 * Math.hypot(p.x - q.x, p.y - q.y) / p.radius);
    }
    p._k = Math.max(1, Math.min(want, cap));
  }
}

// Planète et territoire sous un point du monde. En vue stratégique, le
// territoire se choisit à l'angle (toute la bordure de la planète est
// cliquable), l'intérieur ne désigne aucun territoire.
function pickAt(w) {
  for (let i = G.planets.length - 1; i >= 0; i--) {
    const p = G.planets[i];
    const k = planetScale(p);
    const d = Math.hypot(w.x - p.x, w.y - p.y);
    const strat = k > 1.05;
    if (d > p.radius * k + (strat ? 14 / UI.cam.zoom : 0)) continue;
    let cell = null;
    if (strat) {
      if (d >= p.radius * k * 0.55) {
        const ang = normAngle(Math.atan2(w.y - p.y, w.x - p.x) - p.rotation);
        cell = p.cells[0][Math.min(p.sectors - 1, Math.floor(ang / p.sectorAngle))];
        if (cell.destroyed) cell = null;
      }
    } else {
      cell = cellAt(p, w.x, w.y);
    }
    return { planet: p, cell };
  }
  return null;
}

// Anneau de couleur par joueur autour d'une planète agrandie : la carte se
// lit d'un coup d'œil (qui tient quoi, où sont les combats)
function drawStrategicRing(p, t) {
  const n = p.sectors, sa = p.sectorAngle;
  const r = p.radius + 6 / UI.cam.zoom;
  ctx.lineWidth = 6 / UI.cam.zoom;
  ctx.lineCap = 'butt';
  let s = 0;
  while (s < n) {
    const c = p.cells[0][s];
    const key = c.destroyed ? 'x' : (c.owner === null ? 'n' : c.owner);
    let e = s + 1;
    while (e < n) {
      const c2 = p.cells[0][e];
      const k2 = c2.destroyed ? 'x' : (c2.owner === null ? 'n' : c2.owner);
      if (k2 !== key) break;
      e++;
    }
    if (key !== 'x') {
      ctx.strokeStyle = key === 'n' ? 'rgba(160,165,185,0.22)' : G.players[key].color;
      ctx.globalAlpha = key === 'n' ? 1 : 0.95;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, p.rotation + s * sa, p.rotation + e * sa);
      ctx.stroke();
    }
    s = e;
  }
  // Combats en cours : éclats blancs clignotants
  const blink = 0.45 + 0.45 * Math.sin(t * 0.012);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8 / UI.cam.zoom;
  for (let i = 0; i < n; i++) {
    const c = p.cells[0][i];
    if (!c.contest || c.destroyed) continue;
    ctx.globalAlpha = blink;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, p.rotation + i * sa, p.rotation + (i + 1) * sa);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- Boucle de rendu -------------------------------------------
function render(t) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // Fond espace profond
  const bg = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#0a0e1d');
  bg.addColorStop(1, '#05070f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Étoiles (scintillement, légère parallaxe)
  for (const s of stars) {
    const tw = 0.6 + 0.4 * Math.sin(t * 0.001 * s.tw + s.x);
    const px = (s.x - UI.cam.x * 0.04 * UI.cam.zoom + W) % W;
    const py = (s.y - UI.cam.y * 0.04 * UI.cam.zoom + H) % H;
    ctx.globalAlpha = s.a * tw;
    ctx.fillStyle = '#cfd8ff';
    ctx.beginPath();
    ctx.arc(px, py, s.r, 0, TAU());
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (G.phase === 'menu') return;

  // Transform monde
  ctx.translate(W / 2, H / 2);
  ctx.scale(UI.cam.zoom, UI.cam.zoom);
  ctx.translate(-UI.cam.x, -UI.cam.y);

  drawSun(t);
  drawOrbits();
  computePlanetScales();
  for (const p of G.planets) {
    const k = planetScale(p);
    if (k <= 1) { drawPlanet(p, t); continue; }
    // Vue stratégique : planète agrandie autour de son centre. Le zoom est
    // multiplié le temps du dessin pour que traits et icônes gardent leur
    // taille à l'écran.
    const z = UI.cam.zoom;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(k, k); ctx.translate(-p.x, -p.y);
    UI.cam.zoom = z * k;
    try { drawPlanet(p, t); drawStrategicRing(p, t); } finally { UI.cam.zoom = z; ctx.restore(); }
  }
  drawShadows(); // ombres des vaisseaux sur les planètes survolées
  if (CONFIG.aa.showCone) drawAACones();
  drawMissiles();
  drawModules();
  drawCargos();
  drawShells();
  drawFlak();
  drawFleets(t);
  drawParticles();

  // Noms des planètes (masqués quand on est très loin, sauf planète verrouillée)
  if (UI.cam.zoom > 0.45 || UI.lock) {
    ctx.font = `600 ${11 / UI.cam.zoom}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    for (const p of G.planets) {
      if (UI.cam.zoom <= 0.45 && UI.lock !== p) continue;
      ctx.fillStyle = UI.lock === p ? '#cdfb52' : 'rgba(224,224,224,0.55)';
      ctx.fillText(p.name.toUpperCase(), p.x, p.y + p.radius * planetScale(p) + (strategic(p) ? 24 : 16) / UI.cam.zoom);
    }
  }

  // Viseur aimanté (colonisation, flottes) : rail autour de la planète
  updateAimSnap();
  if (UI.snap) drawAimRail(t, UI.aimingColony ? '#4ade80' : '#ffb347');

  // Alertes au bord de l'écran et mini-carte (cf. js/overview.js)
  drawEdgeAlerts(t);
  drawMinimap(t);

  // Viseur (en coordonnées écran)
  if (UI.aiming) drawVolleyReticles(t);
  else if (UI.aimingColony) drawReticle(t, '#4ade80');
  else if (UI.aimingFleet) drawReticle(t, '#ffb347');
}

// --- Soleil ------------------------------------------------------
function drawSun(t) {
  const R = CONFIG.system.sunRadius;
  const pulse = 1 + Math.sin(t * 0.0012) * 0.03;
  const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 2.4 * pulse);
  g.addColorStop(0, '#fff7d6');
  g.addColorStop(0.28, '#FFE499');
  g.addColorStop(0.5, 'rgba(255,157,0,0.55)');
  g.addColorStop(1, 'rgba(255,157,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R * 2.4 * pulse, 0, TAU());
  ctx.fill();

  ctx.fillStyle = '#FFE499';
  ctx.beginPath();
  ctx.arc(0, 0, R * pulse, 0, TAU());
  ctx.fill();
}

// --- Orbites ------------------------------------------------------
function drawOrbits() {
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1 / UI.cam.zoom;
  for (const p of G.planets) {
    ctx.beginPath();
    ctx.arc(0, 0, p.orbitRadius, 0, TAU());
    ctx.stroke();
  }
}

// --- Planètes & territoires ----------------------------------------
function cellPath(pl, ring, sector) {
  const cell = pl.cells[ring][sector];
  const r1 = cell.rTop ?? pl.radius; // la surface a pu s'affaisser (cratères)
  const r0 = r1 - pl.band;
  const a0 = pl.rotation + sector * pl.sectorAngle;
  const a1 = a0 + pl.sectorAngle;
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, r1, a0, a1);
  ctx.arc(pl.x, pl.y, r0, a1, a0, true);
  ctx.closePath();
}

// Portion basse d'un territoire de couronne : du sol (r0) jusqu'à la
// fraction k de son épaisseur (jauge de population)
function cellPathFill(pl, sector, k) {
  const cell = pl.cells[0][sector];
  const r1 = cell.rTop ?? pl.radius;
  const r0 = r1 - pl.band;
  const rk = r0 + pl.band * k;
  const a0 = pl.rotation + sector * pl.sectorAngle;
  const a1 = a0 + pl.sectorAngle;
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, rk, a0, a1);
  ctx.arc(pl.x, pl.y, r0, a1, a0, true);
  ctx.closePath();
}

function planetBaseColor(pl, ring, sector, alpha) {
  const shade = ((ring + sector) % 2 === 0) ? 0 : -4;
  return `hsla(${pl.hue}, ${pl.sat}%, ${pl.light + shade}%, ${alpha})`;
}

// Chemin de n'importe quel territoire : secteur de couronne, ou secteur
// d'anneau suivant la courbe d'un cratère
function cellPathOf(cell) {
  const pl = cell.planet;
  if (!cell.craterCell) return cellPath(pl, cell.ring, cell.sector);
  const c = craterCenterWorld(pl, cell.crater);
  const r0 = cell.crater.r - pl.band, r1 = cell.crater.r;
  const a0 = pl.rotation + cell.t0, a1 = pl.rotation + cell.t1;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r1, a0, a1);
  ctx.arc(c.x, c.y, r0, a1, a0, true);
  ctx.closePath();
}

// Position + orientation d'un territoire (pour poser les bâtiments debout)
function cellFrame(cell) {
  const pl = cell.planet;
  const midA = pl.rotation + (cell.sector + 0.5) * pl.sectorAngle;
  const baseR = (cell.rTop ?? pl.radius) - pl.band * 0.3;
  return { x: pl.x + Math.cos(midA) * baseR, y: pl.y + Math.sin(midA) * baseR, angle: midA };
}

// Canvas hors-champ réutilisé pour poinçonner les cratères. Le punch
// 'destination-out' est fait SUR LE HORS-CHAMP (sur le canvas principal il
// effacerait aussi le décor spatial) : il gère nativement les cratères qui
// se chevauchent — la zone commune reste vide — contrairement à un clip
// 'evenodd' où chaque recouvrement impair redeviendrait plein.
let _punch = null, _punchCtx = null;

function drawPlanet(pl, t) {
  const locked = UI.lock === pl;
  const hasCraters = pl.craters && pl.craters.length > 0;

  // Boucliers : grands disques bleus translucides DERRIÈRE la planète —
  // dessinés avant la surface, donc seule la partie émergée du disque
  // dépasse de la silhouette (position dérivée de la rotation).
  for (let s = 0; s < pl.sectors; s++) {
    const cell = pl.cells[0][s];
    if (cell.destroyed || cell.building !== 'shield') continue;
    const f = shieldFrame(cell);
    ctx.lineWidth = 1.5 / UI.cam.zoom;
    if (cell.shieldDown > 0) {
      // Bouclier désactivé : contour pointillé discret + arc de recharge
      const k = 1 - cell.shieldDown / CONFIG.shield.downTime;
      ctx.setLineDash([4 / UI.cam.zoom, 5 / UI.cam.zoom]);
      ctx.strokeStyle = 'rgba(130, 195, 255, 0.18)';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU()); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(130, 195, 255, 0.55)';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, -Math.PI / 2, -Math.PI / 2 + TAU() * k); ctx.stroke();
      continue;
    }
    ctx.fillStyle = 'rgba(80, 160, 255, 0.13)';
    ctx.strokeStyle = 'rgba(130, 195, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, TAU());
    ctx.fill();
    ctx.stroke();
  }

  // Surface (corps + contour + territoires + grille) : si la planète a des
  // cratères, elle est rendue sur le hors-champ, poinçonnée puis blittée.
  const realCtx = ctx;
  let offHalf = 0;
  if (hasCraters) {
    let reach = pl.radius + 4 / UI.cam.zoom;
    for (const cr of pl.craters) reach = Math.max(reach, cr.dist + cr.r);
    const k = DPR * UI.cam.zoom; // px écran par unité monde → blit net (1:1)
    const size = Math.ceil(reach * 2 * k) + 2;
    if (!_punch) {
      _punch = document.createElement('canvas');
      _punchCtx = _punch.getContext('2d');
      _punch.width = _punch.height = 2;
    }
    // Toujours un canvas CARRÉ (un canvas naît en 300×150 : sans cette
    // correction, un cadre non carré étirait la planète en ovale au blit).
    if (_punch.width < size || _punch.width > size * 3) {
      _punch.width = _punch.height = size;
    }
    _punchCtx.setTransform(1, 0, 0, 1, 0, 0);
    _punchCtx.clearRect(0, 0, _punch.width, _punch.height);
    _punchCtx.setTransform(k, 0, 0, k,
      _punch.width / 2 - pl.x * k, _punch.height / 2 - pl.y * k);
    ctx = _punchCtx;
    offHalf = _punch.width / (2 * k);
  }

  // Corps de la planète (intérieur non territorial)
  const body = ctx.createRadialGradient(
    pl.x - pl.radius * 0.3, pl.y - pl.radius * 0.3, pl.radius * 0.1,
    pl.x, pl.y, pl.radius);
  body.addColorStop(0, `hsl(${pl.hue}, ${pl.sat + 8}%, ${pl.light + 10}%)`);
  body.addColorStop(0.75, `hsl(${pl.hue}, ${pl.sat}%, ${pl.light}%)`);
  body.addColorStop(1, `hsl(${pl.hue}, ${pl.sat}%, ${pl.light - 8}%)`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, pl.radius, 0, TAU());
  ctx.fill();

  // Contour de la planète
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.2 / UI.cam.zoom;
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, pl.radius, 0, TAU());
  ctx.stroke();

  // Territoires en couronne (les secteurs excavés ont disparu)
  for (let s = 0; s < pl.sectors; s++) {
    const cell = pl.cells[0][s];
    if (cell.destroyed) continue;
    cellPath(pl, 0, s);

    if (cell.owner !== null) {
      // Jauge de population verticale : le territoire se remplit de sa
      // couleur depuis le sol vers le ciel, en proportion pop / plafond.
      // La partie vide reste teintée, plus sombre.
      const col = G.players[cell.owner].color;
      const k = Math.max(0, Math.min(1, cell.pop / cellCap(cell)));
      ctx.fillStyle = col;
      ctx.globalAlpha = CONFIG.ui.popEmptyAlpha;
      ctx.fill();
      if (k > 0) {
        cellPathFill(pl, s, k);
        ctx.globalAlpha = cell.scorched ? 0.72 : 0.92; // cicatrice encore visible
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      continue;
    } else if (cell.scorched) {
      // Territoire vidé par le souffle : teinte calcinée, recolonisable
      // (assez claire pour se détacher du fond sombre du cratère)
      ctx.fillStyle = `hsla(${pl.hue}, ${Math.round(pl.sat * 0.35)}%, ${Math.round(pl.light * 0.75) + 6}%, 0.95)`;
    } else {
      ctx.fillStyle = planetBaseColor(pl, 0, s, 0.95);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Grille de la couronne (chaque territoire est entièrement contourne :
  // les dents de cratère dessinent la nouvelle silhouette)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1 / UI.cam.zoom;
  for (let s = 0; s < pl.sectors; s++) {
    if (pl.cells[0][s].destroyed) continue;
    cellPath(pl, 0, s);
    ctx.stroke();
  }

  // Ombrage par le soleil : face éclairée légèrement rehaussée, face
  // opposée assombrie (peint avant le poinçonnage : les cratères restent nets)
  drawPlanetShade(pl);

  if (hasCraters) {
    // Poinçonnage : les cratères trouent corps, contour, territoires et
    // grille. Cumulatif : le chevauchement de 2 cratères reste un trou.
    ctx.globalCompositeOperation = 'destination-out';
    // Remplissage opaque : le poinçon efface selon l'alpha de la source
    // (sinon il hériterait du dégradé d'ombrage, presque transparent)
    ctx.fillStyle = '#000';
    for (const cr of pl.craters) {
      const a = pl.rotation + cr.ang;
      ctx.beginPath();
      ctx.arc(pl.x + Math.cos(a) * cr.dist, pl.y + Math.sin(a) * cr.dist,
        cr.r, 0, TAU());
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx = realCtx;
    ctx.drawImage(_punch, pl.x - offHalf, pl.y - offHalf, offHalf * 2, offHalf * 2);
  }

  // Effets et habillage AU-DESSUS de la surface (jamais poinçonnés)
  for (let s = 0; s < pl.sectors; s++) {
    const cell = pl.cells[0][s];
    if (cell.destroyed) continue;
    // Contestation : grignotage visible
    if (cell.contest) drawContest(pl, cell, t);
    // Bâtiment
    if (cell.building) drawBuilding(cell);
  }

  // De très loin : pastille de taille minimale pour repérer la planète
  if (pl.radius * UI.cam.zoom < 2.5) {
    ctx.fillStyle = UI.lock === pl ? '#cdfb52' : 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, 2.5 / UI.cam.zoom, 0, TAU());
    ctx.fill();
  }

  // Survol d'une planète non verrouillée : halo discret
  if (!locked && UI.hoverPlanet === pl && G.phase !== 'over') {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.4 / UI.cam.zoom;
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, pl.radius + 5 / UI.cam.zoom, 0, TAU());
    ctx.stroke();
  }

  // Anneau de verrouillage (pointillés rotatifs)
  if (locked) {
    ctx.save();
    ctx.strokeStyle = '#cdfb52';
    ctx.lineWidth = 1.8 / UI.cam.zoom;
    ctx.setLineDash([8 / UI.cam.zoom, 6 / UI.cam.zoom]);
    ctx.lineDashOffset = -t * 0.02;
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, pl.radius + 9 / UI.cam.zoom, 0, TAU());
    ctx.stroke();
    ctx.restore();
  }

  drawHighlights(pl, t);
}

// Territoire en combat : clignotement aux couleurs des deux joueurs,
// arc de progression, et jauges de potentiel au-dessus du bloc
function drawContest(pl, cell, t) {
  const contest = cell.contest;
  const atk = G.players[contest.attacker];
  const defColor = cell.owner !== null ? G.players[cell.owner].color : '#5a5a68';
  const progress = Math.min(1, Math.max(0, 1 - contest.defense / contest.initialDefense));

  // Remplissage de progression aux couleurs de l'attaquant, PARTANT DU
  // CÔTÉ D'OÙ VIENT L'ATTAQUE (le territoire se remplit depuis le voisin
  // attaquant). Pas de cadre ni de flash : le reste du territoire garde sa
  // couleur normale pour préserver la lisibilité.
  const r1 = cell.rTop ?? pl.radius, r0 = r1 - pl.band;
  const a0 = pl.rotation + cell.sector * pl.sectorAngle;
  const a1 = a0 + pl.sectorAngle;

  // De quel côté angulaire se trouve la source de l'attaque ?
  let flip = false;
  if (contest.from && contest.from.planet === pl) {
    const midA = a0 + pl.sectorAngle / 2;
    const fromA = pl.rotation + (contest.from.sector + 0.5) * pl.sectorAngle;
    let d = fromA - midA;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    flip = d > 0; // source du côté des angles croissants → remplir depuis a1
  }
  const f0 = flip ? a1 - pl.sectorAngle * progress : a0;
  const f1 = flip ? a1 : a0 + pl.sectorAngle * progress;
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, r1, f0, f1);
  ctx.arc(pl.x, pl.y, r0, f1, f0, true);
  ctx.closePath();
  ctx.fillStyle = atk.color;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Jauges de combat au-dessus du bloc (si le zoom le permet)
  if (pl.sectorAngle * pl.radius * UI.cam.zoom > 9) {
    const c0 = cellCentroid(cell);
    const midA = Math.atan2(c0.y - pl.y, c0.x - pl.x);
    const lr = (cell.rTop ?? pl.radius) + 14 / UI.cam.zoom;
    const lx = pl.x + Math.cos(midA) * lr, ly = pl.y + Math.sin(midA) * lr;
    ctx.textAlign = 'center';

    // Potentiel d'attaque (couleur attaquant)
    ctx.font = `700 ${11 / UI.cam.zoom}px 'JetBrains Mono', monospace`;
    ctx.lineWidth = 3 / UI.cam.zoom;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = atk.color;
    const f = Math.max(0, Math.round(contest.force));
    ctx.strokeText(f, lx, ly);
    ctx.fillText(f, lx, ly);

    // Défense restante (couleur défenseur)
    ctx.font = `500 ${8.5 / UI.cam.zoom}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = defColor;
    const d = Math.max(0, Math.round(contest.defense));
    ctx.strokeText(d, lx, ly + 11 / UI.cam.zoom);
    ctx.fillText(d, lx, ly + 11 / UI.cam.zoom);
  }
}

// Bâtiments debout sur la surface : base ancrée dans la croûte,
// sommet pointant vers l'espace, solidaires de la rotation de la planète.
// Couleur = celle du propriétaire. En mode fantôme (pose), semi-transparent :
// couleur du joueur si l'emplacement est valide, blanc sinon.
function drawBuilding(cell, ghost) {
  const pl = cell.planet;
  const f = cellFrame(cell);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle + Math.PI / 2); // le "haut" local pointe vers l'extérieur

  // Taille avec plancher d'affichage : l'icône reste lisible au dézoom
  const size = Math.max(pl.band * 0.9, CONFIG.ui.buildingMinPx / UI.cam.zoom);
  ctx.lineWidth = 0.8 / UI.cam.zoom;

  const type = ghost ? ghost.type : cell.building;
  const main = ghost
    ? (ghost.valid ? G.players[G.me].color : '#ffffff')
    : G.players[cell.owner].color;
  if (ghost) ctx.globalAlpha = 0.55;

  drawBuildingShape(type, size, main, cell, ghost, f);
  ctx.restore();
}

// Dessin d'un bâtiment dans son repère local (le « haut » pointe vers
// l'espace). Partagé entre la carte et les icônes de l'interface.
function drawBuildingShape(type, size, main, cell, ghost, f) {
  if (type === 'city') {
    // Ville : dôme + tour, dressés vers l'extérieur
    ctx.fillStyle = main;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.65, Math.PI, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillRect(-size * 0.11, -size * 1.5, size * 0.22, size * 0.85);
    ctx.strokeRect(-size * 0.11, -size * 1.5, size * 0.22, size * 0.85);
  } else if (type === 'industry') {
    // Industrie : usine à chevrons + cheminée, dressée vers l'extérieur
    ctx.fillStyle = '#101018';
    ctx.strokeStyle = main;
    ctx.beginPath();
    ctx.moveTo(-size * 0.8, 0);
    ctx.lineTo(-size * 0.8, -size * 0.55);
    ctx.lineTo(-size * 0.35, -size * 0.9);
    ctx.lineTo(-size * 0.35, -size * 0.55);
    ctx.lineTo(size * 0.1, -size * 0.9);
    ctx.lineTo(size * 0.1, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = main;
    ctx.fillRect(size * 0.3, -size * 1.35, size * 0.2, size * 1.35);
    ctx.strokeRect(size * 0.3, -size * 1.35, size * 0.2, size * 1.35);
  } else if (type === 'silo') {
    // Silo à missiles : tube à tête arrondie + trappe, dressé vers l'extérieur
    ctx.fillStyle = main;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(-size * 0.42, 0);
    ctx.lineTo(-size * 0.42, -size * 1.1);
    ctx.arc(0, -size * 1.1, size * 0.42, Math.PI, 0);
    ctx.lineTo(size * 0.42, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Trappe de lancement
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, -size * 0.62);
    ctx.lineTo(size * 0.3, -size * 0.62);
    ctx.stroke();
    // Pointe du missile visible
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(0, -size * 1.18, size * 0.16, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'shield') {
    // Bouclier : dôme émetteur bleu translucide, dressé vers l'extérieur
    ctx.fillStyle = 'rgba(90, 170, 255, 0.4)';
    ctx.strokeStyle = '#7ec8ff';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.62, Math.PI, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Antenne de l'émetteur
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -size * 1.3);
    ctx.stroke();
    ctx.fillStyle = '#bfe0ff';
    ctx.beginPath();
    ctx.arc(0, -size * 1.35, size * 0.16, 0, TAU());
    ctx.fill();
  } else if (type === 'military') {
    // Base militaire : casemate trapézoïdale + canon incliné
    ctx.fillStyle = main;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(-size * 0.75, 0);
    ctx.lineTo(-size * 0.5, -size * 0.6);
    ctx.lineTo(size * 0.5, -size * 0.6);
    ctx.lineTo(size * 0.75, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Fût du canon
    ctx.save();
    ctx.translate(0, -size * 0.6);
    ctx.rotate(0.55);
    ctx.fillStyle = '#101018';
    ctx.strokeStyle = main;
    ctx.fillRect(-size * 0.11, -size * 0.95, size * 0.22, size * 0.95);
    ctx.strokeRect(-size * 0.11, -size * 0.95, size * 0.22, size * 0.95);
    ctx.restore();
    // Étoile/meurtrière
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-size * 0.3, -size * 0.38, size * 0.6, size * 0.12);
  } else if (type === 'aa') {
    // DAA : socle + double rampe de lancement pointée vers le ciel
    ctx.fillStyle = '#101018';
    ctx.strokeStyle = main;
    ctx.beginPath();
    ctx.rect(-size * 0.6, -size * 0.3, size * 1.2, size * 0.3);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = main;
    for (const sx of [-0.28, 0.28]) {
      ctx.save();
      ctx.translate(size * sx, -size * 0.3);
      ctx.rotate(sx * 0.6);
      ctx.fillRect(-size * 0.1, -size * 1.05, size * 0.2, size * 1.05);
      ctx.restore();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -size * 0.45, size * 0.12, 0, TAU());
    ctx.fill();
  } else if (type === 'spaceport') {
    // Spatioport : plateforme + pylône d'amarrage + vaisseau posé
    ctx.fillStyle = '#101018';
    ctx.strokeStyle = main;
    ctx.beginPath();
    ctx.moveTo(-size * 0.85, 0);
    ctx.lineTo(-size * 0.6, -size * 0.28);
    ctx.lineTo(size * 0.6, -size * 0.28);
    ctx.lineTo(size * 0.85, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, -size * 0.28);
    ctx.lineTo(-size * 0.5, -size * 1.25);
    ctx.stroke();
    ctx.fillStyle = main; // vaisseau en flèche, pointe vers le ciel
    ctx.beginPath();
    ctx.moveTo(size * 0.15, -size * 1.4);
    ctx.lineTo(size * 0.45, -size * 0.4);
    ctx.lineTo(size * 0.15, -size * 0.55);
    ctx.lineTo(-size * 0.15, -size * 0.4);
    ctx.closePath();
    ctx.fill();
    if (cell && !ghost && (cell.ships || 0) > 0 && UI.cam.zoom > 1.2) {
      ctx.rotate(-(f.angle + Math.PI / 2)); // compteur toujours lisible
      ctx.font = `700 ${Math.max(3, 8 / UI.cam.zoom)}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(cell.ships, 0, -size * 1.8);
    }
  } else if (type === 'tradeport') {
    // Port de commerce : mât-grue avec container suspendu
    ctx.fillStyle = '#101018';
    ctx.strokeStyle = main;
    ctx.beginPath();
    ctx.rect(-size * 0.7, -size * 0.25, size * 1.4, size * 0.25); // quai
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); // mât
    ctx.moveTo(-size * 0.4, -size * 0.25);
    ctx.lineTo(-size * 0.4, -size * 1.5);
    ctx.lineTo(size * 0.45, -size * 1.5);
    ctx.stroke();
    ctx.beginPath(); // câble
    ctx.moveTo(size * 0.45, -size * 1.5);
    ctx.lineTo(size * 0.45, -size * 0.95);
    ctx.stroke();
    ctx.fillStyle = '#f5c542'; // container doré
    ctx.fillRect(size * 0.25, -size * 0.95, size * 0.4, size * 0.35);
    ctx.strokeRect(size * 0.25, -size * 0.95, size * 0.4, size * 0.35);
  } else if (type === 'colony') {
    // Centre de colonisation : rampe hexagonale + navette dressée
    ctx.fillStyle = '#101018';
    ctx.strokeStyle = main;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU() + Math.PI / 6;
      const px = Math.cos(a) * size * 0.8, py = Math.sin(a) * size * 0.45;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Navette prête au départ
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.5);
    ctx.lineTo(size * 0.3, -size * 0.7);
    ctx.lineTo(0, -size * 0.9);
    ctx.lineTo(-size * 0.3, -size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// Icônes des bâtiments pour l'interface (mêmes dessins que sur la carte),
// générées une fois en images
const BUILDING_ICONS = {};
function makeBuildingIcons(color = '#d6dcea') {
  const saved = ctx;
  for (const type of ['city', 'industry', 'silo', 'shield', 'colony', 'tradeport', 'military', 'aa', 'spaceport']) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 48;
    const c2 = cv.getContext('2d');
    c2.translate(24, 38);
    c2.lineWidth = 1.6;
    ctx = c2;
    try { drawBuildingShape(type, 20, color, null, null, null); } finally { ctx = saved; }
    BUILDING_ICONS[type] = cv.toDataURL();
  }
}


// Surbrillances : territoire actionnable au survol + sélection
function drawHighlights(pl, t) {
  if (G.phase !== 'playing' || G.phase === 'over') return;

  // Mode pose de bâtiment : fantôme sur l'emplacement proposé (ou, Maj
  // enfoncée, sur le territoire survolé)
  if (UI.placing && UI.lock === pl && !UI.shift) {
    const sug = suggestBuildCell(G.me, pl, UI.placing);
    if (sug) {
      cellPathOf(sug);
      ctx.strokeStyle = '#cdfb52';
      ctx.globalAlpha = 0.6 + 0.35 * Math.sin(t * 0.008);
      ctx.lineWidth = 2.5 / UI.cam.zoom;
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawBuilding(sug, { type: UI.placing, valid: true });
    }
    return;
  }
  if (UI.placing && UI.hover && UI.hover.planet === pl && UI.lock === pl) {
    const h = UI.hover;
    const valid = h.owner === G.me && !h.building && !h.contest && !h.destroyed;
    cellPathOf(h);
    ctx.strokeStyle = valid ? '#cdfb52' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2 / UI.cam.zoom;
    ctx.stroke();
    drawBuilding(h, { type: UI.placing, valid });
    return;
  }

  // Survol sur la planète verrouillée : indique si le territoire est actionnable
  if (UI.hover && UI.hover.planet === pl && UI.lock === pl) {
    const h = UI.hover;
    const hasMyNeighbor = cellNeighbors(h).some(n => n.owner === G.me);
    let color = 'rgba(255,255,255,0.65)';
    if (h.owner === G.me) color = 'rgba(255,255,255,0.8)';
    else if (h.owner === null && hasMyNeighbor && !h.contest) color = '#cdfb52';
    else if (h.owner !== null && h.owner !== G.me && hasMyNeighbor) color = '#ff2a00';
    cellPathOf(h);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 0.006);
    ctx.lineWidth = 2 / UI.cam.zoom;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// --- Missiles en vol --------------------------------------------------
function drawMissiles() {
  for (const m of G.missiles) {
    // Traînée dégressive
    if (m.trail.length > 1) {
      for (let i = 1; i < m.trail.length; i++) {
        const a = (i / m.trail.length) * 0.5;
        ctx.strokeStyle = m.color;
        ctx.globalAlpha = a;
        ctx.lineWidth = (1.6 * i / m.trail.length + 0.3) / UI.cam.zoom * 2;
        ctx.beginPath();
        ctx.moveTo(m.trail[i - 1].x, m.trail[i - 1].y);
        ctx.lineTo(m.trail[i].x, m.trail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Corps du missile orienté selon la vélocité
    const ang = Math.atan2(m.vy, m.vx);
    const s = Math.max(2.2, 3.2 / UI.cam.zoom);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(ang);
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(s * 1.4, 0);
    ctx.lineTo(-s * 0.8, s * 0.55);
    ctx.lineTo(-s * 0.4, 0);
    ctx.lineTo(-s * 0.8, -s * 0.55);
    ctx.closePath();
    ctx.fill();
    // Flamme pulsante
    const fl = 0.7 + 0.5 * Math.random();
    ctx.fillStyle = 'rgba(255, 177, 78, 0.9)';
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, s * 0.3);
    ctx.lineTo(-s * (0.7 + fl), 0);
    ctx.lineTo(-s * 0.7, -s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// --- Modules de colonisation en vol -------------------------------------
function drawModules() {
  for (const m of G.modules) {
    // Traînée dégressive (comme les missiles)
    if (m.trail.length > 1) {
      for (let i = 1; i < m.trail.length; i++) {
        const a = (i / m.trail.length) * 0.5;
        ctx.strokeStyle = m.color;
        ctx.globalAlpha = a;
        ctx.lineWidth = (1.6 * i / m.trail.length + 0.3) / UI.cam.zoom * 2;
        ctx.beginPath();
        ctx.moveTo(m.trail[i - 1].x, m.trail[i - 1].y);
        ctx.lineTo(m.trail[i].x, m.trail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Navette orientée selon la vélocité : coque de la couleur du joueur
    // avec cockpit clair, plus trapue qu'un missile
    const ang = Math.atan2(m.vy, m.vx);
    const s = Math.max(2.6, 3.8 / UI.cam.zoom);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(ang);
    ctx.fillStyle = m.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.7 / UI.cam.zoom;
    ctx.beginPath();
    ctx.moveTo(s * 1.2, 0);
    ctx.lineTo(-s * 0.2, s * 0.75);
    ctx.lineTo(-s * 1.0, s * 0.45);
    ctx.lineTo(-s * 1.0, -s * 0.45);
    ctx.lineTo(-s * 0.2, -s * 0.75);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(s * 0.35, 0, s * 0.28, 0, TAU());
    ctx.fill();
    // Flamme douce
    const fl = 0.6 + 0.4 * Math.random();
    ctx.fillStyle = 'rgba(140, 220, 255, 0.85)';
    ctx.beginPath();
    ctx.moveTo(-s * 0.9, s * 0.25);
    ctx.lineTo(-s * (0.9 + fl), 0);
    ctx.lineTo(-s * 0.9, -s * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// --- Cargos de commerce en vol ------------------------------------------
function drawCargos() {
  for (const m of G.cargos) {
    // Traînée dégressive
    if (m.trail.length > 1) {
      for (let i = 1; i < m.trail.length; i++) {
        const a = (i / m.trail.length) * 0.45;
        ctx.strokeStyle = '#f5c542';
        ctx.globalAlpha = a;
        ctx.lineWidth = (1.4 * i / m.trail.length + 0.3) / UI.cam.zoom * 2;
        ctx.beginPath();
        ctx.moveTo(m.trail[i - 1].x, m.trail[i - 1].y);
        ctx.lineTo(m.trail[i].x, m.trail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Cargo : coque dorée rectangulaire avec bande aux couleurs du joueur
    const ang = Math.atan2(m.vy, m.vx);
    const s = Math.max(2.4, 3.6 / UI.cam.zoom);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(ang);
    ctx.fillStyle = '#f5c542';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.7 / UI.cam.zoom;
    ctx.beginPath();
    ctx.moveTo(s * 1.1, s * 0.55);
    ctx.lineTo(-s * 0.9, s * 0.55);
    ctx.lineTo(-s * 0.9, -s * 0.55);
    ctx.lineTo(s * 1.1, -s * 0.55);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = m.color; // bande propriétaire
    ctx.fillRect(-s * 0.15, -s * 0.55, s * 0.3, s * 1.1);
    // Flamme douce
    const fl = 0.6 + 0.4 * Math.random();
    ctx.fillStyle = 'rgba(255, 200, 90, 0.85)';
    ctx.beginPath();
    ctx.moveTo(-s * 0.85, s * 0.3);
    ctx.lineTo(-s * (0.85 + fl), 0);
    ctx.lineTo(-s * 0.85, -s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// --- Viseur missile (espace écran) ------------------------------------
// --- Viseur aimanté ------------------------------------------------------
// En visée de colonisation ou de flotte, le viseur s'accroche à un rail
// circulaire autour de la planète proche et suit la souris le long de ce
// rail ; il se décroche si la souris s'éloigne trop.
function aimRailRadius(p) { return p.radius * planetScale(p) + Math.max(7, (strategic(p) ? 20 : 16) / UI.cam.zoom); }

function updateAimSnap() {
  const fleetAim = UI.aimingFleet;
  if (!UI.aimingColony && !fleetAim) { UI.snap = null; return; }
  const w = screenToWorld(UI.mouse.x, UI.mouse.y);
  // Une flotte ennemie sous le curseur est prioritaire (cible de flotte)
  if (fleetAim && fleetAt(w.x, w.y, Math.max(10, 14 / UI.cam.zoom), f => isHostile(G.me, f.owner))) { UI.snap = null; return; }
  const A = CONFIG.ui.aim;
  const zone = p => Math.max(p.radius * 0.9, 55 / UI.cam.zoom);
  let best = null, bestGap = Infinity;
  for (const p of G.planets) {
    const d = Math.hypot(w.x - p.x, w.y - p.y);
    const keep = UI.snap && UI.snap.planet === p ? A.hold : 1; // décrochage bien plus loin que l'accroche
    const gap = d - p.radius * planetScale(p);
    if (gap < zone(p) * keep && gap < bestGap) { best = p; bestGap = gap; }
  }
  if (!best) { UI.snap = null; return; }
  const mouseA = Math.atan2(w.y - best.y, w.x - best.x);
  let ang;
  if (UI.snap && UI.snap.planet === best) {
    // Démultiplication : le viseur ne tourne que d'une fraction du mouvement
    // angulaire de la souris, et reste accroché au même point de la planète
    // quand elle tourne (angle mémorisé dans le repère de la planète)
    ang = UI.snap.ang + angleDiff(mouseA, UI.snap.mouseA) * A.gear;
  } else {
    ang = mouseA - best.rotation; // nouvelle accroche : sous la souris
  }
  ang = normAngle(ang);
  const a = best.rotation + ang;
  const r = aimRailRadius(best);
  UI.snap = { planet: best, ang, mouseA, wx: best.x + Math.cos(a) * r, wy: best.y + Math.sin(a) * r, a };
}

// Rail en pointillés autour de la planète + repère vers la surface visée
function drawAimRail(t, color) {
  const sn = UI.snap, p = sn.planet, r = aimRailRadius(p);
  ctx.save();
  ctx.lineWidth = 1.2 / UI.cam.zoom;
  ctx.strokeStyle = hexToRgba(color, 0.45);
  ctx.setLineDash([5 / UI.cam.zoom, 6 / UI.cam.zoom]);
  ctx.lineDashOffset = -t * 0.01 / UI.cam.zoom;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU()); ctx.stroke();
  ctx.setLineDash([]);
  // Secteur visé sur la couronne (zone d'atterrissage / d'arrivée)
  const half = UI.aimingColony ? CONFIG.colony.landArc : 0.18;
  ctx.strokeStyle = hexToRgba(color, 0.9);
  ctx.lineWidth = 3 / UI.cam.zoom;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 1.5 / UI.cam.zoom, sn.a - half, sn.a + half); ctx.stroke();
  // Trait du rail vers la surface
  ctx.lineWidth = 1.2 / UI.cam.zoom;
  ctx.beginPath();
  ctx.moveTo(sn.wx, sn.wy);
  ctx.lineTo(p.x + Math.cos(sn.a) * p.radius, p.y + Math.sin(sn.a) * p.radius);
  ctx.stroke();
  ctx.restore();
}

// Visée de missiles : un petit viseur par missile, là où il va frapper
// (le motif suit la disposition des silos qui tirent)
function drawVolleyReticles(t) {
  if (!UI.lock) { drawReticle(t, '#ff2a00'); return; }
  const w = screenToWorld(UI.mouse.x, UI.mouse.y);
  const shots = missileVolley(G.me, UI.lock, UI.missileCount, w);
  if (shots.length <= 1) { drawReticle(t, '#ff2a00'); return; }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const color = '#ff2a00';
  const pulse = 1 + 0.12 * Math.sin(t * 0.008);
  // Repère discret au centre de la salve
  ctx.strokeStyle = color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(UI.mouse.x + dx * 3, UI.mouse.y + dy * 3); ctx.lineTo(UI.mouse.x + dx * 8, UI.mouse.y + dy * 8); }
  ctx.stroke();
  ctx.globalAlpha = 0.9; ctx.lineWidth = 1.4;
  for (const s of shots) {
    const x = W / 2 + (s.target.x - UI.cam.x) * UI.cam.zoom;
    const y = H / 2 + (s.target.y - UI.cam.y) * UI.cam.zoom;
    const r = 7 * pulse;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU()); ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * (r - 3), y + dy * (r - 3)); ctx.lineTo(x + dx * (r + 4), y + dy * (r + 4)); }
    ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 1.4, 0, TAU()); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawReticle(t, color = '#ff2a00') {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  let x = UI.mouse.x, y = UI.mouse.y;
  if (UI.snap && (UI.aimingColony || UI.aimingFleet)) {
    // Viseur accroché au rail : position écran du point du rail
    x = W / 2 + (UI.snap.wx - UI.cam.x) * UI.cam.zoom;
    y = H / 2 + (UI.snap.wy - UI.cam.y) * UI.cam.zoom;
  }
  const pulse = 1 + 0.12 * Math.sin(t * 0.008);
  const r = 16 * pulse;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU());
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.45, 0, TAU());
  ctx.stroke();
  // Mire en croix
  const g = 6, L = r + 10;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * g, y + dy * g);
    ctx.lineTo(x + dx * L, y + dy * L);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 1.8, 0, TAU());
  ctx.fill();
  ctx.globalAlpha = 1;
}

// --- Particules ------------------------------------------------------
// Cônes de détection des DAA (visibles pour le réglage) : secteur
// translucent aux couleurs du propriétaire, orienté vers le ciel
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawAACones() {
  const half = CONFIG.aa.coneHalfAngle * Math.PI / 180;
  for (const p of G.planets) {
    for (const cell of planetCells(p)) {
      if (cell.destroyed || cell.owner === null || cell.building !== 'aa' || strategic(p)) continue;
      const f = aaFrame(cell);
      const col = G.players[cell.owner].color;
      const ready = (cell.aaT || 0) >= CONFIG.aa.fireInterval;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.arc(f.x, f.y, CONFIG.aa.range, f.angle - half, f.angle + half);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(col, ready ? 0.07 : 0.04);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(col, 0.28);
      ctx.lineWidth = 1 / UI.cam.zoom;
      ctx.setLineDash([3 / UI.cam.zoom, 4 / UI.cam.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// Mini-missiles de DAA : fine traînée blanche + tête aux couleurs du tireur
function drawFlak() {
  for (const fl of G.flak) {
    const col = G.players[fl.owner] ? G.players[fl.owner].color : '#ffffff';
    ctx.lineCap = 'round';
    for (let i = 1; i < fl.trail.length; i++) {
      const a = fl.trail[i - 1], b = fl.trail[i];
      ctx.globalAlpha = (i / fl.trail.length) * 0.7;
      ctx.strokeStyle = '#e8eefc';
      ctx.lineWidth = 1 / UI.cam.zoom;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(fl.x, fl.y, Math.max(0.5, 1.6 / UI.cam.zoom), 0, TAU());
    ctx.fill();
  }
}

// Flottes : un point par vaisseau aux couleurs du joueur. Pour mes
// flottes, un trait pointillé discret montre la cible ; la flotte
// sélectionnée pour un nouvel ordre est entourée.
function drawFleets(t) {
  for (const f of G.fleets) {
    if (f.owner === G.me && f.target) {
      const tx = f.target.kind === 'planet' ? f.target.planet.x : f.target.fleet.cx;
      const ty = f.target.kind === 'planet' ? f.target.planet.y : f.target.fleet.cy;
      if (f.state === 'transit') {
        ctx.strokeStyle = hexToRgba(f.color, 0.22);
        ctx.lineWidth = 1 / UI.cam.zoom;
        ctx.setLineDash([4 / UI.cam.zoom, 5 / UI.cam.zoom]);
        ctx.beginPath(); ctx.moveTo(f.cx, f.cy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const sel = UI.aimingFleet && UI.aimingFleet.fleet === f;
    if (sel) {
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 1.4 / UI.cam.zoom;
      ctx.beginPath();
      ctx.arc(f.cx, f.cy, CONFIG.fleet.formationRadius * 1.6 + 6 / UI.cam.zoom, 0, TAU());
      ctx.stroke();
    }
    const r = Math.max(0.9, 1.9 / UI.cam.zoom);
    ctx.fillStyle = f.color;
    for (const s of f.ships) {
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU()); ctx.fill();
    }
    // Nombre de vaisseaux (lisible à tout zoom)
    if (UI.cam.zoom > 0.6) {
      ctx.font = `700 ${9 / UI.cam.zoom}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = hexToRgba(f.color, 0.85);
      ctx.fillText(f.ships.length, f.cx, f.cy - CONFIG.fleet.formationRadius * 1.4 - 6 / UI.cam.zoom);
    }
  }
  // Traits de tir des vaisseaux
  ctx.lineCap = 'round';
  for (const b of G.bolts) {
    ctx.globalAlpha = Math.max(0, b.life / CONFIG.fleet.boltLife);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = (b.thin ? 0.6 : 1.2) / UI.cam.zoom; // riposte des bâtiments : trait très fin
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- Profondeur : ombrage des planètes et ombres portées ----------------
// Direction de la lumière : du soleil (centre du système) vers l'objet
function sunDir(x, y) {
  const d = Math.hypot(x, y) || 1;
  return { x: x / d, y: y / d }; // vers l'extérieur du système
}

function drawPlanetShade(pl) {
  const L = CONFIG.ui.shade;
  const u = sunDir(pl.x, pl.y);
  const R = pl.radius;
  const g = ctx.createLinearGradient(pl.x - u.x * R, pl.y - u.y * R, pl.x + u.x * R, pl.y + u.y * R);
  g.addColorStop(0, `rgba(255, 236, 200, ${L.light})`);  // côté soleil
  g.addColorStop(0.42, 'rgba(0, 0, 0, 0)');
  g.addColorStop(0.75, `rgba(0, 0, 0, ${L.dark * 0.6})`);
  g.addColorStop(1, `rgba(0, 0, 0, ${L.dark})`);         // face cachée
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, R + 0.5, 0, TAU());
  ctx.fill();
}

// Ombre portée d'un objet volant sur la planète qu'il survole (effet de
// hauteur en vue de dessus) : projetée sur la surface sous l'objet — vers
// l'intérieur du disque s'il longe le bord —, plus petite et plus décalée
// quand l'objet est haut, légèrement repoussée à l'opposé du soleil, et
// plus marquée côté jour. Rien hors de la planète ni dans un cratère.
function castShadow(x, y, size, heading, alt) {
  const S = CONFIG.ui.shadow;
  for (const p of G.planets) {
    if (strategic(p)) continue; // planète agrandie : pas d'ombre (positions non réalistes)
    const d = Math.hypot(x - p.x, y - p.y);
    if (d - p.radius > S.reach) continue;
    const away = sunDir(p.x, p.y);
    let sx, sy;
    if (d > p.radius - p.band) {
      // Objet au-dessus du bord : ombre ramenée sur la surface, sous lui
      const ux = (x - p.x) / d, uy = (y - p.y) / d;
      const rs = p.radius - (S.baseOffset + alt * S.rimInset);
      sx = p.x + ux * rs + away.x * alt * S.sunShift;
      sy = p.y + uy * rs + away.y * alt * S.sunShift;
    } else {
      // Objet au-dessus du disque : ombre décalée à l'opposé du soleil
      const off = S.baseOffset + alt * S.maxOffset;
      sx = x + away.x * off; sy = y + away.y * off;
    }
    const ds = Math.hypot(sx - p.x, sy - p.y);
    if (ds > p.radius - p.band * 0.2) continue;
    let inCrater = false;
    for (const cr of p.craters) {
      const c = craterCenterWorld(p, cr);
      if (Math.hypot(sx - c.x, sy - c.y) < cr.r) { inCrater = true; break; }
    }
    if (inCrater) continue;
    // Côté jour : ombre nette ; côté nuit : à peine visible
    const lit = ds > 0.01 ? Math.max(0, -((sx - p.x) * away.x + (sy - p.y) * away.y) / ds) : 0.5;
    const k = 1 - alt * (1 - S.minScale);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(heading || 0);
    ctx.fillStyle = `rgba(0, 0, 0, ${(S.alpha * (1 - 0.35 * alt) * (0.35 + 0.65 * lit)).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * k, size * k * 0.55, 0, 0, TAU());
    ctx.fill();
    ctx.restore();
    return;
  }
}

// Altitude d'un cargo ou d'un module : faible près d'une surface
// (décollage, atterrissage), maximale en vol
function flightAlt(x, y) {
  let gap = Infinity;
  for (const p of G.planets) gap = Math.min(gap, Math.hypot(x - p.x, y - p.y) - p.radius);
  return Math.max(0.15, Math.min(1, gap / CONFIG.ui.shadow.climb));
}

function drawShadows() {
  for (const m of G.modules) castShadow(m.x, m.y, Math.max(2.6, 3.8 / UI.cam.zoom), Math.atan2(m.vy, m.vx), flightAlt(m.x, m.y));
  for (const m of G.cargos) castShadow(m.x, m.y, Math.max(2.4, 3.6 / UI.cam.zoom), Math.atan2(m.vy, m.vx), flightAlt(m.x, m.y));
  const r = Math.max(0.9, 1.9 / UI.cam.zoom) * 1.3;
  for (const f of G.fleets) for (const sh of f.ships) castShadow(sh.x, sh.y, r, Math.atan2(f.vy, f.vx), CONFIG.ui.shadow.fleetAlt);
}

// Obus d'artillerie des bases militaires : point brillant + courte traînée
function drawShells() {
  for (const sh of G.shells) {
    const color = G.players[sh.owner] ? G.players[sh.owner].color : '#ffffff';
    const pos = shellPos(sh);
    ctx.lineCap = 'round';
    for (let i = 1; i < sh.trail.length; i++) {
      const a = sh.trail[i - 1], b = sh.trail[i];
      ctx.globalAlpha = (i / sh.trail.length) * 0.6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4 / UI.cam.zoom;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff4d6';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(0.6, 2 / UI.cam.zoom), 0, TAU());
    ctx.fill();
  }
}

function drawParticles() {
  for (const pt of G.particles) {
    const a = Math.max(0, pt.life / pt.maxLife);
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(pt.rot);
    ctx.globalAlpha = a;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    for (let i = 0; i < pt.sides; i++) {
      const ang = (i / pt.sides) * TAU();
      const px = Math.cos(ang) * pt.size, py = Math.sin(ang) * pt.size;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
