// ============================================================
// SOLAR CONQUEST — État du jeu et mécaniques
// ============================================================

const G = {
  me: 0,                // id du joueur local (0 en solo et pour l'hôte)
  phase: 'menu',        // 'menu' | 'placement' | 'playing' | 'over'
  planets: [],
  players: [],
  cellsTotal: 0,
  time: 0,
  speed: 1,
  paused: false,
  winner: null,
  particles: [],
  missiles: [],
  modules: [],
  cargos: [],
  alliances: [],
  allyRequests: [],
  shells: [],
  flak: [],
  fleets: [],
  bolts: [],
};

// Identifiants des objets en vol (missiles, modules, cargos, obus, DAA) :
// ils permettent au client de suivre chaque objet d'un instantané à l'autre
let _entityId = 1;
function nextEntityId() { return _entityId++; }

// humans : pseudos des joueurs humains (le premier est l'hôte / le joueur solo)
function newGame(numPlanets, numBots, humans = ['You']) {
  G.planets = generateSystem(numPlanets);
  G.cellsTotal = totalCells(G.planets);
  G.players = [];
  G.time = 0;
  G.winner = null;
  G.particles = [];
  G.missiles = [];
  G.modules = [];
  G.cargos = [];
  G.alliances = [];
  G.allyRequests = [];
  G.shells = [];
  G.flak = [];
  G.fleets = [];
  G.bolts = [];
  G.paused = false;
  G.speed = 1;
  G.placingBots = false;

  G.me = 0;
  humans.forEach((name, i) => G.players.push({
    id: i, name, color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    money: CONFIG.econ.startMoney, isBot: false, alive: true,
    colonyPlaced: false,
  }));
  const h = humans.length;
  for (let i = 0; i < numBots; i++) {
    G.players.push({
      id: h + i, name: BOT_NAMES[i % BOT_NAMES.length], color: PLAYER_COLORS[(h + i) % PLAYER_COLORS.length],
      money: CONFIG.econ.startMoney, isBot: true, alive: true,
      colonyPlaced: false,
      aggression: rand(0.5, 1.4),
      aiTimer: rand(CONFIG.ai.tickMin, CONFIG.ai.tickMax),
    });
  }
  G.phase = 'placement';
}

// --- Requêtes -------------------------------------------------
function ownedCells(playerId) {
  const out = [];
  for (const p of G.planets)
    for (const c of planetCells(p))
      if (c.owner === playerId) out.push(c);
  return out;
}

function playerPop(playerId) {
  return ownedCells(playerId).reduce((s, c) => s + c.pop, 0);
}

function playerTerritories(playerId) {
  return ownedCells(playerId).length;
}

// Message destiné à un joueur précis : affiché ici si c'est le joueur
// local, sinon relayé à son navigateur par l'hôte (multijoueur)
function notify(pid, msg, ok) {
  if (pid === null || pid === undefined) return;
  if (pid === G.me) showToast(msg, ok);
  else if (typeof Session !== 'undefined') Session.event({ k: 'toast', to: pid, msg, ok: !!ok });
}

// --- Particules (feedback visuel) ------------------------------
function spawnBurst(x, y, color, count, sizeMul = 1) {
  // L'hôte rejoue les explosions chez les clients
  if (typeof Session !== 'undefined' && Session.role === 'host') Session.fx(x, y, color, count, sizeMul);
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU());
    const sp = rand(30, 130) * sizeMul;
    G.particles.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.4, 0.9), maxLife: 0.9,
      size: rand(2.5, 6) * sizeMul, rot: rand(0, TAU()), vr: rand(-6, 6),
      color, sides: randInt(3, 5),
    });
  }
}

// Petite étincelle de combat sur un territoire contesté — couleur d'un
// des deux camps qui s'affrontent
function spawnSpark(cell) {
  const p = cell.planet;
  const contest = cell.contest;
  const a = p.rotation + (cell.sector + Math.random()) * p.sectorAngle;
  const rr = (cell.rTop ?? p.radius) - Math.random() * p.band;
  const sa = rand(0, TAU());
  const sp = rand(8, 42);
  G.particles.push({
    x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr,
    vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp,
    life: rand(0.2, 0.45), maxLife: 0.45,
    size: rand(0.8, 1.8), rot: rand(0, TAU()), vr: rand(-9, 9),
    color: Math.random() < 0.5
      ? G.players[contest.attacker].color
      : (cell.owner !== null ? G.players[cell.owner].color : '#8a8a96'),
    sides: 3,
  });
}

// --- Actions ---------------------------------------------------

// Fonder une colonie (phase de placement)
function foundColony(player, cell) {
  cell.owner = player.id;
  cell.pop = CONFIG.pop.startPop;
  cell.building = 'city';
  player.colonyPlaced = true;
  const c = cellCentroid(cell);
  spawnBurst(c.x, c.y, player.color, 14);
}

// Population totale d'un joueur sur une planète donnée
function planetPopOnPlanet(playerId, planet) {
  let sum = 0;
  for (const c of planetCells(planet))
    if (c.owner === playerId) sum += c.pop;
  return sum;
}

// --- Guerre locale ------------------------------------------------
// Position d'un territoire le long de la couronne, en « secteurs »
// (0 … sectors). Les territoires de cratère sont repérés par l'angle de
// leur centre vu depuis le centre de la planète.
function cellSectorPos(cell) {
  const p = cell.planet;
  if (!cell.craterCell) return cell.sector + 0.5;
  const c = cellCentroid(cell);
  return normAngle(Math.atan2(c.y - p.y, c.x - p.x) - p.rotation) / p.sectorAngle;
}

// Distance en secteurs entre deux territoires d'une même planète (couronne circulaire)
function sectorDistance(a, b) {
  const n = a.planet.sectors;
  const d = Math.abs(cellSectorPos(a) - cellSectorPos(b)) % n;
  return Math.min(d, n - d);
}

// Territoires d'un joueur à portée locale d'une cible (combat.localRange).
// Seuls ces territoires fournissent la force d'attaque et le soutien
// défensif : la guerre se joue sur un front, pas à l'échelle de la planète.
function localCells(playerId, cell, opts = {}) {
  const range = CONFIG.combat.localRange;
  const out = [];
  for (const c of planetCells(cell.planet)) {
    if (c.owner !== playerId || c.destroyed) continue;
    if (opts.excludeContested && c.contest) continue;
    if (sectorDistance(c, cell) <= range) out.push(c);
  }
  return out;
}

function localPop(playerId, cell) {
  return localCells(playerId, cell).reduce((s, c) => s + c.pop, 0);
}

// --- Base militaire ------------------------------------------------
// Bases d'un joueur à portée locale d'une cible (bonus d'attaque)
function basesInRange(playerId, cell) {
  return localCells(playerId, cell).filter(c => c.building === 'military').length;
}

// Le territoire est-il protégé par une base de son propriétaire
// (la base elle-même ou un territoire adjacent) ?
function guardedByBase(cell) {
  if (cell.owner === null) return false;
  if (cell.building === 'military') return true;
  return cellNeighbors(cell).some(n => n.owner === cell.owner && n.building === 'military' && !n.destroyed);
}

// Crée un combat sur un territoire : défense = pop du territoire + soutien
// des territoires voisins du défenseur (à portée locale).
// Un territoire neutre a une petite résistance fixe.
function makeContest(attackerId, cell, force, fromCell) {
  const bonus = cell.owner !== null
    ? CONFIG.combat.planetSupport * localPop(cell.owner, cell)
    : 0;
  let defense = cell.owner !== null
    ? cell.pop + bonus
    : CONFIG.combat.neutralDefense;
  // Base militaire : +20 % de défense sur la base et ses territoires adjacents
  if (cell.owner !== null && cell.owner !== attackerId && guardedByBase(cell)) {
    defense *= 1 + CONFIG.military.defenseBonus;
  }
  // fromCell : territoire d'où part l'attaque (le remplissage de progression
  // part de ce côté-là du territoire)
  // `bonus` = tout ce qui s'ajoute à la pop. réelle du territoire (soutien,
  // base militaire) : retiré si l'attaque est repoussée
  let bonusAll = Math.max(0, defense - cell.pop);
  // Traître vulnérable : défense divisée par 5 (l'attaque n'est pas touchée).
  // `scale` permet de restituer la vraie population si l'attaque échoue.
  let scale = 1;
  if (cell.owner !== null && isVulnerable(cell.owner)) {
    scale = CONFIG.diplomacy.betrayDefenseDiv;
    defense /= scale; bonusAll /= scale;
  }
  return { attacker: attackerId, force, defense, bonus: bonusAll, scale, initialDefense: Math.max(1, defense),
    from: fromCell || null };
}

