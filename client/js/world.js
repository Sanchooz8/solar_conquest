// ============================================================
// SOLAR CONQUEST — Génération du système solaire
// ============================================================

// --- Noms de planètes générés par syllabes -------------------
const NAME_SYLLABLES = ['ka', 'ler', 'no', 'va', 'ri', 'on', 'ta', 'mi',
  'su', 'ra', 'zo', 'phe', 'de', 'os', 'li', 'the', 'ga', 'ul'];
const NAME_SUFFIXES = ['', '', '', ' Prime', ' Major', ' Minor', ' B'];

function generatePlanetName(used) {
  for (let tries = 0; tries < 40; tries++) {
    const n = 2 + Math.floor(Math.random() * 2);
    let name = '';
    for (let i = 0; i < n; i++) {
      name += NAME_SYLLABLES[Math.floor(Math.random() * NAME_SYLLABLES.length)];
    }
    name = name.charAt(0).toUpperCase() + name.slice(1);
    name += NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
    if (!used.has(name)) { used.add(name); return name; }
  }
  return 'Monde ' + (used.size + 1);
}

// --- Utilitaires ---------------------------------------------
function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function TAU() { return Math.PI * 2; }
function normAngle(a) { a = a % TAU(); return a < 0 ? a + TAU() : a; }

// --- Génération ----------------------------------------------
function generateSystem(numPlanets) {
  const S = CONFIG.system;
  const usedNames = new Set();
  const planets = [];

  let orbit = S.firstOrbit + rand(-20, 20);
  for (let i = 0; i < numPlanets; i++) {
    const radius = rand(S.planetRadiusMin, S.planetRadiusMax);
    if (i > 0) {
      const prev = planets[i - 1];
      orbit = prev.orbitRadius + prev.radius + radius + rand(S.orbitGapMin, S.orbitGapMax);
    }

    // Couronne de territoires en surface : ~100 secteurs pour une
    // planète moyenne, proportionnellement au rayon
    const rings = 1;
    const sectors = Math.max(CONFIG.grid.sectorsMin,
      Math.min(CONFIG.grid.sectorsMax,
        Math.round(radius / CONFIG.grid.mediumRadius * CONFIG.grid.sectorsMedium)));
    const band = Math.max(CONFIG.grid.bandMin, radius * CONFIG.grid.bandRatio);

    // Révolution : les planètes proches tournent plus vite
    const orbitSpeed = (S.orbitSpeedBase / Math.sqrt(orbit / 100)) * rand(1 - S.orbitSpeedJitter, 1 + S.orbitSpeedJitter);

    const planet = {
      id: i,
      name: generatePlanetName(usedNames),
      orbitRadius: orbit,
      orbitAngle: rand(0, TAU()),
      orbitSpeed: orbitSpeed,
      radius: radius,
      hue: rand(0, 360),
      sat: rand(14, 26),
      light: rand(24, 34),
      spin: rand(S.spinMin, S.spinMax) * (Math.random() < 0.5 ? -1 : 1),
      rotation: rand(0, TAU()),
      rings: rings,
      sectors: sectors,
      sectorAngle: TAU() / sectors,
      band: band,
      x: 0, y: 0,
      cells: [],
      craters: [],      // impacts de missiles { ang, dist, r } (repère planète)
      craterCells: [],  // territoires reconquérables le long des cratères
      buildCounts: {},  // bâtiments déjà construits, par type (coût progressif)
    };

    for (let r = 0; r < rings; r++) {
      const row = [];
      for (let s = 0; s < sectors; s++) {
        row.push({
          planet: planet, ring: r, sector: s,
          rTop: radius,           // rayon de la surface sous ce territoire
          owner: null,            // id joueur ou null
          pop: 0,                 // population = valeur de défense
          building: null,         // 'city' | 'industry' | 'silo' | 'shield' | 'colony' | 'tradeport' | 'military' | 'aa' | 'spaceport' | null
          contest: null,          // { attacker, force, initialDefense }
        });
      }
      planet.cells.push(row);
    }
    planets.push(planet);
  }
  updatePlanetPositions(planets);
  return planets;
}

function updatePlanetPositions(planets) {
  for (const p of planets) {
    p.x = Math.cos(p.orbitAngle) * p.orbitRadius;
    p.y = Math.sin(p.orbitAngle) * p.orbitRadius;
  }
}

