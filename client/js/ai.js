// ============================================================
// SOLAR CONQUEST — Intelligence artificielle des bots
//
// Chaque bot a un PROFIL :
//  - un niveau (skill, 0 à 1) : vitesse de décision, qualité du choix des
//    constructions, précision de la visée (missiles, colonisation, flottes) ;
//  - une dominante parmi trois voies, non exclusives :
//      colons   : beaucoup d'habitants, puis colonisation d'autres planètes ;
//      missiles : silos nombreux, bombardement des planètes adverses ;
//      flotte   : spatioports, grandes flottes qui rasent les bâtiments.
//    La dominante pèse 1, les deux autres 0,35 : chaque bot mélange les trois.
//
// Plan général : conquérir sa planète, puis coloniser une planète neutre,
// ou à défaut une planète habitée faible.
// ============================================================

const BOT_STYLES = ['colons', 'missiles', 'flotte'];
const BOT_STYLE_LABELS = { colons: 'colons', missiles: 'missiles', flotte: 'vaisseaux' };

function lerp(a, b, t) { return a + (b - a) * t; }

// Voies disponibles (la voie « flotte » est en veille si les vaisseaux sont désactivés)
function activeBotStyles() {
  return BOT_STYLES.filter(s => s !== 'flotte' || CONFIG.features.fleets);
}

function makeBotProfile() {
  const A = CONFIG.ai;
  const styles = activeBotStyles();
  const style = styles[Math.floor(Math.random() * styles.length)];
  const w = {};
  for (const s of BOT_STYLES) w[s] = !styles.includes(s) ? 0 : s === style ? A.styleWeight : A.sideWeight;
  return { skill: rand(A.skillMin, A.skillMax), style, w };
}

function skillLabel(skill) {
  return skill < 0.25 ? 'très faible' : skill < 0.45 ? 'faible' : skill < 0.65 ? 'moyen' : skill < 0.85 ? 'fort' : 'expert';
}

// --- Boucle de décision ---------------------------------------------------
function updateBot(bot, dt) {
  if (!bot.profile) bot.profile = makeBotProfile();
  const P = bot.profile, A = CONFIG.ai;
  bot.aiTimer -= dt;
  if (bot.aiTimer > 0) return;
  bot.aiTimer = lerp(A.tickSlow, A.tickFast, P.skill) * rand(0.8, 1.2);

  const cells = ownedCells(bot.id);
  if (!cells.length) { bot.alive = false; return; }

  // 1. Riposte immédiate si un territoire est attaqué
  if (botRiposte(bot, cells)) return;

  // 2. Une construction (selon la dominante), puis 3. un mouvement au sol
  botBuild(bot, cells);
  botGroundAttack(bot, cells);

  // 4. Opérations spatiales (colons, missiles, flottes), plus espacées
  botSpace(bot, cells);
}

function ownedNeighborCount(cell, playerId) {
  return cellNeighbors(cell).filter(n => n.owner === playerId).length;
}

// --- Riposte ----------------------------------------------------------
function botRiposte(bot, cells) {
  const underAttack = cells.filter(c => c.contest && c.contest.attacker !== bot.id);
  if (!underAttack.length || bot.money < CONFIG.combat.attackCost) return false;
  if (Math.random() > 0.5 + 0.4 * bot.profile.skill) return false;
  for (const t of underAttack) {
    const enemyCell = cellNeighbors(t).find(n => n.owner === t.contest.attacker);
    if (enemyCell && attackCell(bot, enemyCell).ok) return true;
  }
  return false;
}

// --- Au sol : expansion vers le neutre, puis attaque des voisins faibles ---
function botGroundAttack(bot, cells) {
  if (bot.money < CONFIG.combat.attackCost) return;
  const neutral = [];
  for (const c of cells) for (const n of cellNeighbors(c))
    if (n.owner === null && !n.contest && !n.destroyed) neutral.push(n);
  if (neutral.length) {
    neutral.sort((a, b) => ownedNeighborCount(b, bot.id) - ownedNeighborCount(a, bot.id));
    const pick = Math.random() < 0.4 + 0.5 * bot.profile.skill ? neutral[0]
      : neutral[Math.floor(Math.random() * neutral.length)];
    if (attackCell(bot, pick).ok) return;
  }
  // Voisins ennemis : le plus faible, en exigeant un avantage
  const preyNearby = cells.some(c => cellNeighbors(c).some(n => n.owner !== null && isVulnerable(n.owner) && isHostile(bot.id, n.owner)));
  if (!preyNearby && Math.random() > 0.35 + 0.4 * bot.profile.skill) return;
  let best = null, bestEff = Infinity;
  for (const c of cells) for (const n of cellNeighbors(c)) {
    if (n.owner === null || !isHostile(bot.id, n.owner) || n.contest) continue;
    // Un traître vulnérable se défend 5 fois moins bien : cible de choix
    const eff = isVulnerable(n.owner) ? n.pop / CONFIG.diplomacy.betrayDefenseDiv : n.pop;
    if (c.pop > eff * 1.15 && eff < bestEff) { best = n; bestEff = eff; }
  }
  if (best) attackCell(bot, best);
}