// Attaquer un territoire (neutre ou ennemi) — UNE SEULE mécanique :
// chaque attaque coûte 50 $ + 10 % de la population du joueur sur la planète,
// prélevée proportionnellement sur chacun de ses territoires non contestés.
// Gère aussi le renfort et le choc frontal (contre-attaque du défenseur).
function attackCell(player, dstCell) {
  if (dstCell.destroyed) return { ok: false, msg: T('err.destroyed') };
  if (dstCell.owner === player.id) return { ok: false, msg: T('err.badTarget') };
  if (areAllied(player.id, dstCell.owner)) return { ok: false, msg: T('err.alliedAttack', { name: G.players[dstCell.owner].name }) };
  if (player.money < CONFIG.combat.attackCost) return { ok: false, msg: T('err.noMoney') };

  // Force engagée : 10 % de ma population LOCALE (territoires à portée de
  // la cible, hors territoires déjà contestés), prélevée proportionnellement
  const myCells = localCells(player.id, dstCell, { excludeContested: true });
  const total = myCells.reduce((s, c) => s + c.pop, 0);
  const drawn = Math.floor(total * CONFIG.combat.attackShare);
  if (drawn < CONFIG.combat.minAttackForce) return { ok: false, msg: T('err.noPopNear') };
  // Base militaire à portée : +20 % de force par base (cumul plafonné)
  const nBases = Math.min(CONFIG.military.maxAttackBases, basesInRange(player.id, dstCell));
  const force = drawn * (1 + CONFIG.military.attackBonus * nBases);

  player.money -= CONFIG.combat.attackCost;
  if (total > 0)
    for (const c of myCells) c.pop -= c.pop / total * drawn; // le bonus de base est « gratuit »

  // Renfort sur une de mes attaques déjà en cours
  if (dstCell.contest && dstCell.contest.attacker === player.id) {
    dstCell.contest.force += force;
    return { ok: true };
  }

  // Choc frontal : un ennemi attaque déjà un de mes territoires contigus —
  // les deux forces s'annulent, le surplus éventuel contre-attaque
  for (const n of cellNeighbors(dstCell)) {
    if (n.owner === player.id && n.contest && n.contest.attacker === dstCell.owner) {
      if (force > n.contest.force) {
        const leftover = force - n.contest.force;
        n.contest = null; // attaque ennemie anéantie (mon territoire garde ses dégâts)
        dstCell.contest = makeContest(player.id, dstCell, leftover, n);
        const c = cellCentroid(dstCell);
        spawnBurst(c.x, c.y, player.color, 14);
      } else {
        n.contest.force -= force; // mes troupes anéanties, attaque ennemie réduite
        const c = cellCentroid(n);
        spawnBurst(c.x, c.y, G.players[dstCell.owner].color, 10);
      }
      return { ok: true, clash: true };
    }
  }

  // Provenance visuelle : un de mes territoires adjacents à la cible
  const src = cellNeighbors(dstCell).find(n => n.owner === player.id) || null;
  dstCell.contest = makeContest(player.id, dstCell, force, src);
  return { ok: true };
}

