// ============================================================
// SOLAR CONQUEST — Session de jeu : commandes et synchronisation
//
// Toutes les actions d'un joueur humain passent par issue() sous forme
// de COMMANDES (« construire une ville sur tel territoire »…).
//  - En solo et chez l'hôte : la commande est appliquée tout de suite.
//  - Chez un client : elle part chez l'hôte, qui la valide et l'applique.
// L'hôte est le seul à simuler la partie (bots compris). Dix fois par
// seconde il diffuse un INSTANTANÉ (seuls les territoires qui ont changé,
// les objets en vol, l'argent, la diplomatie…) que les clients affichent.
//
// Le transport (comment les messages circulent) est interchangeable :
// aujourd'hui BroadcastChannel (deux onglets du même navigateur, pour
// tester), demain WebRTC (PeerJS) entre ordinateurs.
// ============================================================

const SNAP_INTERVAL = 0.1;   // s entre deux instantanés (10 par seconde)
const PEER_TIMEOUT = 6000;   // ms sans nouvelles : le pair est parti

const Session = {
  role: 'solo',          // 'solo' | 'host' | 'client'
  transport: null,
  seats: new Map(),      // hôte : identifiant du pair → id joueur
  hostPeer: null,        // client : identifiant du pair hôte
  lastSeen: new Map(),   // pair → horodatage du dernier message
  snapT: 0,
  events: [],            // hôte : événements à joindre au prochain instantané
  fxQueue: [],           // hôte : explosions à rejouer chez les clients
  fxLater: [],           // client : explosions reçues, jouées avec le retard d'affichage
  pending: new Map(),    // client : commandes en attente de réponse
  cmdSeq: 1,
  sentCraters: new Map(),// hôte : nombre de cratères déjà envoyés, par planète
  needFull: true,        // hôte : prochain instantané complet
  bytes: 0, snaps: 0,    // statistiques (taille des instantanés envoyés)
  hbT: 0,

  isNet() { return this.role !== 'solo'; },

  // --- Événements de l'hôte vers les clients -------------------------
  event(ev) { if (this.role === 'host') this.events.push(ev); },
  fx(x, y, color, count, sizeMul) {
    if (this.fxQueue.length < 400) this.fxQueue.push([r1(x), r1(y), color, count, r2(sizeMul)]);
  },

  // Quitter la partie réseau en cours (retour au menu)
  close() {
    if (typeof RealRoom !== 'undefined') RealRoom.leave(); // oublie le salon (le transport est fermé ici)
    if (this.transport) {
      if (this.role === 'client' && this.hostPeer) this.transport.send(this.hostPeer, { k: 'bye' });
      if (this.role === 'host') this.transport.broadcast({ k: 'bye' });
      this.transport.close();
    }
    // Un client ne doit jamais se mettre à simuler la partie qu'il affichait
    if (this.role === 'client' && G.phase !== 'menu') G.phase = 'over';
    this.transport = null; this.role = 'solo';
    this.seats.clear(); this.lastSeen.clear(); this.pending.clear();
    this.events = []; this.fxQueue = []; this.fxLater = []; this.hostPeer = null; Clock.offset = null;
  },
};

function r1(v) { return Math.round(v * 10) / 10; }
function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }

// ============================================================
// 1. COMMANDES
// ============================================================

// Point d'entrée de l'interface : cb(résultat) est appelé quand la
// commande a été traitée (tout de suite en local, au retour de l'hôte sinon)
function issue(cmd, cb) {
  if (Session.role === 'client') {
    const id = Session.cmdSeq++;
    if (cb) Session.pending.set(id, cb);
    Session.transport.send(Session.hostPeer, { k: 'cmd', id, c: cmd });
    return;
  }
  const r = applyCommand(G.me, cmd);
  if (cb) cb(r);
}

const cellRef = (p, s) => { const pl = G.planets[p]; return pl ? pl.cells[0][s] || null : null; };