// --- Géométrie des territoires (couronne périphérique) ---------
// Les territoires n'occupent que la surface : bande [radius-band, radius]
function cellAt(planet, wx, wy) {
  // Territoires de cratère d'abord (ils sont "par-dessus" la couronne)
  for (const cc of planet.craterCells) {
    const cr = cc.crater;
    const c = craterCenterWorld(planet, cr);
    const dx = wx - c.x, dy = wy - c.y;
    const d = Math.hypot(dx, dy);
    if (d < cr.r - planet.band || d > cr.r) continue;
    const t = normAngle(Math.atan2(dy, dx) - planet.rotation);
    if (normAngle(t - cc.t0) <= (cc.t1 - cc.t0)) return cc;
  }
  const dx = wx - planet.x, dy = wy - planet.y;
  const dist = Math.hypot(dx, dy);
  if (dist > planet.radius) return null;
  const ang = normAngle(Math.atan2(dy, dx) - planet.rotation);
  const sector = Math.min(planet.sectors - 1, Math.floor(ang / planet.sectorAngle));
  const cell = planet.cells[0][sector];
  if (cell.destroyed) return null; // secteur entièrement excavé : plus rien
  const top = cell.rTop ?? planet.radius; // la surface a pu s'affaisser (cratères)
  if (dist > top || dist < top - planet.band) return null;
  return cell;
}

function cellCentroid(cell) {
  const p = cell.planet;
  if (cell.craterCell) {
    const cr = cell.crater;
    const c = craterCenterWorld(p, cr);
    const midR = cr.r - p.band / 2;
    const midA = p.rotation + (cell.t0 + cell.t1) / 2;
    return { x: c.x + Math.cos(midA) * midR, y: c.y + Math.sin(midA) * midR, r: midR };
  }
  const midR = (cell.rTop ?? p.radius) - p.band / 2;
  const midA = p.rotation + (cell.sector + 0.5) * p.sectorAngle;
  return { x: p.x + Math.cos(midA) * midR, y: p.y + Math.sin(midA) * midR, r: midR };
}

// Largeur moyenne d'un territoire de couronne (sert au voisinage par proximité)
function territoryWidth(p) {
  return TAU() * (p.radius - p.band / 2) / p.sectors;
}

function cellNeighbors(cell) {
  const p = cell.planet;
  const out = [];
  if (!cell.craterCell) {
    const s = cell.sector, r = cell.ring, n = p.sectors;
    out.push(p.cells[r][(s + 1) % n]);
    out.push(p.cells[r][(s - 1 + n) % n]);
    if (r > 0) out.push(p.cells[r - 1][s]);
    if (r < p.rings - 1) out.push(p.cells[r + 1][s]);
  }
  // Les territoires de cratère sont voisins par proximité géographique :
  // entre eux le long de l'arc, et avec la couronne alentour
  if (p.craterCells.length) {
    const c0 = cellCentroid(cell);
    const reach = territoryWidth(p) * 1.9 + p.band;
    for (const cc of p.craterCells) {
      if (cc === cell) continue;
      const c1 = cellCentroid(cc);
      if (Math.hypot(c1.x - c0.x, c1.y - c0.y) < reach) out.push(cc);
    }
    if (cell.craterCell) {
      for (const c of p.cells[0]) {
        if (c.destroyed) continue;
        const c1 = cellCentroid(c);
        if (Math.hypot(c1.x - c0.x, c1.y - c0.y) < reach) out.push(c);
      }
    }
  }
  return out;
}

// --- Territoires de cratère --------------------------------------
// Centre monde d'un cratère (coordonnées relatives → suit la rotation)
function craterCenterWorld(planet, cr) {
  const a = planet.rotation + cr.ang;
  return { x: planet.x + Math.cos(a) * cr.dist, y: planet.y + Math.sin(a) * cr.dist };
}

// Tous les territoires d'une planète (couronne ; point d'extension)
function planetCells(planet) {
  return planet.cells.flat().concat(planet.craterCells);
}