// --- Emplacement conseillé pour un bâtiment -------------------------------
// Construire sans viser : le jeu propose le territoire libre le plus adapté.
//  - industries, villes, ports, centres de colonisation : à l'abri, loin du front ;
//  - silos : à l'abri, et groupés avec les autres silos (salves cohérentes) ;
//  - bases militaires : près du front, sans être en première ligne ;
//  - boucliers : là où ils couvrent le plus de bâtiments encore non protégés ;
//  - défenses anti-aériennes : réparties sur la planète, loin des autres DAA.
function suggestBuildCell(pid, planet, type) {
  const C = planet.cells[0], n = planet.sectors;
  const free = C.filter(c => c.owner === pid && !c.building && !c.contest && !c.destroyed);
  if (!free.length) return null;
  const others = C.filter(c => !c.destroyed && c.owner !== pid);
  const enemies = others.filter(c => c.owner !== null && isHostile(pid, c.owner));
  const front = enemies.length ? enemies : others; // sans ennemi : les neutres
  const dist = (a, b) => { const d = Math.abs(a.sector - b.sector) % n; return Math.min(d, n - d); };
  const nearest = (c, list) => list.reduce((m, o) => Math.min(m, dist(c, o)), n);
  const mine = C.filter(c => c.owner === pid && !c.destroyed);
  const same = mine.filter(c => c.building === type);
  let best = null, bestScore = -Infinity;
  for (const c of free) {
    const safe = front.length ? nearest(c, front) : n / 2; // éloignement du front (en territoires)
    let score;
    switch (type) {
      case 'military':
        score = -Math.abs(safe - 3) * 10 + (enemies.length ? 0 : -safe);
        break;
      case 'silo':
        score = Math.min(safe, 12) * 4 - (same.length ? nearest(c, same) : 0) * 2;
        break;
      case 'shield': {
        const R = CONFIG.shield.arcSectors;
        const covered = o => same.some(sh => dist(sh, o) <= R);
        score = mine.filter(o => o.building && o.building !== 'shield' && dist(o, c) <= R && !covered(o)).length * 20 + Math.min(safe, 8);
        break;
      }
      case 'aa':
        score = (same.length ? nearest(c, same) : n / 2) * 3 + Math.min(safe, 6);
        break;
      default: // city, industry, tradeport, colony, spaceport
        score = safe * 4 + (type === 'city' ? c.pop / 20 : 0);
    }
    if (safe <= 1 && type !== 'military') score -= 50; // jamais en première ligne
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Construire un bâtiment sur un territoire possédé
function buildOn(player, cell, type) {
  if (type === 'spaceport' && !CONFIG.features.fleets) return { ok: false, msg: T('err.fleetsOff') };
  if (cell.owner !== player.id) return { ok: false, msg: T('err.notOwned') };
  if (cell.building) return { ok: false, msg: T('err.hasBuilding') };
  if (cell.contest) return { ok: false, msg: T('err.inCombat') };
  // Coût progressif : ×1,10 par bâtiment du même type déjà posé sur la planète
  const cost = buildingCost(cell.planet, type);
  if (player.money < cost) return { ok: false, msg: T('err.noMoney') };
  player.money -= cost;
  cell.building = type;
  const pl = cell.planet;
  pl.buildCounts[type] = (pl.buildCounts[type] || 0) + 1;
  cell.bhp = undefined; // points de vie pleins (tirs de vaisseaux)
  if (type === 'silo') cell.missiles = CONFIG.silo.capacity;
  if (type === 'tradeport') {
    pl.tradeT = 0; // le cycle de 30 s démarre à la construction…
    spawnCargo(pl); // …et un premier cargo part tout de suite
  }
  const c = cellCentroid(cell);
  spawnBurst(c.x, c.y, player.color, 6);
  return { ok: true };
}

// --- Missiles balistiques ---------------------------------------

// Silos chargés d'un joueur sur une planète
function loadedSilos(playerId, planet) {
  const out = [];
  for (const c of planetCells(planet))
    if (c.owner === playerId && c.building === 'silo' && (c.missiles || 0) > 0) out.push(c);
  return out;
}

// Vitesse orbitale instantanée d'une planète (pour l'hériter au lancement)
function planetVelocity(p) {
  const v = p.orbitSpeed * p.orbitRadius;
  return { x: -Math.sin(p.orbitAngle) * v, y: Math.cos(p.orbitAngle) * v };
}

// Tir groupé : un missile part de chaque silo disponible (jusqu'à `count`),
// monte en orbite puis part vers la cible, trajectoire courbée par la gravité
// Salve de missiles : les silos tournés vers la cible tirent en premier, et
// chaque missile vise son propre point. Le motif des impacts reproduit la
// disposition des silos (décalage de chaque silo par rapport au centre de la
// salve) : un tir groupé fait un barrage, pas une file indienne.
function missileVolley(playerId, planet, count, target) {
  const dirOf = s => planet.rotation + (s.sector + 0.5) * planet.sectorAngle;
  const aim = Math.atan2(target.y - planet.y, target.x - planet.x);
  const silos = loadedSilos(playerId, planet)
    .sort((a, b) => Math.abs(angleDiff(dirOf(a), aim)) - Math.abs(angleDiff(dirOf(b), aim)))
    .slice(0, Math.max(0, count));
  if (!silos.length) return [];
  const pos = silos.map(s => {
    const a = dirOf(s), r = s.rTop ?? planet.radius;
    return { x: planet.x + Math.cos(a) * r, y: planet.y + Math.sin(a) * r };
  });
  const cx = pos.reduce((t, p) => t + p.x, 0) / pos.length;
  const cy = pos.reduce((t, p) => t + p.y, 0) / pos.length;
  return silos.map((silo, i) => ({ silo, target: { x: target.x + pos[i].x - cx, y: target.y + pos[i].y - cy } }));
}

function launchMissiles(player, planet, count, target) {
  // Chaque missile coûte CONFIG.missiles.launchCost : la salve est limitée
  // à ce que le joueur peut payer
  const unit = CONFIG.missiles.launchCost;
  const affordable = Math.floor(player.money / unit);
  if (affordable < 1 && loadedSilos(player.id, planet).length) return { ok: false, msg: T('err.missileFunds', { n: unit }) };
  const volley = missileVolley(player.id, planet, Math.min(count, affordable), target);
  const n = volley.length;
  if (n === 0) return { ok: false, msg: T('err.noMissile') };
  player.money -= unit * n;

  // Chaque missile corrige son cap vers SON point quoi qu'il arrive (pas de
  // suivi des planètes)
  for (const shot of volley) {
    const silo = shot.silo;
    silo.missiles--;
    silo.reloadT = 0;
    const midA = planet.rotation + (silo.sector + 0.5) * planet.sectorAngle;
    const out = { x: Math.cos(midA), y: Math.sin(midA) };
    const r0 = planet.radius + 1;
    // Direction initiale = axe du silo, purement radiale (pas d'héritage de
    // la vitesse orbitale : le missile monte droit hors du puits de gravité)
    G.missiles.push({
      id: nextEntityId(),
      x: planet.x + out.x * r0, y: planet.y + out.y * r0,
      vx: out.x * CONFIG.missiles.riseSpeed,
      vy: out.y * CONFIG.missiles.riseSpeed,
      out, state: 'rise', riseT: 0, life: 0, flightT: 0, passed: false,
      target: { x: shot.target.x, y: shot.target.y },
      home: planet, owner: player.id, color: player.color,
      trail: [],
    });
    spawnBurst(planet.x + out.x * r0, planet.y + out.y * r0, '#ffffff', 5);
  }
  return { ok: true, launched: n };
}

function updateMissiles(dt) {
  const M = CONFIG.missiles;
  for (let i = G.missiles.length - 1; i >= 0; i--) {
    const m = G.missiles[i];
    m.life += dt;
    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 26) m.trail.shift();

    if (m.state === 'rise') {
      // Montée verticale hors de l'atmosphère : cap = axe du silo, sans
      // gravité ni héritage orbital ; le guidage vers la cible vient après
      m.riseT += dt;
      m.vx = m.out.x * M.riseSpeed;
      m.vy = m.out.y * M.riseSpeed;
      if (m.riseT >= M.riseTime) {
        // Fin de montée : pas de changement brutal de cap — le missile
        // garde sa vitesse actuelle, puis accélère et courbe progressivement
        // vers le point visé (virage limité, cf. branche flight)
        m.state = 'flight';
        m.flightT = 0;
      }
    } else {
      m.flightT += dt;

      // Poussée progressive jusqu'à la vitesse de croisière
      const sp0 = Math.hypot(m.vx, m.vy);
      if (sp0 > 0.001 && sp0 < M.flightSpeed) {
        const ns = Math.min(M.flightSpeed, sp0 + M.thrustAccel * dt);
        m.vx *= ns / sp0;
        m.vy *= ns / sp0;
      }

      // Correction de cap vers le point visé (virage limité) — la gravité
      // s'y oppose et courbe la trajectoire. Une fois le point atteint ou
      // dépassé, la correction cesse définitivement : le missile poursuit
      // sa course (sinon il se mettrait à tourner en rond autour du point).
      if (!m.passed) {
        const dtx = m.target.x - m.x, dty = m.target.y - m.y;
        const dist2 = dtx * dtx + dty * dty;
        const movingAway = (dtx * m.vx + dty * m.vy) < 0;
        // Arrêt de la correction uniquement sur point atteint (25 u) ou
        // frôlé de près (< 150 u) : sinon le missile tournerait en rond.
        // Tant que la cible est loin, on continue de viser même si le
        // missile s'en écarte momentanément (sortie d'orbite, gravité).
        if (dist2 < 625 || (movingAway && dist2 < 150 * 150)) {
          m.passed = true;
        } else {
          const desired = Math.atan2(dty, dtx);
          const cur = Math.atan2(m.vy, m.vx);
          let diff = desired - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = Math.max(-M.homingTurn * dt, Math.min(M.homingTurn * dt, diff));
          const sp = Math.hypot(m.vx, m.vy);
          const na = cur + turn;
          m.vx = Math.cos(na) * sp;
          m.vy = Math.sin(na) * sp;
        }
      }

      // Gravité du soleil et des planètes
      let ax = 0, ay = 0;
      {
        const dx = -m.x, dy = -m.y;
        const r2 = dx * dx + dy * dy + M.softening;
        const inv = M.gravSun / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv;
      }
      for (const p of G.planets) {
        const dx = p.x - m.x, dy = p.y - m.y;
        const r2 = dx * dx + dy * dy + M.softening;
        const mass = (p.radius / 36) * (p.radius / 36);
        const inv = M.gravPlanet * mass / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv;
      }
      m.vx += ax * dt; m.vy += ay * dt;
    }

    m.x += m.vx * dt;
    m.y += m.vy * dt;

    // Collision avec le soleil
    if (Math.hypot(m.x, m.y) < CONFIG.system.sunRadius * 0.8) {
      spawnBurst(m.x, m.y, '#FFE499', 10);
      G.missiles.splice(i, 1);
      continue;
    }

    // Vaisseaux : un missile qui touche un vaisseau ennemi explose, et le
    // souffle détruit jusqu'à 3 vaisseaux ennemis
    if (m.state === 'flight' && missileHitsShip(m)) {
      blastShips(m.x, m.y, m.owner);
      spawnBurst(m.x, m.y, '#ffb14e', 16);
      spawnBurst(m.x, m.y, '#5a5a68', 8);
      G.missiles.splice(i, 1);
      continue;
    }

    // Boucliers : tout missile (tous camps) qui entre dans le disque d'un
    // bouclier explose au contact. Si l'explosion a lieu très près de la
    // surface, elle endommage quand même la planète (tir rasant sur le
    // flanc du bouclier). La planète d'origine est ignorée au départ.
    if (m.state === 'flight') {
      let shieldedOn = null;
      for (const p of G.planets) {
        if (p === m.home && m.flightT < 5) continue;
        for (const cell of p.cells[0]) {
          if (cell.destroyed || cell.building !== 'shield' || cell.shieldDown > 0) continue;
          const f = shieldFrame(cell);
          if (Math.hypot(m.x - f.x, m.y - f.y) < f.r) {
            shieldedOn = p;
            cell.shieldDown = CONFIG.shield.downTime; // touché : désactivé 12 s
            break;
          }
        }
        if (shieldedOn) break;
      }
      if (shieldedOn) {
        const d = Math.hypot(m.x - shieldedOn.x, m.y - shieldedOn.y);
        if (d < shieldedOn.radius + CONFIG.missiles.craterRadius * CONFIG.shield.grazeDepth) {
          missileImpact(m, shieldedOn); // explosion contre la surface : dégâts
        } else {
          spawnBurst(m.x, m.y, '#7ec8ff', 18); // explosion contre le bouclier
          spawnBurst(m.x, m.y, '#5a5a68', 8);
        }
        G.missiles.splice(i, 1);
        continue;
      }
    }

    // Collision avec une planète (après la montée) → cratère
    // (la planète d'origine est ignorée pendant 2 s de vol : les silos
    // en face cachée contournent la planète au départ)
    if (m.state === 'flight') {
      let hit = null;
      for (const p of G.planets) {
        if (p === m.home && m.flightT < 5) continue;
        if (Math.hypot(m.x - p.x, m.y - p.y) < p.radius - p.band * 0.4) { hit = p; break; }
      }
      if (hit) {
        missileImpact(m, hit);
        G.missiles.splice(i, 1);
        continue;
      }
    }

    if (m.life > M.maxLife) { // perdus dans l'espace
      spawnBurst(m.x, m.y, m.color, 4);
      G.missiles.splice(i, 1);
    }
  }
}

// Impact : explosion circulaire invisible centrée sur le point d'impact.
// Le cratère est mémorisé, puis la surface de la planète est remodelée :
// les territoires creusés sont reposés sur le bord du cratère (même taille,
// même forme), les secteurs trop profondément excavés disparaissent.
// Le rayon est paramétrable (explosions plus grandes à venir).
function missileImpact(m, planet, radius) {
  spawnBurst(m.x, m.y, '#ffb14e', 22);
  spawnBurst(m.x, m.y, '#5a5a68', 12);
  blastShips(m.x, m.y, m.owner); // flotte en orbite basse prise dans le souffle
  const r = radius ?? CONFIG.missiles.craterRadius;

  // Le cratère est mémorisé en coordonnées relatives (il tourne avec la planète)
  const ang = normAngle(Math.atan2(m.y - planet.y, m.x - planet.x) - planet.rotation);
  const dist = Math.hypot(m.x - planet.x, m.y - planet.y);
  planet.craters.push({ ang, dist, r });
  // Cap très large : au-delà, les plus vieilles morsures "guérissent"
  // visuellement (les territoires détruits, eux, ne reviennent jamais)
  if (planet.craters.length > 400) planet.craters.shift();

  // Trahison par missile : un impact qui touche un territoire allié rompt
  // l'alliance (le tireur devient traître)
  const before = planet.cells[0].map(c => c.destroyed ? null : c.owner);
  reshapePlanet(planet);
  const hit = new Set();
  planet.cells[0].forEach((c, k) => {
    const was = before[k];
    if (was !== null && (c.destroyed || c.owner !== was) && areAllied(m.owner, was)) hit.add(was);
  });
  for (const victim of hit) betrayAlliance(m.owner, victim, 'missile');
}

// --- Résolution des combats (grignotage + cascade) -------------
function resolveContests(dt) {
  const C = CONFIG.combat;
  for (const p of G.planets) {
    for (const cell of planetCells(p)) {
      const contest = cell.contest;
      if (!contest) continue;

      // Étincelles du combat en cours (couleurs des deux camps)
      if (Math.random() < dt * 7) spawnSpark(cell);

      // L'attaque grignote la défense — dégât minimal garanti
      const chip = Math.max(C.minChip, contest.force * C.chipRatio) * dt;
      contest.defense -= chip;
      // La défense use l'attaque en retour
      contest.force -= Math.max(0.5, contest.defense * C.defAttrition) * dt;

      if (contest.defense <= 0) {
        conquerCell(cell, contest);
      } else if (contest.force <= 0) {
        // Attaque repoussée : les dégâts infligés persistent
        // (un territoire neutre récupère sa résistance intacte)
        if (cell.owner !== null)
          cell.pop = Math.max(1, (contest.defense - contest.bonus) * (contest.scale || 1));
        cell.contest = null;
      }
    }
  }
}

function conquerCell(cell, contest) {
  const C = CONFIG.combat;
  const attacker = G.players[contest.attacker];
  if (!attacker || !attacker.alive) { cell.contest = null; cell.pop = Math.max(1, cell.pop); return; }

  const leftover = Math.max(0, contest.force);
  cell.owner = attacker.id;
  cell.contest = null;

  const c = cellCentroid(cell);
  spawnBurst(c.x, c.y, attacker.color, 6, 0.5); // effet discret (2× plus petit)

  // Le potentiel restant : une part reste en garnison, le reste cascade
  let cascadeForce = 0;
  if (leftover * (1 - C.garrisonShare) >= C.cascadeMinForce) {
    cascadeForce = leftover * (1 - C.garrisonShare);
    cell.pop = leftover * C.garrisonShare;
  } else {
    cell.pop = leftover;
  }

  if (cascadeForce > 0) {
    // Cherche le territoire adjacent le plus faible (ennemi ou neutre)
    let best = null;
    for (const n of cellNeighbors(cell)) {
      if (n.destroyed) continue;
      if (n.owner !== attacker.id && !n.contest && !areAllied(attacker.id, n.owner)) {
        const resist = n.owner !== null ? n.pop : CONFIG.combat.neutralDefense;
        const bestResist = best && best.owner !== null ? best.pop
          : (best ? CONFIG.combat.neutralDefense : Infinity);
        if (resist < bestResist) best = n;
      }
    }
    if (best) {
      best.contest = makeContest(attacker.id, best, cascadeForce, cell);
    } else {
      cell.pop += cascadeForce; // pas de suite possible : la force se replie
    }
  }
}

// --- Boucle de jeu ----------------------------------------------
// --- Modules de colonisation -------------------------------------------
// Lancés depuis un centre de colonisation, vers une planète uniquement.
// Plus lents que les missiles, ils suivent leur cible pendant tout le vol
// et traversent les boucliers (ils transportent des troupes, pas une
// charge explosive). À l'atterrissage : conquête du territoire touché +
// attaque des 2 territoires adjacents ; chez soi, simple renfort.

function colonyCenters(playerId, planet) {
  return planetCells(planet).filter(c =>
    !c.destroyed && c.owner === playerId && c.building === 'colony');
}

function launchColonyModule(player, planet, share, targetPlanet, targetAng = null) {
  const C = CONFIG.colony;
  if (!targetPlanet) return { ok: false, msg: T('err.modulePlanet') };
  const centers = colonyCenters(player.id, planet);
  if (centers.length === 0) return { ok: false, msg: T('err.noColonyCenter') };

  const owned = planetCells(planet).filter(c => !c.destroyed && c.owner === player.id);
  const total = owned.reduce((s, c) => s + c.pop, 0);
  const colonists = Math.floor(total * share);
  if (colonists < C.minColonists) {
    return { ok: false, msg: T('err.fewColonists', { n: C.minColonists }) };
  }
  if (player.money < C.launchCost) return { ok: false, msg: T('err.colonyFunds', { n: C.launchCost }) };
  player.money -= C.launchCost;

  // Prélèvement proportionnel sur les territoires du joueur
  let left = colonists;
  for (const c of owned) {
    const take = Math.min(c.pop, colonists * (total > 0 ? c.pop / total : 0));
    c.pop -= take; left -= take;
  }
  let guard = 200; // arrondis : prélève le reliquat où il reste de la pop
  while (left > 0.5 && guard-- > 0) {
    const c = owned.find(o => o.pop >= left);
    if (!c) break;
    c.pop -= left; left = 0;
  }

  // Départ radial le long de l'axe du centre (comme les missiles)
  const center = centers[0];
  const midA = planet.rotation + (center.sector + 0.5) * planet.sectorAngle;
  const out = { x: Math.cos(midA), y: Math.sin(midA) };
  const r0 = planet.radius + 1;
  G.modules.push({
    id: nextEntityId(),
    x: planet.x + out.x * r0, y: planet.y + out.y * r0,
    vx: out.x * CONFIG.missiles.riseSpeed,
    vy: out.y * CONFIG.missiles.riseSpeed,
    out, state: 'rise', riseT: 0, life: 0, flightT: 0,
    targetPlanet, targetAng, home: planet, owner: player.id, color: player.color,
    colonists, trail: [],
  });
  spawnBurst(planet.x + out.x * r0, planet.y + out.y * r0, '#ffffff', 5);
  return { ok: true, colonists };
}

// Territoire d'atterrissage : la cellule touchée, ou la plus proche
// cellule intacte du même anneau si le cratère l'a détruite.
function nearestLandableCell(planet, wx, wy, ring) {
  const ang = Math.atan2(wy - planet.y, wx - planet.x) - planet.rotation;
  const s0 = ((Math.round(ang / planet.sectorAngle - 0.5) % planet.sectors) + planet.sectors) % planet.sectors;
  const r = Math.max(0, Math.min(planet.rings - 1, ring));
  for (let off = 0; off < planet.sectors; off++) {
    for (const s of [(s0 + off) % planet.sectors, (s0 - off + planet.sectors) % planet.sectors]) {
      const c = planet.cells[r][s];
      if (c && !c.destroyed) return c;
    }
  }
  return null;
}

function landModule(m, planet) {
  const C = CONFIG.colony;
  const attacker = G.players[m.owner];
  let cell = cellAt(planet, m.x, m.y);
  if (!cell || cell.destroyed) {
    cell = nearestLandableCell(planet, m.x, m.y, cell ? cell.ring : 0);
  }
  // Pas d'atterrissage sur un territoire allié : on se pose sur le
  // territoire non allié le plus proche le long de la couronne
  if (cell && attacker && areAllied(attacker.id, cell.owner)) {
    let best = null;
    for (let off = 1; off < planet.sectors && !best; off++) {
      for (const s of [(cell.sector + off) % planet.sectors, (cell.sector - off + planet.sectors) % planet.sectors]) {
        const c = planet.cells[0][s];
        if (c && !c.destroyed && !areAllied(attacker.id, c.owner)) { best = c; break; }
      }
    }
    cell = best;
  }
  if (!cell || !attacker || !attacker.alive) {
    spawnBurst(m.x, m.y, '#8a8a96', 8);
    return;
  }

  const P = m.colonists;
  spawnBurst(m.x, m.y, attacker.color, 16, 1.3);

  // Atterrissage chez soi : simple renfort — la surpopulation est permise,
  // mais une fois repassée sous le cap naturel elle ne le redépassera plus
  // (la croissance s'arrête au cap, cf. cellPopGrowth).
  if (cell.owner === attacker.id) {
    cell.pop += P;
    notify(attacker.id, T('msg.colonistsJoined', { n: Math.round(P), planet: planet.name }), true);
    return;
  }

  // Atterrissage hostile : conquête automatique du territoire touché…
  cell.owner = attacker.id;
  cell.contest = null;
  cell.pop = P; // peut dépasser le cap : la pop s'épuisera dans les combats
  notify(attacker.id, T('msg.moduleLanded', { planet: planet.name }), true);
  const witnesses = new Set();
  for (const c of planetCells(planet)) if (!c.destroyed && c.owner !== null && c.owner !== attacker.id) witnesses.add(c.owner);
  for (const id of witnesses) notify(id, T('msg.enemyLanded', { planet: planet.name }));

  // …puis attaque des 2 territoires adjacents (même anneau) avec la
  // population du module : le défenseur peut contre-attaquer normalement.
  const ring = planet.cells[cell.ring];
  for (const ds of [-1, 1]) {
    const n = ring[(cell.sector + ds + ring.length) % ring.length];
    if (!n || n.destroyed || n.owner === attacker.id || n.contest || areAllied(attacker.id, n.owner)) continue;
    const force = Math.min(cell.pop, P * C.attackShare);
    if (force < CONFIG.combat.minAttackForce) continue;
    cell.pop -= force;
    n.contest = makeContest(attacker.id, n, force, cell);
  }
}

// Point de passage pour éviter le soleil : null si le segment A→B passe
// assez loin de l'étoile (centre du système en 0,0)
function sunDetour(ax, ay, bx, by) {
  const safe = CONFIG.system.sunRadius * 2.4;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  if (L2 < 1) return null;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
  const qx = ax + dx * t, qy = ay + dy * t;
  const q = Math.hypot(qx, qy);
  if (q >= safe || t <= 0 || t >= 1) return null;
  // Écarter le point le plus proche du soleil jusqu'au rayon de sécurité
  let ux = qx / (q || 1), uy = qy / (q || 1);
  if (q < 1e-3) { ux = -dy / Math.sqrt(L2); uy = dx / Math.sqrt(L2); }
  return { x: ux * safe * 1.15, y: uy * safe * 1.15 };
}

// Écart angulaire signé dans [-π, π]
function angleDiff(a, b) {
  return ((a - b + Math.PI) % TAU() + TAU()) % TAU() - Math.PI;
}

// Point que vise un module de colonisation vers un point choisi de la
// planète : contournement par une orbite basse si le point est loin,
// puis approche à la verticale du point et descente
function colonyAimPoint(m, p) {
  const C = CONFIG.colony;
  const spotA = p.rotation + m.targetAng;
  const modA = Math.atan2(m.y - p.y, m.x - p.x);
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  const diff = angleDiff(spotA, modA);
  const R = p.radius;
  if (Math.abs(diff) < 0.3) {
    // Au-dessus du point : descente
    const hover = d > R + C.approachAlt + 8 ? R + C.approachAlt : R - p.band;
    return { x: p.x + Math.cos(spotA) * hover, y: p.y + Math.sin(spotA) * hover };
  }
  if (d > R * 3 + 80) {
    // Encore loin : viser le point d'approche au-dessus de la cible
    const a = R + C.approachAlt;
    return { x: p.x + Math.cos(spotA) * a, y: p.y + Math.sin(spotA) * a };
  }
  // Proche : glisser le long d'une orbite basse vers le point
  const step = Math.max(-0.8, Math.min(0.8, diff));
  const a = modA + step, r = R + C.approachAlt;
  return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
}

function updateModules(dt) {
  const C = CONFIG.colony;
  const M = CONFIG.missiles;
  for (let i = G.modules.length - 1; i >= 0; i--) {
    const m = G.modules[i];
    m.life += dt;
    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 30) m.trail.shift();

    if (m.state === 'rise') {
      m.riseT += dt;
      m.vx = m.out.x * M.riseSpeed;
      m.vy = m.out.y * M.riseSpeed;
      if (m.riseT >= M.riseTime) { m.state = 'flight'; m.flightT = 0; }
    } else {
      m.flightT += dt;

      // Poussée progressive jusqu'à la vitesse de croisière
      const sp0 = Math.hypot(m.vx, m.vy);
      if (sp0 > 0.001 && sp0 < C.speed) {
        const ns = Math.min(C.speed, sp0 + C.accel * dt);
        m.vx *= ns / sp0;
        m.vy *= ns / sp0;
      }

      // Suivi continu de la planète cible (contrairement aux missiles qui
      // visent un point fixe, le module corrige son cap jusqu'à l'impact).
      // Avec un point d'atterrissage choisi (m.targetAng, repère planète) :
      // approche par le bon côté, contournement de la planète par une orbite
      // basse si besoin, puis descente sur le point visé.
      const tp = m.targetPlanet;
      if (tp) {
        let gx = tp.x, gy = tp.y;
        const pv = planetVelocity(tp);
        if (m.targetAng !== undefined && m.targetAng !== null) {
          const aim = colonyAimPoint(m, tp);
          gx = aim.x; gy = aim.y;
          // Rester au contact d'une planète rapide pendant le contournement
          const need = Math.hypot(pv.x, pv.y) * 1.25 + 10;
          const spN = Math.hypot(m.vx, m.vy);
          if (spN > 0.001 && spN < need) { m.vx *= need / spN; m.vy *= need / spN; }
        }
        const tgo = Math.min(3, Math.hypot(gx - m.x, gy - m.y) / Math.max(40, Math.hypot(m.vx, m.vy)));
        gx += pv.x * tgo; gy += pv.y * tgo;
        // Contournement du soleil : si la route le traverse, viser un point
        // de passage écarté de l'étoile
        const wp = sunDetour(m.x, m.y, gx, gy);
        if (wp) { gx = wp.x; gy = wp.y; }
        const desired = Math.atan2(gy - m.y, gx - m.x);
        const cur = Math.atan2(m.vy, m.vx);
        let diff = desired - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const tr = m.targetAng !== undefined && m.targetAng !== null ? C.turn * 1.8 : C.turn; // manœuvre d'approche plus serrée
        const turn = Math.max(-tr * dt, Math.min(tr * dt, diff));
        const sp = Math.hypot(m.vx, m.vy);
        const na = cur + turn;
        m.vx = Math.cos(na) * sp;
        m.vy = Math.sin(na) * sp;
      }

      // Gravité du soleil et des planètes (identique aux missiles)
      let ax = 0, ay = 0;
      {
        const dx = -m.x, dy = -m.y;
        const r2 = dx * dx + dy * dy + M.softening;
        const inv = M.gravSun / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv;
      }
      for (const p of G.planets) {
        const dx = p.x - m.x, dy = p.y - m.y;
        const r2 = dx * dx + dy * dy + M.softening;
        const mass = (p.radius / 36) * (p.radius / 36);
        const inv = M.gravPlanet * mass / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv;
      }
      m.vx += ax * dt; m.vy += ay * dt;
    }

    m.x += m.vx * dt;
    m.y += m.vy * dt;

    // Collision avec le soleil
    if (Math.hypot(m.x, m.y) < CONFIG.system.sunRadius * 0.8) {
      spawnBurst(m.x, m.y, '#FFE499', 10);
      G.modules.splice(i, 1);
      continue;
    }

    // Atterrissage sur une planète (les boucliers ne bloquent pas les
    // modules : ils transportent des troupes, pas une charge explosive).
    // La planète d'origine est ignorée au départ comme pour les missiles.
    if (m.state === 'flight') {
      let hit = null;
      for (const p of G.planets) {
        if (p === m.home && m.flightT < 5) continue;
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        // Planète cible avec point visé : on ne se pose que près du point ;
        // ailleurs, le module rebondit sur l'atmosphère et poursuit son approche
        if (p === m.targetPlanet && m.targetAng !== undefined && m.targetAng !== null && d < p.radius + 6) {
          const off = Math.abs(angleDiff(Math.atan2(m.y - p.y, m.x - p.x), p.rotation + m.targetAng));
          if (off > CONFIG.colony.landArc) {
            const ux = (m.x - p.x) / d, uy = (m.y - p.y) / d;
            const pv = planetVelocity(p);
            const vr = (m.vx - pv.x) * ux + (m.vy - pv.y) * uy;
            if (vr < 0) { m.vx -= vr * ux * 1.6; m.vy -= vr * uy * 1.6; }
            m.x = p.x + ux * (p.radius + 6); m.y = p.y + uy * (p.radius + 6);
            continue;
          }
        }
        // Un module qui a une cible ne se pose pas sur une autre planète croisée en route
        if (m.targetAng !== undefined && m.targetAng !== null && p !== m.targetPlanet) continue;
        if (d < p.radius - p.band * 0.4) { hit = p; break; }
      }
      if (hit) {
        landModule(m, hit);
        G.modules.splice(i, 1);
        continue;
      }
    }

    if (m.life > C.maxLife) { // perdus dans l'espace
      spawnBurst(m.x, m.y, m.color, 4);
      G.modules.splice(i, 1);
    }
  }
}