// --- Informations sur les planètes ------------------------------------------
function botPlanetInfo(bot) {
  const info = new Map();
  for (const p of G.planets) {
    const it = { planet: p, mine: 0, myPop: 0, living: 0, neutral: 0, hostilePop: 0, hostileCells: 0,
      allied: 0, b: {}, hostileBuildings: 0, hostileAA: 0, hostileMil: 0 };
    for (const c of planetCells(p)) {
      if (c.destroyed) continue;
      it.living++;
      if (c.owner === null) { it.neutral++; continue; }
      if (c.owner === bot.id) {
        it.mine++; it.myPop += c.pop;
        if (c.building) it.b[c.building] = (it.b[c.building] || 0) + 1;
      } else if (isHostile(bot.id, c.owner)) {
        it.hostileCells++; it.hostilePop += c.pop;
        if (c.building) {
          it.hostileBuildings++;
          if (c.building === 'aa') it.hostileAA++;
          if (c.building === 'military') it.hostileMil++;
        }
      } else it.allied++;
    }
    info.set(p, it);
  }
  return info;
}

// Distance (en territoires) au plus proche territoire ennemi de la planète
function frontDistance(bot, cell) {
  let best = Infinity;
  for (const c of planetCells(cell.planet)) {
    if (c.destroyed || c.owner === null || !isHostile(bot.id, c.owner)) continue;
    best = Math.min(best, sectorDistance(c, cell));
  }
  return best;
}

// --- Constructions ------------------------------------------------------------
// Liste de candidats notés selon la dominante ; un bot faible choisit
// parfois au hasard (build order moins optimisé)
function botBuild(bot, cells) {
  const P = bot.profile, A = CONFIG.ai, w = P.w;
  const info = botPlanetInfo(bot);
  const mine = [...info.values()].filter(it => it.mine > 0).sort((a, b) => b.mine - a.mine);
  if (!mine.length) return false;
  // Planète travaillée : surtout la principale, parfois une autre
  const it = mine.length > 1 && Math.random() < 0.35 ? mine[1 + Math.floor(Math.random() * (mine.length - 1))] : mine[0];
  const pl = it.planet, n = it.mine, b = it.b;
  const myCells = cells.filter(c => c.planet === pl);
  const industries = b.industry || 0;
  const ownRatio = it.living ? n / it.living : 0;
  const noNeutralAdj = !myCells.some(c => cellNeighbors(c).some(x => x.owner === null && !x.destroyed));
  const pressure = myCells.reduce((s, c) => s + c.pop / cellCap(c), 0) / Math.max(1, myCells.length);
  const enemySilos = G.planets.some(p => planetCells(p).some(c => c.building === 'silo' && c.owner !== null && isHostile(bot.id, c.owner)));

  const cand = [];
  const add = (type, score) => cand.push({ type, score });
  if (industries < 1 + Math.floor(n / 6)) add('industry', 60);
  if (industries >= 2 && !b.tradeport) add('tradeport', 55);
  if (pressure > (w.colons >= 1 ? 0.5 : 0.7)) add('city', 45 + 25 * w.colons);
  if ((b.city || 0) < n / (w.colons >= 1 ? 5 : 9) && industries >= 2) add('city', 30 + 25 * w.colons);
  if (industries >= 2 && !b.colony && (ownRatio >= (w.colons >= 1 ? 0.45 : 0.6) || noNeutralAdj)) add('colony', 40 + 35 * w.colons);
  if (industries >= 2 && (b.silo || 0) < Math.floor(w.missiles * 3 + n / 25) && (w.missiles >= 1 || n >= 35)) add('silo', 30 + 40 * w.missiles);
  if (CONFIG.features.fleets && industries >= 2 && !b.spaceport && (w.flotte >= 1 || n >= 45)) add('spaceport', 30 + 40 * w.flotte);
  if (enemySilos && (b.shield || 0) < 1 + Math.floor(n / 40)) add('shield', 40 + 10 * w.missiles);
  if ((b.aa || 0) < Math.floor(n / 30) && enemyHasAirThreat(bot.id)) add('aa', 45);
  if ((b.military || 0) < 1 + Math.floor(n / 25) && myCells.some(c => !c.building && baseTarget(c, bot.id))) add('military', 50);
  if (!cand.length) return false;

  cand.sort((x, y) => y.score - x.score);
  const pick = Math.random() < A.mistakeMax * (1 - P.skill) ? cand[Math.floor(Math.random() * cand.length)] : cand[0];
  const cost = buildingCost(pl, pick.type);
  if (bot.money < cost + 40) return false; // garde de quoi attaquer
  const cell = pickBuildCell(bot, myCells, pick.type);
  return !!(cell && buildOn(bot, cell, pick.type).ok);
}