// Recalcule la surface de la planète secteur par secteur après un impact.
// Chaque territoire garde exactement sa forme (même largeur angulaire,
// même épaisseur de croûte) mais il est reposé sur le bord des cratères :
// la couronne épouse la nouvelle silhouette de la planète. Un territoire
// dont la surface s'affaisse est vidé par le souffle (neutre, calciné) ;
// un secteur excavé trop profondément disparaît — la planète rapetisse
// et son nombre total de territoires diminue. Idempotent.
function reshapePlanet(planet) {
  const R = planet.radius, band = planet.band;
  for (const cell of planet.cells[0]) {
    if (cell.destroyed) continue;
    // Rayon partant du centre de la planète au milieu du secteur
    const a = (cell.sector + 0.5) * planet.sectorAngle;
    const ux = Math.cos(a), uy = Math.sin(a);
    let top = R;
    for (const cr of planet.craters) {
      // Intersection rayon (centre planète, direction u) / cercle du cratère
      const cx = Math.cos(cr.ang) * cr.dist, cy = Math.sin(cr.ang) * cr.dist;
      const b = ux * cx + uy * cy;
      const c2 = cx * cx + cy * cy - cr.r * cr.r;
      const disc = b * b - c2;
      if (disc <= 0) continue;           // le rayon ne croise pas ce cratère
      if (c2 < 0) { top = 0; break; }    // centre de la planète dans le cratère
      const tIn = b - Math.sqrt(disc);   // entrée du rayon dans le cratère
      if (tIn <= 0) continue;            // cratère DERRIÈRE le rayon : aucun effet
      if (tIn < top) top = tIn;
    }
    if (top >= R - band * 0.5) continue; // surface à peine entamée : inchangé

    if (top - band < R * 0.35) {
      // Secteur excavé trop profondément : le territoire disparaît
      cell.destroyed = true;
      cell.owner = null; cell.pop = 0;
      cell.building = null; cell.missiles = undefined; cell.contest = null;
      G.cellsTotal--; // la planète a rapetissé : un territoire de moins
    } else if (top < (cell.rTop ?? R) - 0.01) {
      // Le territoire est reposé sur la nouvelle surface, vidé par le souffle
      cell.rTop = top;
      cell.scorched = true;
      cell.owner = null; cell.pop = 0;
      cell.building = null; cell.missiles = undefined; cell.contest = null;
    }
  }
}

function cellCap(cell) {
  return CONFIG.pop.baseCap + (cell.building === 'city' ? CONFIG.pop.cityCapBonus : 0);
}

// Coût de base d'un bâtiment
function buildingBaseCost(type) {
  return type === 'city' ? CONFIG.econ.cityCost
    : type === 'industry' ? CONFIG.econ.industryCost
    : type === 'shield' ? CONFIG.econ.shieldCost
    : type === 'colony' ? CONFIG.econ.colonyCost
    : type === 'tradeport' ? CONFIG.econ.tradeportCost
    : type === 'military' ? CONFIG.econ.militaryCost
    : type === 'aa' ? CONFIG.econ.aaCost
    : type === 'spaceport' ? CONFIG.econ.spaceportCost
    : CONFIG.econ.siloCost;
}

// Coût progressif : chaque bâtiment du même type construit sur la planète
// coûte 25 % de plus que le précédent (×1,25 par itération).
function buildingCost(planet, type) {
  const n = (planet.buildCounts && planet.buildCounts[type]) || 0;
  return Math.round(buildingBaseCost(type) * Math.pow(CONFIG.econ.costEscalation, n));
}

// Bouclier : grand disque bleu centré sur le bâtiment, couvrant environ
// `shield.arcSectors` territoires de chaque côté le long de la couronne.
// Coordonnées monde (suit la rotation de la planète).
function shieldFrame(cell) {
  const pl = cell.planet;
  const midA = pl.rotation + (cell.sector + 0.5) * pl.sectorAngle;
  return {
    x: pl.x + Math.cos(midA) * pl.radius,
    y: pl.y + Math.sin(midA) * pl.radius,
    r: pl.radius * pl.sectorAngle * CONFIG.shield.arcSectors + pl.band,
  };
}

// Croissance de population (logistique généralisée) :
// la vitesse dépend du plafond (pop max) ET de la population réelle —
// elle accélère jusqu'à 45 % du plafond puis ralentit jusqu'à 100 %.
function cellPopGrowth(cell) {
  const K = cellCap(cell);
  if (cell.pop <= 0 || cell.pop >= K) return 0;
  const f = CONFIG.pop.growthInflection;         // 0.45
  const b = (1 - f) / f;
  const x = cell.pop / K;
  const shape = x * Math.pow(1 - x, b);
  const shapeMax = f * Math.pow(1 - f, b);
  const mult = cell.building === 'city' ? CONFIG.pop.cityGrowthMult : 1;
  return CONFIG.pop.growthRate * (K / 100) * (shape / shapeMax) * mult;
}

function totalCells(planets) {
  return planets.reduce((sum, p) => sum + p.rings * p.sectors, 0);
}