// --- Cargos de commerce ---------------------------------------------------
// Lancés par les ports de commerce vers une ville d'une planète aléatoire.
// À l'arrivée, le voyage rapporte un revenu important à l'expéditeur ET au
// propriétaire de la ville de destination. Comme les modules de colons, les
// cargos suivent leur cible et traversent les boucliers.

function tradePorts(planet) {
  return planetCells(planet).filter(c =>
    !c.destroyed && c.building === 'tradeport' && c.owner !== null);
}

// Destination d'un cargo : un AUTRE marché (port de commerce) de la partie,
// de préférence sur une autre planète. S'il n'existe aucun autre port, le
// cargo livre une ville et les gains sont divisés par 2.
function pickCargoDest(fromPort) {
  const alive = c => !c.destroyed && c.owner !== null && G.players[c.owner] && G.players[c.owner].alive;
  const ports = [], cities = [];
  for (const p of G.planets) for (const c of planetCells(p)) {
    if (!alive(c)) continue;
    if (c.building === 'tradeport' && c !== fromPort) ports.push(c);
    else if (c.building === 'city') cities.push(c);
  }
  const prefer = list => {
    const away = list.filter(c => c.planet !== fromPort.planet);
    const pool = away.length ? away : list;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  };
  const market = prefer(ports);
  if (market) return { dest: market, mode: 'market' };
  const city = prefer(cities);
  return city ? { dest: city, mode: 'city' } : null;
}