// Emplacement : à l'abri du front pour les bâtiments précieux, près du
// front pour la base militaire, au hasard pour un bot peu doué
function pickBuildCell(bot, myCells, type) {
  const free = myCells.filter(c => !c.building && !c.contest && !c.destroyed);
  if (!free.length) return null;
  if (type === 'military') {
    let spot = null, spotD = Infinity;
    for (const c of free) {
      const tgt = baseTarget(c, bot.id);
      if (!tgt) continue;
      const d = sectorDistance(c, tgt);
      if (d >= 2 && d < spotD) { spot = c; spotD = d; }
    }
    return spot;
  }
  if (type === 'city') return free.sort((a, b) => (b.pop / cellCap(b)) - (a.pop / cellCap(a)))[0];
  if (Math.random() > bot.profile.skill + 0.2) return free[Math.floor(Math.random() * free.length)];
  let best = free[0], bestD = -1;
  for (const c of free) {
    const d = Math.min(30, frontDistance(bot, c));
    if (d > bestD) { best = c; bestD = d; }
  }
  return best;
}

// --- Opérations spatiales ---------------------------------------------------
function botSpace(bot, cells) {
  const P = bot.profile, A = CONFIG.ai;
  const info = botPlanetInfo(bot);
  if (CONFIG.features.fleets) { botShips(bot, info); botFleetOrders(bot, info); }
  const cool = lerp(A.spaceCooldownSlow, A.spaceCooldownFast, P.skill);
  if ((bot.spaceT || 0) > G.time) return;
  // Choix pondéré entre colonisation, missiles et lancement de flotte
  const opts = [['colons', botColonize], ['missiles', botMissiles], ['flotte', botLaunchFleet]]
    .filter(([style]) => activeBotStyles().includes(style))
    .sort(() => Math.random() - 0.5)
    .sort((a, b) => P.w[b[0]] * Math.random() - P.w[a[0]] * Math.random());
  for (const [style, fn] of opts) {
    if (fn(bot, info)) { bot.spaceT = G.time + cool * (style === P.style ? 0.6 : 1); return; }
  }
}

// Erreur de visée : angle (rad) et distance (u) selon le niveau
function aimAngleError(bot) { return (Math.random() * 2 - 1) * CONFIG.ai.landErrMax * (1 - bot.profile.skill); }