// Applique une commande pour le joueur pid, avec toutes les vérifications
// (l'hôte ne fait jamais confiance aveuglément à un client)
function applyCommand(pid, c) {
  const me = G.players[pid];
  if (!me || !c) return { ok: false, msg: 'Commande invalide' };
  const playing = G.phase === 'playing';
  switch (c.t) {
    case 'found': {
      if (G.phase !== 'placement' || me.colonyPlaced) return { ok: false };
      const cell = cellRef(c.p, c.s);
      if (!cell || cell.owner !== null || cell.destroyed) return { ok: false, msg: 'Territoire déjà pris' };
      foundColony(me, cell);
      if (G.players.every(p => p.isBot || p.colonyPlaced)) startBotPlacement();
      return { ok: true };
    }
    case 'build': {
      if (!playing || !me.alive) return { ok: false };
      const cell = cellRef(c.p, c.s);
      if (!cell) return { ok: false, msg: 'Territoire inconnu' };
      if (!BUILDING_NAMES[c.b]) return { ok: false, msg: 'Bâtiment inconnu' };
      return buildOn(me, cell, c.b);
    }
    case 'attack': {
      if (!playing || !me.alive) return { ok: false };
      const cell = cellRef(c.p, c.s);
      if (!cell || cell.destroyed) return { ok: false, msg: 'Territoire inconnu' };
      if (!cellNeighbors(cell).some(n => n.owner === pid && !n.destroyed)) return { ok: false, msg: 'Hors de portée' };
      if (cell.contest && cell.contest.attacker !== pid) return { ok: false, msg: 'Territoire déjà attaqué par un tiers' };
      return attackCell(me, cell);
    }
    case 'missiles': {
      if (!playing || !me.alive || !G.planets[c.p]) return { ok: false };
      return launchMissiles(me, G.planets[c.p], Math.max(1, c.n | 0), { x: +c.x || 0, y: +c.y || 0 });
    }
    case 'colony': {
      if (!playing || !me.alive || !G.planets[c.p]) return { ok: false };
      const share = Math.max(0.05, Math.min(0.9, +c.share || 0.25));
      return launchColonyModule(me, G.planets[c.p], share, G.planets[c.tp] || null, c.ang ?? null);
    }
    case 'ally': {
      if (!playing) return { ok: false };
      return requestAlliance(pid, c.to);
    }
    case 'answer': {
      const req = pendingRequest(c.from, pid);
      if (req) answerAlliance(req, !!c.accept);
      return { ok: true };
    }
    case 'betray': {
      if (!playing) return { ok: false };
      return betrayAlliance(pid, c.to, 'manual');
    }
    // Vaisseaux : en veille (CONFIG.features.fleets), uniquement en solo
    case 'ship': {
      if (!playing || !CONFIG.features.fleets || Session.isNet() || !G.planets[c.p]) return { ok: false };
      return buildShip(me, G.planets[c.p]);
    }
    case 'fleet': {
      if (!playing || !CONFIG.features.fleets || Session.isNet() || !G.planets[c.p]) return { ok: false };
      return launchFleet(me, G.planets[c.p], c.n, c.target);
    }
    case 'retarget': {
      if (!playing || !CONFIG.features.fleets || Session.isNet()) return { ok: false };
      if (c.fleet && c.fleet.owner === pid && fleetAlive(c.fleet)) retargetFleet(c.fleet, c.target);
      return { ok: true };
    }
  }
  return { ok: false, msg: 'Commande inconnue' };
}

// ============================================================
// 2. INSTANTANÉS (hôte → clients)
// ============================================================
const BCODES = ['city', 'industry', 'silo', 'shield', 'colony', 'tradeport', 'military', 'aa', 'spaceport'];

// Description fixe du système (envoyée une fois, au lancement)
function systemSetup() {
  return {
    planets: G.planets.map(p => ({
      id: p.id, name: p.name, orbitRadius: p.orbitRadius, orbitAngle: p.orbitAngle, orbitSpeed: p.orbitSpeed,
      radius: p.radius, hue: p.hue, sat: p.sat, light: p.light, spin: p.spin, rotation: p.rotation,
      sectors: p.sectors, band: p.band,
    })),
    players: G.players.map(p => ({ id: p.id, name: p.name, color: p.color, isBot: p.isBot })),
    cellsTotal: G.cellsTotal,
  };
}

