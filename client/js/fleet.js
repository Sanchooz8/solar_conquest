// ============================================================
// SOLAR CONQUEST — Spatioport, vaisseaux et flottes
// Les vaisseaux sont construits et stockés dans un spatioport, puis
// lancés en flotte vers une planète ou une flotte ennemie. En orbite,
// ils détruisent les bâtiments ennemis un par un ; ils ne touchent
// jamais à la population. Ils traversent les boucliers, mais les DAA et
// les missiles les abattent.
// ============================================================

let _fleetId = 0;

// Vaisseaux existants d'un joueur : en stock dans ses spatioports + en vol
function playerShipCount(playerId) {
  let n = 0;
  for (const p of G.planets)
    for (const c of planetCells(p))
      if (c.owner === playerId && c.building === 'spaceport' && !c.destroyed) n += c.ships || 0;
  for (const f of G.fleets) if (f.owner === playerId) n += f.ships.length;
  return n;
}

// Coût du prochain vaisseau : 200 $, +25 % par vaisseau existant du joueur
function shipCost(playerId) {
  const F = CONFIG.fleet;
  return Math.round(F.shipCost * Math.pow(F.shipCostEscalation, playerShipCount(playerId)));
}

function spaceports(playerId, planet) {
  return planetCells(planet).filter(c =>
    !c.destroyed && c.owner === playerId && c.building === 'spaceport');
}

function storedShips(playerId, planet) {
  return spaceports(playerId, planet).reduce((s, c) => s + (c.ships || 0), 0);
}

// Construire un vaisseau dans un spatioport de la planète (le moins rempli)
function buildShip(player, planet) {
  const ports = spaceports(player.id, planet);
  if (!ports.length) return { ok: false, msg: 'Aucun spatioport sur cette planète' };
  const cost = shipCost(player.id);
  if (player.money < cost) return { ok: false, msg: 'Argent insuffisant' };
  player.money -= cost;
  const port = ports.reduce((a, b) => ((a.ships || 0) <= (b.ships || 0) ? a : b));
  port.ships = (port.ships || 0) + 1;
  const c = cellCentroid(port);
  spawnBurst(c.x, c.y, player.color, 5, 0.6);
  return { ok: true, cost };
}

// Formation : chaque vaisseau garde un décalage fixe autour du centre
function formationOffset(i, n) {
  const ring = Math.sqrt(i + 0.5) / Math.sqrt(Math.max(1, n));
  const a = i * 2.39996; // angle d'or : répartition régulière en disque
  const R = CONFIG.fleet.formationRadius * (0.35 + 0.65 * Math.sqrt(n / 6));
  return { ox: Math.cos(a) * R * ring, oy: Math.sin(a) * R * ring };
}

// Lancer une flotte depuis les spatioports de la planète
// target : { kind: 'planet', planet } | { kind: 'fleet', fleet }
function launchFleet(player, planet, count, target) {
  const ports = spaceports(player.id, planet).filter(c => (c.ships || 0) > 0);
  const stock = ports.reduce((s, c) => s + c.ships, 0);
  const n = Math.min(count, stock);
  if (n <= 0) return { ok: false, msg: 'Aucun vaisseau en stock sur cette planète' };

  // Prélèvement port par port ; la flotte décolle du premier port utilisé
  let left = n;
  let origin = null;
  for (const c of ports) {
    const take = Math.min(c.ships, left);
    c.ships -= take; left -= take;
    if (!origin) origin = c;
    if (left <= 0) break;
  }
  const a = planet.rotation + (origin.sector + 0.5) * planet.sectorAngle;
  const r0 = planet.radius + 2;
  const fleet = {
    id: ++_fleetId, owner: player.id, color: player.color,
    cx: planet.x + Math.cos(a) * r0, cy: planet.y + Math.sin(a) * r0,
    vx: Math.cos(a) * 20, vy: Math.sin(a) * 20,
    target, state: 'transit', orbitPlanet: null, orbitA: 0, aimCell: null, aimT: 0,
    ships: [],
  };
  for (let i = 0; i < n; i++) {
    const o = formationOffset(i, n);
    fleet.ships.push({ ox: o.ox, oy: o.oy, x: fleet.cx, y: fleet.cy, vx: 0, vy: 0,
      fireT: Math.random() * CONFIG.fleet.fireInterval, dead: false, fleet });
  }
  G.fleets.push(fleet);
  spawnBurst(fleet.cx, fleet.cy, player.color, 8, 0.7);
  return { ok: true, launched: n };
}