// Colonisation : planète neutre de préférence, sinon planète habitée faible
function botColonize(bot, info) {
  const P = bot.profile;
  if (bot.money < CONFIG.colony.launchCost) return false;
  const sources = [...info.values()].filter(it => it.mine > 0 && colonyCenters(bot.id, it.planet).length);
  if (!sources.length) return false;
  const src = sources.sort((a, b) => b.myPop - a.myPop)[0];
  const ownRatio = src.living ? src.mine / src.living : 0;
  // D'abord conquérir sa planète
  if (ownRatio < (P.w.colons >= 1 ? 0.45 : 0.6) && src.neutral > 0) return false;
  const share = P.w.colons >= 1 ? 0.5 : 0.3;
  if (src.myPop * share < Math.max(CONFIG.colony.minColonists, 120)) return false;

  let target = null, best = -Infinity;
  for (const it of info.values()) {
    const p = it.planet;
    if (p === src.planet || it.living < 8) continue;
    if (it.mine > it.living * 0.5) continue; // déjà à moi
    const dist = Math.hypot(p.x - src.planet.x, p.y - src.planet.y);
    let score;
    if (it.hostileCells === 0 && it.allied === 0) score = 1000 - dist * 0.3;   // neutre
    else score = 400 - it.hostilePop / Math.max(1, it.hostileCells) * 3 - it.hostileAA * 60 - dist * 0.2 + it.neutral * 2;
    if (it.allied > 0 && it.hostileCells === 0) score -= 500;
    // Un bot peu doué choisit moins bien
    score += (Math.random() - 0.5) * 400 * (1 - P.skill);
    if (score > best) { best = score; target = p; }
  }
  if (!target) return false;

  // Point d'atterrissage : un territoire neutre bien entouré, sinon le plus faible ennemi
  let spot = null, spotScore = -Infinity;
  for (const c of planetCells(target)) {
    if (c.destroyed || c.craterCell || (c.owner !== null && !isHostile(bot.id, c.owner))) continue;
    const s = c.owner === null ? 100 + cellNeighbors(c).filter(x => x.owner === null).length * 10 : 50 - c.pop;
    if (s > spotScore) { spotScore = s; spot = c; }
  }
  if (!spot) return false;
  const ang = (spot.sector + 0.5) * target.sectorAngle + aimAngleError(bot);
  return launchColonyModule(bot, src.planet, share, target, normAngle(ang)).ok;
}

// Position prévue d'un territoire au bout de t secondes (orbite + rotation)
function predictCellPos(cell, t) {
  const p = cell.planet;
  const oa = p.orbitAngle + p.orbitSpeed * t;
  const px = Math.cos(oa) * p.orbitRadius, py = Math.sin(oa) * p.orbitRadius;
  const a = p.rotation + p.spin * t + (cell.sector + 0.5) * p.sectorAngle;
  const r = (cell.rTop ?? p.radius) - p.band * 0.5;
  return { x: px + Math.cos(a) * r, y: py + Math.sin(a) * r };
}

// Missiles : salve sur les bâtiments d'une planète ennemie, avec anticipation
// du mouvement de la cible et une erreur de visée selon le niveau
function botMissiles(bot, info) {
  const P = bot.profile, A = CONFIG.ai, M = CONFIG.missiles;
  if (bot.money < M.launchCost) return false;
  let src = null, loaded = 0;
  for (const it of info.values()) {
    if (!it.mine) continue;
    const n = loadedSilos(bot.id, it.planet).length;
    if (n > loaded) { loaded = n; src = it.planet; }
  }
  if (!src) return false;
  const volley = P.w.missiles >= 1 ? Math.min(loaded, 2 + Math.floor(P.skill * 2)) : 1;
  if (loaded < Math.min(volley, P.w.missiles >= 1 ? 2 : 1)) return false;
  if (P.w.missiles < 1 && Math.random() > 0.35) return false; // voie secondaire : tirs occasionnels

  // Cible : le territoire ennemi le plus précieux (ville > industrie > bâtiment > population)
  let target = null, best = -Infinity;
  for (const it of info.values()) {
    if (!it.hostileCells || it.planet === src) continue;
    for (const c of planetCells(it.planet)) {
      if (c.destroyed || c.owner === null || !isHostile(bot.id, c.owner)) continue;
      let s = c.pop * 0.3 + (c.building === 'city' ? 60 : c.building === 'industry' ? 50 : c.building ? 35 : 0);
      // Pas de tir près d'un allié (ce serait une trahison)
      if (cellNeighbors(c).some(x => x.owner !== null && x.owner !== bot.id && !isHostile(bot.id, x.owner))) continue;
      s += (Math.random() - 0.5) * 80 * (1 - P.skill);
      if (s > best) { best = s; target = c; }
    }
  }
  if (!target) return false;
  const here = cellCentroid(target);
  const t = M.riseTime + Math.hypot(here.x - src.x, here.y - src.y) / M.flightSpeed * 1.15;
  const aim = predictCellPos(target, P.skill > 0.3 ? t : t * P.skill / 0.3); // un bot faible anticipe mal
  const err = lerp(A.aimErrMax, A.aimErrMin, P.skill);
  const ea = Math.random() * TAU(), er = Math.random() * err;
  return launchMissiles(bot, src, volley, { x: aim.x + Math.cos(ea) * er, y: aim.y + Math.sin(ea) * er }).ok;
}