// Client : reconstruit le système décrit par l'hôte
function buildSystemFrom(setup) {
  G.planets = setup.planets.map(sp => {
    const p = Object.assign({}, sp, { rings: 1, sectorAngle: TAU() / sp.sectors, x: 0, y: 0,
      cells: [], craters: [], craterCells: [], buildCounts: {} });
    const row = [];
    for (let s = 0; s < p.sectors; s++) row.push({ planet: p, ring: 0, sector: s, rTop: p.radius, owner: null, pop: 0, building: null, contest: null });
    p.cells.push(row);
    return p;
  });
  updatePlanetPositions(G.planets);
  G.players = setup.players.map(sp => ({ id: sp.id, name: sp.name, color: sp.color, isBot: sp.isBot,
    money: CONFIG.econ.startMoney, alive: true, colonyPlaced: false }));
  G.cellsTotal = setup.cellsTotal;
}

// État compact d'un territoire. Les grandeurs qui avancent toutes seules
// (rechargement, cooldowns) sont arrondies : le client les fait avancer
// lui-même entre deux instantanés.
function cellState(c) {
  const ct = c.contest;
  return [
    c.owner === null ? -1 : c.owner,
    Math.round(c.pop),
    c.building ? BCODES.indexOf(c.building) : -1,
    c.destroyed ? 1 : 0,
    r2(c.rTop ?? c.planet.radius),
    c.scorched ? 1 : 0,
    c.missiles ?? 0,
    Math.floor(c.reloadT || 0),
    Math.ceil(c.shieldDown || 0),
    (c.aaT || 0) >= CONFIG.aa.fireInterval ? 1 : 0,
    ct ? [ct.attacker, r1(ct.force), r1(ct.defense), r1(ct.initialDefense), ct.from ? ct.from.sector : -1] : 0,
  ];
}

// full = true : état complet pour un joueur qui (re)arrive, SANS toucher au
// suivi des différences des autres joueurs ni consommer les événements.
// full = false : seulement ce qui a changé depuis le dernier envoi.
function buildSnapshot(full) {
  const S = Session;
  const cells = [];
  G.planets.forEach((p, pi) => {
    for (const c of p.cells[0]) {
      const st = cellState(c);
      if (full) { cells.push([pi, c.sector, ...st]); continue; }
      const sig = JSON.stringify(st);
      if (sig !== c._sig) { c._sig = sig; cells.push([pi, c.sector, ...st]); }
    }
  });
  const craters = [];
  G.planets.forEach((p, pi) => {
    const from = full ? 0 : (S.sentCraters.get(pi) || 0);
    for (let i = from; i < p.craters.length; i++) {
      const cr = p.craters[i];
      craters.push([pi, r3(cr.ang), r2(cr.dist), r2(cr.r)]);
    }
    if (!full) S.sentCraters.set(pi, p.craters.length);
  });
  const bc = [];
  G.planets.forEach((p, pi) => {
    if (full) { bc.push([pi, p.buildCounts]); return; }
    const sig = JSON.stringify(p.buildCounts);
    if (sig !== p._bcSig) { p._bcSig = sig; bc.push([pi, p.buildCounts]); }
  });
  const fly = o => [o.id, r1(o.x), r1(o.y), r1(o.vx), r1(o.vy), o.owner];
  const snap = {
    k: 'snap', full: !!full,
    t: r3(G.time), ph: G.phase, ct: G.cellsTotal, w: G.winner ? G.winner.id : null,
    pl: G.planets.map(p => [r3(p.orbitAngle), r3(p.rotation)]),
    pr: G.players.map(p => [Math.round(p.money), p.alive ? 1 : 0, p.colonyPlaced ? 1 : 0,
      r1(p.vulnerableUntil || 0), r1(p.traitorUntil || 0), p.isBot ? 1 : 0, p.profile ? [p.profile.style, r2(p.profile.skill)] : 0]),
    c: cells, cr: craters, bc,
    mi: G.missiles.map(fly),
    mo: G.modules.map(m => [...fly(m), m.hp ?? CONFIG.aa.moduleHits]),
    ca: G.cargos.map(fly),
    fl: G.flak.map(fly),
    sh: G.shells.map(sh => [sh.id, sh.from.planet.id, sh.from.sector, sh.to.sector, sh.owner, r3(sh.a0), r3(sh.a1), r3(sh.t)]),
    al: G.alliances.map(a => [a.a, a.b, r1(a.until)]),
    rq: G.allyRequests.map(q => [q.from, q.to, r1(q.expires)]),
    ev: full ? [] : S.events, fx: full ? [] : S.fxQueue,
  };
  if (!full) { S.events = []; S.fxQueue = []; }
  return snap;
}