// Nouvelle cible pour une flotte existante
function retargetFleet(fleet, target) {
  fleet.target = target;
  fleet.aimCell = null;
  if (target.kind === 'planet' && fleet.orbitPlanet === target.planet) {
    // Même planète : nouveau point visé, la flotte y glisse le long de l'orbite
    fleet.slotA = target.ang ?? null;
    fleet.slotReached = fleet.slotA === null;
    return;
  }
  fleet.state = 'transit';
  fleet.orbitPlanet = null;
}

function fleetAlive(f) { return f && f.ships.length > 0 && G.fleets.includes(f); }

// Destruction d'un vaisseau (DAA, missile, combat)
function killShip(ship, color) {
  if (ship.dead) return;
  ship.dead = true;
  const f = ship.fleet;
  const i = f.ships.indexOf(ship);
  if (i >= 0) f.ships.splice(i, 1);
  spawnBurst(ship.x, ship.y, '#ffb347', 6, 0.5);
  spawnBurst(ship.x, ship.y, color || f.color, 3, 0.4);
}

// Tous les vaisseaux en vol (hors propriétaire exclu)
function enemyShips(ownerId) {
  const out = [];
  for (const f of G.fleets) if (isHostile(f.owner, ownerId)) for (const s of f.ships) out.push(s);
  return out;
}

// Explosion de missile : détruit jusqu'à 3 vaisseaux ennemis dans le souffle
function blastShips(x, y, ownerId) {
  const F = CONFIG.fleet;
  const near = enemyShips(ownerId)
    .map(s => ({ s, d: Math.hypot(s.x - x, s.y - y) }))
    .filter(o => o.d <= F.missileBlastRadius)
    .sort((a, b) => a.d - b.d)
    .slice(0, F.missileMaxKills);
  for (const o of near) killShip(o.s);
  return near.length;
}

// Le missile touche-t-il un vaisseau ennemi ?
function missileHitsShip(m) {
  const r = CONFIG.fleet.missileHitRadius;
  for (const s of enemyShips(m.owner)) if (Math.hypot(s.x - m.x, s.y - m.y) < r) return true;
  return false;
}

// Bâtiment touché par un tir de vaisseau : points de vie, puis destruction
function damageBuilding(cell, ownerColor) {
  const F = CONFIG.fleet;
  cell.bhp = (cell.bhp ?? F.buildingHits) - 1;
  if (cell.bhp > 0) return false;
  const c = cellCentroid(cell);
  spawnBurst(c.x, c.y, '#ffb347', 8, 0.6);
  spawnBurst(c.x, c.y, ownerColor, 4, 0.5);
  notify(cell.owner, `${BUILDING_NAMES[cell.building] || 'Bâtiment'} détruit par une flotte ennemie sur ${cell.planet.name}`);
  cell.building = null;
  cell.bhp = undefined;
  cell.missiles = undefined; cell.ships = undefined;
  cell.fireT = undefined; cell.aaT = undefined; cell.shieldDown = undefined;
  return true;
}

const BUILDING_NAMES = { city: 'Ville', industry: 'Industrie', silo: 'Silo', shield: 'Bouclier',
  colony: 'Centre de colonisation', tradeport: 'Port de commerce', military: 'Base militaire',
  aa: 'DAA', spaceport: 'Spatioport' };

// Bâtiment ennemi visé en orbite : le plus proche de la flotte le long de l'orbite
function pickBuildingTarget(fleet) {
  const p = fleet.orbitPlanet;
  let best = null, bestD = Infinity;
  for (const c of planetCells(p)) {
    if (c.destroyed || !c.building || c.owner === null || !isHostile(fleet.owner, c.owner)) continue;
    const a = p.rotation + (c.sector + 0.5) * p.sectorAngle;
    let da = a - fleet.orbitA;
    da = Math.abs(((da + Math.PI) % TAU() + TAU()) % TAU() - Math.PI);
    if (da < bestD) { best = c; bestD = da; }
  }
  return best;
}