// La destination est-elle toujours valable (même type de bâtiment) ?
function cargoDestValid(m) {
  const d = m.dest;
  return d && !d.destroyed && d.owner !== null &&
    d.building === (m.mode === 'market' ? 'tradeport' : 'city');
}

// Un joueur peut-il abattre ce cargo ? Oui, sauf s'il en est l'expéditeur
// ou s'il est le destinataire (le cargo vient commercer avec lui).
function cargoHostileTo(m, playerId) {
  if (!isHostile(m.owner, playerId)) return false;           // à nous ou à un allié
  return !(m.dest && !isHostile(m.dest.owner, playerId));    // vient commercer chez nous ou un allié
}

function spawnCargo(planet) {
  const port = tradePorts(planet).find(c => {
    const pl = G.players[c.owner];
    return pl && pl.alive;
  });
  if (!port) return false;
  const pick = pickCargoDest(port);
  if (!pick) return false;

  const owner = G.players[port.owner];
  const midA = planet.rotation + (port.sector + 0.5) * planet.sectorAngle;
  const out = { x: Math.cos(midA), y: Math.sin(midA) };
  const r0 = planet.radius + 1;
  G.cargos.push({
    id: nextEntityId(),
    x: planet.x + out.x * r0, y: planet.y + out.y * r0,
    vx: 0, vy: 0,
    out, state: 'rise', life: 0, flightT: 0,
    home: planet, dest: pick.dest, mode: pick.mode, owner: port.owner, color: owner.color,
    trail: [],
  });
  return true;
}