// Objets en vol : on garde le même objet d'un instantané à l'autre (sa
// traînée continue) et on le recale sur la position envoyée
// Lissage : les objets en vol sont affichés avec un léger retard (INTERP),
// en interpolant entre deux instantanés reçus. Sans cela, l'irrégularité du
// réseau et les virages serrés (mini-missiles de DAA) donnaient des zigzags.
const INTERP = 120;          // ms de retard d'affichage des objets en vol
const Clock = { offset: null };

// Heure locale (ms) correspondant à un instant de jeu du serveur, recalée
// sur les arrivées les plus rapides (le jitter du réseau est ainsi ignoré)
function stampFor(serverTime) {
  const now = performance.now();
  const off = now - serverTime * 1000;
  if (Clock.offset === null || off < Clock.offset) Clock.offset = off;
  else Clock.offset += (off - Clock.offset) * 0.02;
  return serverTime * 1000 + Clock.offset;
}

function syncFlying(list, rows, extra, stamp) {
  const byId = new Map(list.map(o => [o.id, o]));
  const out = [];
  for (const r of rows) {
    let o = byId.get(r[0]);
    if (!o) { o = { id: r[0], trail: [], buf: [], x: r[1], y: r[2], vx: r[3], vy: r[4] }; }
    else byId.delete(r[0]);
    o.buf.push({ t: stamp, x: r[1], y: r[2], vx: r[3], vy: r[4] });
    if (o.buf.length > 8) o.buf.shift();
    o.owner = r[5];
    o.gone = false;
    o.color = G.players[o.owner] ? G.players[o.owner].color : '#ffffff';
    if (extra) extra(o, r);
    out.push(o);
  }
  // Disparus côté serveur : encore affichés le temps du retard d'affichage
  for (const o of byId.values()) { if (o.buf) { o.gone = true; out.push(o); } }
  return out;
}

// Position affichée d'un objet en vol à l'instant t (ms, horloge locale)
function sampleFlying(o, t) {
  const b = o.buf;
  if (!b || !b.length) return true;
  if (t <= b[0].t) { Object.assign(o, { x: b[0].x, y: b[0].y, vx: b[0].vx, vy: b[0].vy }); return true; }
  for (let i = 1; i < b.length; i++) {
    if (t <= b[i].t) {
      const a = b[i - 1], c = b[i], k = (t - a.t) / Math.max(1, c.t - a.t);
      o.x = a.x + (c.x - a.x) * k; o.y = a.y + (c.y - a.y) * k;
      o.vx = a.vx + (c.vx - a.vx) * k; o.vy = a.vy + (c.vy - a.vy) * k;
      return true;
    }
  }
  const l = b[b.length - 1];
  if (o.gone) return false; // fin de vol atteinte à l'écran : on le retire
  const dt = Math.min(0.1, (t - l.t) / 1000); // petit prolongement si un instantané tarde
  o.x = l.x + l.vx * dt; o.y = l.y + l.vy * dt; o.vx = l.vx; o.vy = l.vy;
  return true;
}