function updateFleets(dt) {
  const F = CONFIG.fleet;
  for (let fi = G.fleets.length - 1; fi >= 0; fi--) {
    const f = G.fleets[fi];
    if (!f.ships.length) { G.fleets.splice(fi, 1); continue; }

    // Cible flotte disparue : la flotte s'immobilise et attend un ordre
    if (f.target && f.target.kind === 'fleet' && (!fleetAlive(f.target.fleet) || areAllied(f.owner, f.target.fleet.owner))) {
      f.target = null;
      if (f.state === 'transit') f.state = 'idle';
    }

    if (f.state === 'orbit') {
      // En orbite : la flotte suit la planète et glisse le long de
      // l'orbite vers le bâtiment ennemi visé
      const p = f.orbitPlanet;
      f.aimT -= dt;
      if (!f.aimCell || f.aimCell.building === null || !isHostile(f.owner, f.aimCell.owner) ||
          f.aimCell.owner === null || f.aimT <= 0) {
        f.aimCell = pickBuildingTarget(f);
        f.aimT = 0.5;
      }
      if (!f.slotReached && f.slotA !== null && f.slotA !== undefined) {
        // Rejoindre le point visé le long de l'orbite avant d'attaquer
        const da = angleDiff(p.rotation + f.slotA, f.orbitA);
        const step = F.orbitTurn * 1.6 * dt;
        f.orbitA += Math.max(-step, Math.min(step, da)) + p.spin * dt;
        if (Math.abs(da) < 0.06) { f.slotReached = true; f.aimCell = null; f.aimT = 0; }
      } else if (f.aimCell) {
        const ta = p.rotation + (f.aimCell.sector + 0.5) * p.sectorAngle;
        let da = ((ta - f.orbitA + Math.PI) % TAU() + TAU()) % TAU() - Math.PI;
        const step = F.orbitTurn * dt;
        f.orbitA += Math.max(-step, Math.min(step, da));
      } else {
        f.orbitA += p.spin * dt; // plus rien à détruire : reste au-dessus du même point
      }
      const R = p.radius + F.orbitGap;
      const nx = p.x + Math.cos(f.orbitA) * R, ny = p.y + Math.sin(f.orbitA) * R;
      f.vx = (nx - f.cx) / Math.max(dt, 1e-3); f.vy = (ny - f.cy) / Math.max(dt, 1e-3);
      f.cx = nx; f.cy = ny;
    } else if (f.state === 'transit' && f.target) {
      // Transit : cap vers la cible courante (planète ou flotte), virage limité
      let gx, gy, stop;
      if (f.target.kind === 'planet') {
        const p = f.target.planet;
        gx = p.x; gy = p.y; stop = p.radius + F.orbitGap;
      } else {
        gx = f.target.fleet.cx; gy = f.target.fleet.cy; stop = F.engageDistance;
      }
      const dx = gx - f.cx, dy = gy - f.cy, d = Math.hypot(dx, dy);
      if (f.target.kind === 'planet' && d <= stop + 2) {
        f.state = 'orbit';
        f.orbitPlanet = f.target.planet;
        f.orbitA = Math.atan2(f.cy - gy, f.cx - gx);
        // Point visé sur la planète : la flotte glisse d'abord jusqu'à lui
        f.slotA = f.target.ang ?? null;
        f.slotReached = f.slotA === null;
      } else {
        // Vitesse de la cible : la flotte va toujours assez vite pour la
        // rattraper (1,25 × sa vitesse + 8), et vise là où elle sera
        const tv = f.target.kind === 'planet' ? planetVelocity(f.target.planet)
          : { x: f.target.fleet.vx || 0, y: f.target.fleet.vy || 0 };
        const cruise = Math.max(F.speed, Math.hypot(tv.x, tv.y) * F.catchUpFactor + F.catchUpMargin);
        const tgo = Math.min(6, d / cruise);
        const want = Math.atan2(dy + tv.y * tgo, dx + tv.x * tgo);
        let cur = Math.atan2(f.vy, f.vx);
        let da = ((want - cur + Math.PI) % TAU() + TAU()) % TAU() - Math.PI;
        const turn = F.turn * cruise / F.speed; // rayon de virage constant
        cur += Math.max(-turn * dt, Math.min(turn * dt, da));
        let sp = Math.min(cruise, Math.hypot(f.vx, f.vy) + F.accel * dt);
        if (f.target.kind === 'fleet' && d < stop) sp = Math.max(0, sp * (d / stop)); // se place à distance de tir
        f.vx = Math.cos(cur) * sp; f.vy = Math.sin(cur) * sp;
        f.cx += f.vx * dt; f.cy += f.vy * dt;
      }
    } else {
      // Sans ordre : la flotte freine et attend
      f.vx *= Math.exp(-dt * 2); f.vy *= Math.exp(-dt * 2);
      f.cx += f.vx * dt; f.cy += f.vy * dt;
      if (f.state !== 'idle') f.state = 'idle';
    }

    // Positions individuelles (formation + léger flottement)
    const tt = G.time;
    for (let i = 0; i < f.ships.length; i++) {
      const s = f.ships[i];
      s.x = f.cx + s.ox + Math.sin(tt * 1.7 + i * 1.3) * 0.6;
      s.y = f.cy + s.oy + Math.cos(tt * 1.3 + i * 0.9) * 0.6;
      s.vx = f.vx; s.vy = f.vy;
    }
  }

  // Tirs : priorité aux vaisseaux ennemis à portée, sinon au bâtiment visé
  for (const f of G.fleets.slice()) {
    if (!f.ships.length) continue;
    const foes = enemyShips(f.owner);
    for (const s of f.ships.slice()) {
      if (s.dead) continue;
      s.fireT += dt;
      if (s.fireT < F.fireInterval) continue;
      let shot = false;
      let best = null, bestD = F.weaponRange;
      for (const e of foes) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d < bestD) { best = e; bestD = d; }
      }
      if (best) {
        G.bolts.push({ x1: s.x, y1: s.y, x2: best.x, y2: best.y, color: f.color, life: F.boltLife });
        best.shipDmg = (best.shipDmg || 0) + 1; // 2 tirs de vaisseau pour l'abattre
        if (best.shipDmg >= F.shipHits) killShip(best, f.color);
        else spawnBurst(best.x, best.y, '#ffd28a', 2, 0.3);
        shot = true;
      } else if ((best = nearestHostileCargo(f.owner, s.x, s.y, F.weaponRange))) {
        // Cargo d'un tiers qui ne vient pas commercer avec nous : abattu en 1 tir
        G.bolts.push({ x1: s.x, y1: s.y, x2: best.x, y2: best.y, color: f.color, life: F.boltLife });
        shootDownCargo(best);
        shot = true;
      } else if (f.state === 'orbit' && f.aimCell && f.aimCell.building) {
        const c = cellCentroid(f.aimCell);
        if (Math.hypot(c.x - s.x, c.y - s.y) <= F.weaponRange) {
          G.bolts.push({ x1: s.x, y1: s.y, x2: c.x, y2: c.y, color: f.color, life: F.boltLife });
          spawnBurst(c.x, c.y, '#ffd28a', 1, 0.3);
          if (damageBuilding(f.aimCell, f.color)) f.aimCell = null;
          shot = true;
        }
      }
      if (shot) s.fireT = 0;
      else s.fireT = F.fireInterval; // prêt, tire dès qu'une cible est à portée
    }
  }

  // Riposte des bâtiments : chaque bâtiment tire chaque seconde un petit
  // tir sur le vaisseau ennemi le plus proche à portée d'orbite ;
  // 8 tirs de bâtiment détruisent un vaisseau
  if (G.fleets.length) {
    for (const p of G.planets) {
      // Vaisseaux à proximité de cette planète seulement
      const near = [];
      for (const f of G.fleets) {
        if (Math.hypot(f.cx - p.x, f.cy - p.y) > p.radius + F.defenseRange + F.formationRadius * 2) continue;
        for (const sh of f.ships) near.push(sh);
      }
      if (!near.length) continue;
      for (const cell of planetCells(p)) {
        if (cell.destroyed || !cell.building || cell.owner === null) continue;
        cell.defT = Math.min(F.defenseInterval, (cell.defT || 0) + dt);
        if (cell.defT < F.defenseInterval) continue;
        const c = cellCentroid(cell);
        let best = null, bestD = F.defenseRange;
        for (const sh of near) {
          if (sh.dead || !isHostile(sh.fleet.owner, cell.owner)) continue;
          const d = Math.hypot(sh.x - c.x, sh.y - c.y);
          if (d < bestD) { best = sh; bestD = d; }
        }
        if (!best) continue;
        cell.defT = 0;
        const col = G.players[cell.owner].color;
        G.bolts.push({ x1: c.x, y1: c.y, x2: best.x, y2: best.y, color: col, life: F.boltLife * 0.7, thin: true });
        best.hull = (best.hull || 0) + 1;
        if (best.hull >= F.hullHits) killShip(best, col);
        else spawnBurst(best.x, best.y, '#ffd28a', 1, 0.2);
      }
    }
  }

  for (let i = G.bolts.length - 1; i >= 0; i--) {
    G.bolts[i].life -= dt;
    if (G.bolts[i].life <= 0) G.bolts.splice(i, 1);
  }
}

// Flotte (d'un autre joueur, ou non) la plus proche d'un point, dans un rayon
function fleetAt(x, y, radius, filter) {
  let best = null, bestD = radius;
  for (const f of G.fleets) {
    if (filter && !filter(f)) continue;
    const d = Math.hypot(f.cx - x, f.cy - y);
    if (d < bestD) { best = f; bestD = d; }
  }
  return best;
}

// Cargo hostile le plus proche (ni à nous, ni à destination de chez nous)
function nearestHostileCargo(ownerId, x, y, range) {
  let best = null, bestD = range;
  for (const m of G.cargos) {
    if (!cargoHostileTo(m, ownerId)) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bestD) { best = m; bestD = d; }
  }
  return best;
}