// Cargo abattu (DAA ou vaisseau d'un tiers)
function shootDownCargo(m) {
  const i = G.cargos.indexOf(m);
  if (i < 0) return;
  G.cargos.splice(i, 1);
  spawnBurst(m.x, m.y, '#f5c542', 8, 0.7);
  spawnBurst(m.x, m.y, '#ffb347', 6, 0.6);
  notify(m.owner, T('msg.cargoDown'));
}

// Distance d'un point au segment [A, B]
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

function cargoLost(m, i, color) {
  spawnBurst(m.x, m.y, color || '#8a8a96', 6);
  G.cargos.splice(i, 1);
}

function updateCargos(dt) {
  const TR = CONFIG.trade;
  const M = CONFIG.missiles;
  for (let i = G.cargos.length - 1; i >= 0; i--) {
    const m = G.cargos[i];
    m.life += dt;
    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 30) m.trail.shift();

    // Destination disparue (détruite, conquise par un neutre…) : nouveau marché
    if (!cargoDestValid(m)) {
      const pick = pickCargoDest({ planet: m.home });
      if (!pick) { cargoLost(m, i); continue; }
      m.dest = pick.dest; m.mode = pick.mode;
    }

    if (m.state === 'rise') {
      // Décollage : montée verticale franche au-dessus du port, en suivant
      // le déplacement de la planète, jusqu'à bonne altitude
      const pv = planetVelocity(m.home);
      m.vx = m.out.x * TR.riseSpeed + pv.x;
      m.vy = m.out.y * TR.riseSpeed + pv.y;
      if (Math.hypot(m.x - m.home.x, m.y - m.home.y) >= m.home.radius + TR.riseAltitude) {
        m.state = 'flight'; m.flightT = 0;
      }
    } else {
      m.flightT += dt;
      const destPl = m.dest.planet;
      const pv = planetVelocity(destPl);
      // Vitesse de croisière : 60 u/s, puis accélération progressive après
      // 40 s de voyage pour rattraper à coup sûr une planète plus rapide
      const voyage = m.life;
      const cruise = TR.speed + Math.max(0, voyage - TR.boostAfter) * TR.boostRate;
      const turnRate = TR.turn * cruise / TR.speed; // rayon de virage constant à haute vitesse

      const sp0 = Math.hypot(m.vx, m.vy);
      if (sp0 < cruise) {
        const ns = Math.min(cruise, sp0 + TR.accel * dt);
        if (sp0 > 0.001) { m.vx *= ns / sp0; m.vy *= ns / sp0; }
        else { m.vx = m.out.x * ns; m.vy = m.out.y * ns; }
      } else if (sp0 > cruise * 1.05) {
        m.vx *= cruise / sp0; m.vy *= cruise / sp0;
      }

      // Visée anticipée : là où sera la destination à l'arrivée
      const c = cellCentroid(m.dest);
      const tgo = Math.min(20, Math.hypot(c.x - m.x, c.y - m.y) / cruise);
      const ax0 = c.x + pv.x * tgo, ay0 = c.y + pv.y * tgo;
      const desired = Math.atan2(ay0 - m.y, ax0 - m.x);
      const cur = Math.atan2(m.vy, m.vx);
      let diff = desired - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
      const sp = Math.hypot(m.vx, m.vy);
      const na = cur + turn;
      m.vx = Math.cos(na) * sp;
      m.vy = Math.sin(na) * sp;

      // Gravité (identique aux missiles et modules)
      let ax = 0, ay = 0;
      {
        const dx = -m.x, dy = -m.y;
        const r2 = dx * dx + dy * dy + M.softening;
        const inv = M.gravSun / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv;
      }
      for (const p of G.planets) {
        const dx = p.x - m.x, dy = p.y - m.y;
        const r2 = dx * dx + dy * dy + M.softening;
        const mass = (p.radius / 36) * (p.radius / 36);
        const inv = M.gravPlanet * mass / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv;
      }
      m.vx += ax * dt; m.vy += ay * dt;
    }

    const px = m.x, py = m.y;
    m.x += m.vx * dt;
    m.y += m.vy * dt;

    // Collision avec le soleil
    if (Math.hypot(m.x, m.y) < CONFIG.system.sunRadius * 0.8) {
      spawnBurst(m.x, m.y, '#FFE499', 8);
      G.cargos.splice(i, 1);
      continue;
    }

    // Arrivée : revenu pour l'expéditeur et le destinataire (propriétaire
    // de la destination AU MOMENT de l'arrivée) ; ÷ 2 en livraison de ville.
    // Test sur le segment parcouru : pas de traversée sans contact à haute vitesse.
    if (m.state === 'flight') {
      const c = cellCentroid(m.dest);
      if (segDist(px, py, m.x, m.y, c.x, c.y) < Math.max(6, m.dest.planet.band)) {
        const k = m.mode === 'city' ? TR.cityShare : 1;
        const gS = Math.round(TR.rewardSender * k);
        // Commerce avec soi-même : seul l'expéditeur est payé
        const gR = m.dest.owner === m.owner ? 0 : Math.round(TR.rewardReceiver * k);
        const sender = G.players[m.owner];
        const receiver = G.players[m.dest.owner];
        if (sender && sender.alive) sender.money += gS;
        if (receiver && receiver.alive) receiver.money += gR;
        spawnBurst(c.x, c.y, '#f5c542', 14, 1.2);
        spawnBurst(c.x, c.y, m.color, 8);
        if (sender && receiver && sender.id === receiver.id) {
          notify(sender.id, T('msg.tradeInner', { n: gS }), true);
        } else {
          if (sender) notify(sender.id, T(m.mode === 'city' ? 'msg.cargoDeliveredCity' : 'msg.cargoDelivered', { n: gS }), true);
          if (receiver) notify(receiver.id, T('msg.cargoReceived', { n: gR }), true);
        }
        G.cargos.splice(i, 1);
        continue;
      }
    }

    if (m.life > TR.maxLife) cargoLost(m, i, m.color); // perdus dans l'espace
  }
}