function applySnapshot(s) {
  const prevPhase = G.phase;
  G.time = s.t;
  G.cellsTotal = s.ct;
  s.pl.forEach((v, i) => { const p = G.planets[i]; if (p) { p.orbitAngle = v[0]; p.rotation = v[1]; } });
  updatePlanetPositions(G.planets);
  s.pr.forEach((v, i) => {
    const p = G.players[i]; if (!p) return;
    p.money = v[0]; p.alive = !!v[1]; p.colonyPlaced = !!v[2];
    p.vulnerableUntil = v[3]; p.traitorUntil = v[4]; p.isBot = !!v[5];
    p.profile = v[6] ? { style: v[6][0], skill: v[6][1] } : null;
  });
  for (const [pi, ang, dist, r] of s.cr) { const p = G.planets[pi]; if (p) p.craters.push({ ang, dist, r }); }
  for (const [pi, counts] of s.bc) { const p = G.planets[pi]; if (p) p.buildCounts = counts; }
  for (const row of s.c) {
    const p = G.planets[row[0]]; if (!p) continue;
    const c = p.cells[0][row[1]];
    const [owner, pop, b, destroyed, rTop, scorched, missiles, reloadT, shieldDown, aaReady, ct] = row.slice(2);
    c.owner = owner < 0 ? null : owner;
    c.pop = pop;
    c.building = b < 0 ? null : BCODES[b];
    c.destroyed = !!destroyed;
    c.rTop = rTop;
    c.scorched = !!scorched;
    c.missiles = missiles;
    if (Math.floor(c.reloadT || 0) !== reloadT) c.reloadT = reloadT;
    if (Math.ceil(c.shieldDown || 0) !== shieldDown) c.shieldDown = shieldDown;
    const ready = (c.aaT || 0) >= CONFIG.aa.fireInterval;
    if (ready !== !!aaReady) c.aaT = aaReady ? CONFIG.aa.fireInterval : 0;
    c.contest = ct ? { attacker: ct[0], force: ct[1], defense: ct[2], initialDefense: ct[3], from: ct[4] >= 0 ? p.cells[0][ct[4]] : null } : null;
  }
  const stamp = stampFor(s.t);
  G.missiles = syncFlying(G.missiles, s.mi, null, stamp);
  G.modules = syncFlying(G.modules, s.mo, (o, r) => { o.hp = r[6]; }, stamp);
  G.cargos = syncFlying(G.cargos, s.ca, null, stamp);
  G.flak = syncFlying(G.flak, s.fl, null, stamp);
  const shells = new Map(G.shells.map(o => [o.id, o]));
  G.shells = s.sh.map(r => {
    const p = G.planets[r[1]];
    const o = shells.get(r[0]) || { id: r[0], trail: [] };
    o.from = p.cells[0][r[2]]; o.to = p.cells[0][r[3]]; o.owner = r[4]; o.a0 = r[5]; o.a1 = r[6]; o.t = r[7];
    return o;
  });
  G.alliances = s.al.map(a => ({ a: a[0], b: a[1], until: a[2] }));
  G.allyRequests = s.rq.map(q => ({ from: q[0], to: q[1], expires: q[2] }));
  // Explosions : jouées avec le même retard que les objets en vol
  for (const f of s.fx) Session.fxLater.push({ t: stamp, f });
  for (const ev of s.ev) clientEvent(ev);

  // Changements de phase
  G.phase = s.ph === 'over' ? G.phase : s.ph;
  if (prevPhase === 'placement' && G.phase !== 'placement') {
    hidePrompt();
    if (Session.rejoining) showToast('Reconnecté : vous reprenez la partie', true);
    else if (G.phase === 'playing') showToast('La partie commence — étendez-vous !', true);
  }
  Session.rejoining = false;
  if (s.ph === 'over' && prevPhase !== 'over') endGame(s.w === null ? null : G.players[s.w]);
}

function clientEvent(ev) {
  if (ev.k === 'toast') { if (ev.to === G.me || ev.to === -1) showToast(ev.msg, ev.ok); }
  else if (ev.k === 'diplo') onDiplomacyEvent(ev.type, ev.data);
}