// Vaisseaux : construction selon la dominante
function botShips(bot, info) {
  const P = bot.profile;
  const cap = P.w.flotte >= 1 ? 6 + Math.round(6 * P.skill) : 4;
  if (playerShipCount(bot.id) >= cap) return;
  for (const it of info.values()) {
    if (!it.mine || !spaceports(bot.id, it.planet).length) continue;
    if (bot.money >= shipCost(bot.id) + (P.w.flotte >= 1 ? 60 : 200)) { buildShip(bot, it.planet); return; }
  }
}

// Planète ennemie la plus intéressante pour une flotte : beaucoup de
// bâtiments, peu de DAA (un bot faible évalue moins bien)
function bestFleetTarget(bot, info) {
  let best = null, bestS = -Infinity;
  for (const it of info.values()) {
    if (!it.hostileBuildings) continue;
    const s = it.hostileBuildings * 10 - it.hostileAA * 25 * bot.profile.skill * 2 + (Math.random() - 0.5) * 40 * (1 - bot.profile.skill);
    if (s > bestS) { bestS = s; best = it.planet; }
  }
  if (!best) return null;
  // Arrivée au-dessus du groupe de bâtiments ennemis le plus dense
  let bestSec = 0, bestN = -1;
  const cs = planetCells(best).filter(c => !c.destroyed && c.building && c.owner !== null && isHostile(bot.id, c.owner));
  for (const c of cs) {
    const n = cs.filter(o => sectorDistance(o, c) <= 6).length;
    if (n > bestN) { bestN = n; bestSec = c.sector; }
  }
  return { kind: 'planet', planet: best, ang: normAngle((bestSec + 0.5) * best.sectorAngle + aimAngleError(bot)) };
}

function botLaunchFleet(bot, info) {
  const P = bot.profile;
  const need = P.w.flotte >= 1 ? 4 : 5;
  for (const it of info.values()) {
    if (!it.mine) continue;
    const stock = storedShips(bot.id, it.planet);
    if (stock < need) continue;
    const target = bestFleetTarget(bot, info);
    if (!target) return false;
    return launchFleet(bot, it.planet, stock, target).ok;
  }
  return false;
}

// Ordres aux flottes déjà lancées : défendre ses planètes, sinon trouver
// de nouveaux bâtiments à raser quand la cible est nettoyée
function botFleetOrders(bot, info) {
  for (const f of G.fleets) {
    if (f.owner !== bot.id || !f.ships.length) continue;
    // Une flotte ennemie au-dessus d'une de mes planètes : l'intercepter si on est plus nombreux
    const threat = G.fleets.find(e => isHostile(bot.id, e.owner) && e.ships.length < f.ships.length * 1.3 &&
      e.state === 'orbit' && e.orbitPlanet && (info.get(e.orbitPlanet) || {}).mine > 0);
    if (threat && !(f.target && f.target.fleet === threat)) { retargetFleet(f, { kind: 'fleet', fleet: threat }); continue; }
    const idle = f.state === 'idle' || (f.state === 'orbit' && !(info.get(f.orbitPlanet) || {}).hostileBuildings);
    if (idle && Math.random() < 0.3 + 0.6 * bot.profile.skill) {
      const t = bestFleetTarget(bot, info);
      if (t) retargetFleet(f, t);
    }
  }
}

// --- Placement initial ------------------------------------------------------
// Placement de la colonie d'un bot (après le joueur humain)
function placeBotColony(bot, takenPlanets) {
  // Préfère une planète libre ; sinon partage une planète
  const freePlanets = G.planets.filter(p => !takenPlanets.has(p.id));
  const pool = freePlanets.length ? freePlanets : G.planets;
  const planet = pool[Math.floor(Math.random() * pool.length)];
  takenPlanets.add(planet.id);

  const sector = randInt(0, planet.sectors - 1);
  const cell = planet.cells[0][sector];
  if (cell.owner !== null) {
    // Cherche la première cellule libre de la planète
    for (const c of planet.cells[0]) {
      if (c.owner === null && !c.destroyed) { foundColony(bot, c); return; }
    }
    return;
  }
  foundColony(bot, cell);
}

// Un adversaire peut-il frapper depuis l'espace (silos, colonisation, spatioport) ?
function enemyHasAirThreat(playerId) {
  for (const p of G.planets)
    for (const c of planetCells(p))
      if (c.owner !== null && c.owner !== playerId && !c.destroyed &&
          (c.building === 'silo' || c.building === 'colony' || c.building === 'spaceport')) return true;
  return false;
}