// Toutes les 10 s, une base tire sur le territoire ennemi le plus éloigné
// à portée (≤ 7 territoires, même planète). L'obus suit un arc au-dessus
// de la surface, en coordonnées planète (il suit la rotation), et tue
// 30 pop à l'impact. Pas de tir ami : un territoire devenu allié ou neutre
// pendant le vol n'est pas touché. Vidé à 0, le territoire redevient
// neutre (bâtiment perdu).
function baseTarget(base, ownerId = base.owner) {
  const M = CONFIG.military;
  let best = null, bestD = -1;
  for (const c of planetCells(base.planet)) {
    if (c.destroyed || c.owner === null || !isHostile(ownerId, c.owner)) continue;
    const d = sectorDistance(c, base);
    if (d <= M.fireRange && d > bestD) { best = c; bestD = d; } // le plus éloigné à portée
  }
  return best;
}

function updateBases(dt) {
  const M = CONFIG.military;
  for (const p of G.planets) {
    for (const cell of planetCells(p)) {
      if (cell.destroyed || cell.owner === null || cell.building !== 'military') continue;
      cell.fireT = Math.min(M.fireInterval, (cell.fireT || 0) + dt);
      if (cell.fireT < M.fireInterval || cell.contest) continue;
      const target = baseTarget(cell);
      if (!target) continue; // prête, attend une cible
      cell.fireT = 0;
      G.shells.push({ id: nextEntityId(), from: cell, to: target, owner: cell.owner,
        a0: cellSectorPos(cell) * p.sectorAngle, a1: cellSectorPos(target) * p.sectorAngle,
        t: 0, trail: [] });
    }
  }
  for (let i = G.shells.length - 1; i >= 0; i--) {
    const sh = G.shells[i];
    sh.t += dt / M.shellFlightTime;
    const pos = shellPos(sh);
    sh.trail.push(pos); if (sh.trail.length > 8) sh.trail.shift();
    if (sh.t < 1) continue;
    G.shells.splice(i, 1);
    const tgt = sh.to;
    const color = G.players[sh.owner] ? G.players[sh.owner].color : '#ffffff';
    spawnBurst(pos.x, pos.y, '#ffb347', 5, 0.45);
    spawnBurst(pos.x, pos.y, color, 3, 0.35);
    if (tgt.destroyed || tgt.owner === null || !isHostile(sh.owner, tgt.owner)) continue; // pas de tir ami ni allié
    tgt.pop -= M.fireDamage;
    if (tgt.contest) tgt.contest.defense = Math.max(0.1, tgt.contest.defense - M.fireDamage);
    if (tgt.pop <= 0) {
      // Territoire anéanti : il redevient neutre
      tgt.owner = null; tgt.pop = 0;
      tgt.building = null; tgt.missiles = undefined;
      if (tgt.contest) {
        tgt.contest.defense = Math.min(tgt.contest.defense, CONFIG.combat.neutralDefense);
        tgt.contest.bonus = 0;
      }
      spawnBurst(pos.x, pos.y, '#8a8a96', 6, 0.5);
    }
  }
}

// --- Défense anti-aérienne ----------------------------------------
// Origine et axe du cône (vers le ciel, à la verticale du territoire)
function aaFrame(cell) {
  const pl = cell.planet;
  if (cell.craterCell) {
    const c = cellCentroid(cell);
    const a = Math.atan2(c.y - pl.y, c.x - pl.x);
    return { x: c.x, y: c.y, angle: a };
  }
  const a = pl.rotation + (cell.sector + 0.5) * pl.sectorAngle;
  const r = cell.rTop ?? pl.radius;
  return { x: pl.x + Math.cos(a) * r, y: pl.y + Math.sin(a) * r, angle: a };
}

// La menace est-elle dans le cône de détection ?
function inAACone(f, x, y) {
  const A = CONFIG.aa;
  const dx = x - f.x, dy = y - f.y;
  const d = Math.hypot(dx, dy);
  if (d > A.range || d < 0.001) return false;
  let da = Math.atan2(dy, dx) - f.angle;
  da = ((da + Math.PI) % TAU() + TAU()) % TAU() - Math.PI;
  return Math.abs(da) <= A.coneHalfAngle * Math.PI / 180;
}

// Impacts encore nécessaires pour abattre une menace
function threatHitsLeft(t) {
  return t.kind === 'module' ? (t.ref.hp ?? CONFIG.aa.moduleHits) : 1;
}

function updateAA(dt) {
  const A = CONFIG.aa;
  // Menaces en vol : missiles et modules de colonisation
  const threats = [];
  for (const m of G.missiles) threats.push({ ref: m, kind: 'missile', owner: m.owner });
  for (const m of G.modules) threats.push({ ref: m, kind: 'module', owner: m.owner });
  for (const f of G.fleets) for (const sh of f.ships) threats.push({ ref: sh, kind: 'ship', owner: f.owner });
  for (const m of G.cargos) threats.push({ ref: m, kind: 'cargo', owner: m.owner });

  for (const p of G.planets) {
    for (const cell of planetCells(p)) {
      if (cell.destroyed || cell.owner === null || cell.building !== 'aa') continue;
      cell.aaT = Math.min(A.fireInterval, (cell.aaT || 0) + dt);
      if (cell.aaT < A.fireInterval || !threats.length) continue;
      const f = aaFrame(cell);
      // Ennemi le plus proche dans le cône, qui n'est pas déjà « couvert »
      // par assez de mini-missiles en route pour l'abattre
      let best = null, bestD = Infinity;
      for (const t of threats) {
        if (!isHostile(t.owner, cell.owner)) continue; // ami ou allié
        if (t.kind === 'cargo' && !cargoHostileTo(t.ref, cell.owner)) continue; // il vient commercer ici
        if ((t.ref.aaIncoming || 0) >= threatHitsLeft(t)) continue;
        if (!inAACone(f, t.ref.x, t.ref.y)) continue;
        const d = Math.hypot(t.ref.x - f.x, t.ref.y - f.y);
        if (d < bestD) { best = t; bestD = d; }
      }
      if (!best) continue;
      cell.aaT = 0;
      best.ref.aaIncoming = (best.ref.aaIncoming || 0) + 1;
      const v = A.interceptorSpeed;
      G.flak.push({ id: nextEntityId(), x: f.x, y: f.y, vx: Math.cos(f.angle) * v, vy: Math.sin(f.angle) * v,
        target: best.ref, kind: best.kind, owner: cell.owner, life: 0, trail: [] });
      spawnBurst(f.x, f.y, '#ffffff', 2, 0.35);
    }
  }

  for (let i = G.flak.length - 1; i >= 0; i--) {
    const fl = G.flak[i];
    fl.life += dt;
    const alive = fl.kind === 'ship' ? !fl.target.dead
      : (fl.kind === 'module' ? G.modules : fl.kind === 'cargo' ? G.cargos : G.missiles).includes(fl.target);
    // Guidage : cap vers la position courante de la cible, virage limité
    if (alive) {
      // Visée anticipée : point où sera la cible au moment de l'impact
      const tg = fl.target;
      const tgo = Math.hypot(tg.x - fl.x, tg.y - fl.y) / A.interceptorSpeed;
      const ax = tg.x + (tg.vx || 0) * tgo, ay = tg.y + (tg.vy || 0) * tgo;
      const want = Math.atan2(ay - fl.y, ax - fl.x);
      let cur = Math.atan2(fl.vy, fl.vx);
      let da = ((want - cur + Math.PI) % TAU() + TAU()) % TAU() - Math.PI;
      cur += Math.max(-A.interceptorTurn * dt, Math.min(A.interceptorTurn * dt, da));
      const sp = Math.min(A.interceptorSpeed, Math.hypot(fl.vx, fl.vy) + A.interceptorSpeed * 3 * dt);
      fl.vx = Math.cos(cur) * sp; fl.vy = Math.sin(cur) * sp;
    }
    fl.x += fl.vx * dt; fl.y += fl.vy * dt;
    fl.trail.push({ x: fl.x, y: fl.y }); if (fl.trail.length > 7) fl.trail.shift();

    if (alive && Math.hypot(fl.target.x - fl.x, fl.target.y - fl.y) < A.hitRadius) {
      const t = fl.target;
      t.aaIncoming = Math.max(0, (t.aaIncoming || 1) - 1);
      G.flak.splice(i, 1);
      if (fl.kind === 'ship') {
        killShip(t, G.players[fl.owner] && G.players[fl.owner].color);
      } else if (fl.kind === 'cargo') {
        shootDownCargo(t);
      } else if (fl.kind === 'module') {
        t.hp = (t.hp ?? A.moduleHits) - 1;
        if (t.hp <= 0) {
          G.modules.splice(G.modules.indexOf(t), 1);
          spawnBurst(t.x, t.y, '#ffb347', 12, 0.8);
          spawnBurst(t.x, t.y, t.color || '#ffffff', 6, 0.6);
          notify(t.owner, T('msg.moduleDown'));
        } else {
          spawnBurst(t.x, t.y, '#ffb347', 5, 0.5); // touché, mais tient encore
        }
      } else {
        G.missiles.splice(G.missiles.indexOf(t), 1);
        spawnBurst(t.x, t.y, '#ffb347', 9, 0.7);
        spawnBurst(t.x, t.y, '#5a5a68', 4, 0.6);
      }
      continue;
    }
    if (fl.life >= A.interceptorLife) {
      if (alive) fl.target.aaIncoming = Math.max(0, (fl.target.aaIncoming || 1) - 1);
      G.flak.splice(i, 1);
      spawnBurst(fl.x, fl.y, '#8a8a96', 3, 0.35); // autodestruction
    }
  }
}