// Client : entre deux instantanés, tout continue d'avancer à l'écran
// (planètes, objets en vol, jauges), sans rien décider
function clientUpdate(dt) {
  G.time += dt;
  const renderT = performance.now() - INTERP;
  const later = Session.fxLater;
  while (later.length && later[0].t <= renderT) { const f = later.shift().f; spawnBurst(f[0], f[1], f[2], f[3], f[4]); }
  updateParticles(dt);
  for (const p of G.planets) { p.orbitAngle += p.orbitSpeed * dt; p.rotation += p.spin * dt; }
  updatePlanetPositions(G.planets);
  const move = (list, n) => list.filter(o => {
    if (!sampleFlying(o, renderT)) return false;
    o.trail.push({ x: o.x, y: o.y }); if (o.trail.length > n) o.trail.shift();
    return true;
  });
  G.missiles = move(G.missiles, 26); G.modules = move(G.modules, 30); G.cargos = move(G.cargos, 30); G.flak = move(G.flak, 7);
  for (const sh of G.shells) {
    sh.t = Math.min(1, sh.t + dt / CONFIG.military.shellFlightTime);
    sh.trail.push(shellPos(sh)); if (sh.trail.length > 8) sh.trail.shift();
  }
  if (G.phase !== 'playing') return;
  for (const p of G.planets) for (const c of p.cells[0]) {
    if (c.destroyed || c.owner === null) continue;
    if (c.building === 'silo' && (c.missiles || 0) < CONFIG.silo.capacity) c.reloadT = Math.min(CONFIG.silo.reloadTime, (c.reloadT || 0) + dt);
    if (c.shieldDown > 0) c.shieldDown = Math.max(0, c.shieldDown - dt);
    if (c.building === 'aa') c.aaT = Math.min(CONFIG.aa.fireInterval, (c.aaT || 0) + dt);
    if (c.contest && Math.random() < dt * 7) spawnSpark(c);
  }
}

// ============================================================
// 3. BOUCLE RÉSEAU (appelée à chaque image)
// ============================================================
function sessionTick(rawDt) {
  const S = Session;
  if (!S.transport) return;
  const now = Date.now();
  S.hbT += rawDt;
  if (S.role === 'host' && G.phase !== 'menu') {
    S.snapT += rawDt;
    if (S.snapT >= SNAP_INTERVAL) {
      S.snapT = 0;
      const snap = buildSnapshot(false); // le premier envoi contient tout
      const txt = S.transport.broadcast(snap);
      S.bytes += txt || 0; S.snaps++;
    }
    // Clients silencieux : remplacés par un bot
    for (const [peer, pid] of S.seats) {
      if (now - (S.lastSeen.get(peer) || now) > PEER_TIMEOUT) dropSeat(peer, 'ne répond plus');
    }
  }
  if (S.role === 'client') {
    if (S.hbT >= 1) { S.hbT = 0; S.transport.send(S.hostPeer, { k: 'ping' }); }
    if (S.transport.kind !== 'ws' && G.phase !== 'menu' && G.phase !== 'over' && now - (S.lastSeen.get(S.hostPeer) || now) > PEER_TIMEOUT) {
      hostLost("L'hôte ne répond plus : la partie est terminée.");
    }
  }
}

// Un joueur a quitté la partie : un bot prend sa place
function dropSeat(peer, why) {
  const S = Session;
  const pid = S.seats.get(peer);
  S.seats.delete(peer); S.lastSeen.delete(peer);
  botifyPlayer(pid, why);
}

// Remplace le joueur humain pid par un bot (hôte navigateur ou serveur)
function botifyPlayer(pid, why) {
  const p = G.players[pid];
  if (!p || p.isBot) return;
  p.isBot = true;
  p.aiTimer = rand(CONFIG.ai.tickMin, CONFIG.ai.tickMax);
  if (!p.colonyPlaced && G.phase === 'placement') {
    const taken = new Set(); for (const pl of G.planets) for (const c of pl.cells[0]) if (c.owner !== null) taken.add(pl.id);
    placeBotColony(p, taken);
    if (G.players.every(q => q.isBot || q.colonyPlaced)) startBotPlacement();
  }
  showToast(`${p.name} a quitté la partie (${why}) : un bot le remplace`);
  Session.event({ k: 'toast', to: -1, msg: `${p.name} a quitté la partie : un bot le remplace` });
}