// Position monde d'un obus : interpolation d'angle (plus court chemin)
// et arc radial au-dessus de la surface
function shellPos(sh) {
  const pl = sh.from.planet, M = CONFIG.military;
  const t = Math.min(1, sh.t);
  let da = sh.a1 - sh.a0;
  da = ((da + Math.PI) % TAU() + TAU()) % TAU() - Math.PI;
  const a = pl.rotation + sh.a0 + da * t;
  const r0 = (sh.from.rTop ?? pl.radius), r1 = (sh.to.rTop ?? pl.radius);
  const r = r0 + (r1 - r0) * t + Math.sin(Math.PI * t) * pl.radius * M.shellArc;
  return { x: pl.x + Math.cos(a) * r, y: pl.y + Math.sin(a) * r };
}

function update(dt) {
  G.time += dt;

  // Orbites et rotation des planètes (vinyles)
  for (const p of G.planets) {
    p.orbitAngle += p.orbitSpeed * dt;
    p.rotation += p.spin * dt;
  }
  updatePlanetPositions(G.planets);

  if (G.phase === 'playing') {
    // Économie : revenu de base par territoire + industries
    for (const player of G.players) {
      if (!player.alive) continue;
      const cells = ownedCells(player.id);
      // Revenu proportionnel à la population RÉELLE (pas au plafond) + industries
      let income = 0;
      for (const c of cells) {
        income += c.pop * CONFIG.econ.incomePerPop;
        if (c.building === 'industry') income += CONFIG.econ.industryIncome;
      }
      player.money += income * dt;

      if (cells.length === 0 && player.colonyPlaced) player.alive = false;
    }

    // Croissance de population (suspendue sur un territoire contesté)
    // + rechargement progressif des silos à missiles
    for (const p of G.planets) {
      for (const cell of planetCells(p)) {
        if (cell.owner !== null && cell.building === 'silo' && (cell.missiles || 0) < CONFIG.silo.capacity) {
          cell.reloadT = (cell.reloadT || 0) + dt;
          if (cell.reloadT >= CONFIG.silo.reloadTime) {
            cell.reloadT = 0;
            cell.missiles = (cell.missiles || 0) + 1;
          }
        }
        if (cell.shieldDown > 0) cell.shieldDown = Math.max(0, cell.shieldDown - dt);
        if (cell.owner === null || cell.contest) continue;
        // Sous le plafond : croissance. Au-dessus (colons, garnisons) : la
        // surpopulation se résorbe d'elle-même, vite au début puis de plus
        // en plus lentement — il faut l'utiliser tant qu'elle est là.
        const cap = cellCap(cell);
        if (cell.pop < cap) cell.pop = Math.min(cap, cell.pop + cellPopGrowth(cell) * dt);
        else if (cell.pop > cap) cell.pop = Math.max(cap, cell.pop + cellPopGrowth(cell) * dt);
      }
    }

    // Ports de commerce : un cargo par planète équipée toutes les 30 s
    for (const p of G.planets) {
      if (p.tradeT === undefined) continue; // jamais eu de port construit
      p.tradeT += dt;
      if (p.tradeT >= CONFIG.trade.interval) {
        p.tradeT = 0;
        spawnCargo(p); // sans effet si la planète n'a plus de port
      }
    }

    resolveContests(dt);
    updateMissiles(dt);
    updateModules(dt);
    updateCargos(dt);
    updateBases(dt);
    updateDiplomacy(dt);
    updateFleets(dt);
    updateAA(dt);

    // IA
    for (const player of G.players) {
      if (player.isBot && player.alive) updateBot(player, dt);
    }

    checkVictory();
  }

  updateParticles(dt);
}

// Particules (effets visuels uniquement ; aussi chez les clients)
function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const pt = G.particles[i];
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vx *= 0.96; pt.vy *= 0.96;
    pt.rot += pt.vr * dt;
    pt.life -= dt;
    if (pt.life <= 0) G.particles.splice(i, 1);
  }
}

// Fin de partie (calculée par l'hôte, ou en solo) :
// - victoire d'un joueur qui contrôle 90 % des territoires, ou seul survivant ;
// - plus aucun humain en vie : la partie s'arrête (les bots l'emportent).
// Un humain éliminé alors que d'autres jouent encore voit l'écran de défaite,
// mais la partie continue pour les autres.
function checkVictory() {
  const counts = G.players.map(() => 0);
  for (const p of G.planets) for (const c of planetCells(p)) if (c.owner !== null && !c.destroyed) counts[c.owner]++;
  for (const p of G.players) if (p.alive && p.colonyPlaced && counts[p.id] === 0) p.alive = false;

  const alive = G.players.filter(p => p.alive);
  const top = G.players.find(p => p.alive && G.cellsTotal > 0 && counts[p.id] >= G.cellsTotal * CONFIG.victoryShare);
  if (top) return endGame(top);
  if (alive.length === 1 && counts[alive[0].id] > 0) return endGame(alive[0]);
  if (!G.players.some(p => !p.isBot && p.alive)) return endGame(null); // plus aucun humain : les IA l'emportent
}

// Les bots fondent leurs colonies une par une, puis la partie démarre
function startBotPlacement() {
  if (G.players.some(p => !p.isBot && p.id === G.me)) showPrompt(T('prompt.botsFounding'));
  // Retrouve la planète du joueur via la propriété des cellules
  const taken = new Set();
  for (const p of G.planets)
    for (const c of planetCells(p))
      if (c.owner !== null) taken.add(p.id);

  const bots = G.players.filter(p => p.isBot && !p.colonyPlaced);
  const game = G.players; // si une autre partie démarre entre-temps, ces minuteries s'annulent
  if (G.placingBots) return; // déjà en cours
  G.placingBots = true;
  const begin = () => setTimeout(() => {
    G.placingBots = false;
    if (G.players !== game || G.phase !== 'placement') return;
    G.phase = 'playing';
    hidePrompt();
    showToast(T('msg.gameStarts'), true);
  }, 600);
  if (!bots.length) { begin(); return; }
  bots.forEach((bot, i) => {
    setTimeout(() => {
      if (G.players !== game) return;
      if (!bot.colonyPlaced) placeBotColony(bot, taken);
      if (i === bots.length - 1) begin();
    }, 500 * (i + 1));
  });
}

function endGame(winner) {
  G.phase = 'over';
  G.winner = winner;
  showEndScreen(winner);
}