function hostLost(msg) {
  if (Session.role !== 'client') return;
  Session.close();
  G.phase = 'over';
  el('endscreen').hidden = false;
  el('end-kicker').textContent = 'CONNEXION PERDUE';
  el('end-title').textContent = 'FIN DE PARTIE';
  el('end-sub').textContent = msg;
}

// Messages reçus pendant la partie (le salon a ses propres messages, cf. net.js)
function sessionMessage(peer, m) {
  const S = Session;
  S.lastSeen.set(peer, Date.now());
  if (S.role === 'host') {
    const pid = S.seats.get(peer);
    if (pid === undefined) return;
    if (m.k === 'cmd') {
      const r = applyCommand(pid, m.c) || { ok: false };
      S.transport.send(peer, { k: 'res', id: m.id, r: { ok: !!r.ok, msg: r.msg, launched: r.launched, colonists: r.colonists, accepted: r.accepted, clash: r.clash, free: r.free } });
    } else if (m.k === 'bye') dropSeat(peer, 'parti');
  } else if (S.role === 'client') {
    if (peer !== S.hostPeer) return;
    if (m.k === 'snap') applySnapshot(m);
    else if (m.k === 'res') { const cb = S.pending.get(m.id); S.pending.delete(m.id); if (cb) cb(m.r); }
    else if (m.k === 'bye') hostLost("L'hôte a quitté la partie.");
  }
}

// --- Démarrage ----------------------------------------------------------
// Hôte : la partie est créée ici puis décrite aux clients
function startHostGame(transport, room) {
  const S = Session;
  const humans = room.players.map(p => p.pseudo);
  const bots = room.fillBots ? Math.max(0, room.maxPlayers - humans.length) : 0;
  S.role = 'host'; S.transport = transport; S.needFull = true; S.snapT = 0;
  S.seats.clear(); S.sentCraters.clear(); S.events = []; S.fxQueue = [];
  room.players.forEach((p, i) => { if (p.peer) { S.seats.set(p.peer, i); S.lastSeen.set(p.peer, Date.now()); } });
  startLocalGame(room.planets, bots, [], humans);
  const setup = systemSetup();
  for (const [peer, pid] of S.seats) transport.send(peer, { k: 'start', setup, you: pid });
}

// Client : reconstruit la partie décrite par l'hôte
function startClientGame(transport, hostPeer, setup, you) {
  const S = Session;
  S.role = 'client'; S.transport = transport; S.hostPeer = hostPeer;
  S.lastSeen.set(hostPeer, Date.now());
  newGame(setup.planets.length, 0, ['?']); // remet l'état à zéro
  buildSystemFrom(setup);
  G.me = you;
  G.phase = 'placement';
  enterGameScreen();
}

// Transport de test : BroadcastChannel (onglets d'un même navigateur).
// Interface commune à tous les transports :
//   id, send(peer, msg), broadcast(msg), onMessage(fn(peer, msg)), close()
function makeTabTransport(code) {
  const ch = new BroadcastChannel('solar-conquest-' + code);
  const id = Math.random().toString(36).slice(2, 10);
  let handler = null;
  ch.onmessage = (e) => {
    const d = e.data;
    if (!d || d.from === id || (d.to && d.to !== id)) return;
    if (handler) handler(d.from, d.m);
  };
  return {
    id, kind: 'tab',
    send(peer, m) { ch.postMessage({ from: id, to: peer, m }); },
    broadcast(m) { ch.postMessage({ from: id, to: null, m }); return m.k === 'snap' ? JSON.stringify(m).length : 0; },
    onMessage(fn) { handler = fn; },
    close() { ch.close(); handler = null; },
  };
}

// Fermeture de l'onglet : prévenir les autres tout de suite
// (En ligne, on ne prévient pas : un rechargement de la page permet de
// reprendre la partie pendant 60 s grâce au jeton de reconnexion.)
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => {
  if (Session.transport && Session.transport.kind === 'ws') return;
  if (Session.transport) Session.close();
  else if (typeof RealRoom !== 'undefined') RealRoom.leave();
});
