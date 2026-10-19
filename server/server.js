// ============================================================
// SOLAR CONQUEST — Serveur de jeu (Node.js + WebSocket)
//
// Rôle :
//  - salons : création, code à 4 caractères, liste des parties publiques,
//    salon d'attente, lancement par l'hôte du salon ;
//  - parties : le serveur fait tourner chaque partie (bots compris, 20 fois
//    par seconde), applique les ordres des joueurs après vérification, et
//    envoie l'état aux joueurs 10 fois par seconde ;
//  - déconnexions : un joueur dont la connexion saute a 60 s pour revenir
//    (rechargement de la page compris) avant d'être remplacé par un bot.
//
// Protocole (messages JSON) :
//  client → serveur : hello {pseudo, token?} · list · create {opts} · join {code}
//                     joinId {id} · leave · start · cmd {id, c} · bye · ping
//  serveur → client : welcome · list {games} · joined {room} · roster {room}
//                     error {msg} · closed {msg} · start {setup, you}
//                     snap {...} · res {id, r} · bye
// ============================================================
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { startGame } = require('./sim');
const supa = require('./supabase');

const PORT = process.env.PORT || 8080;
const VERSION = require('../package.json').version;
const TICK = 50;              // ms entre deux pas de simulation (20 / s)
const SNAP_EVERY = 2;         // un instantané tous les 2 pas (10 / s)
const REJOIN_GRACE = 60000;   // ms pour revenir après une coupure
const MAX_ROOMS = 60;
const MAX_MSG_PER_SEC = 40;
const ROOM_IDLE_END = 120000; // partie sans aucun humain connecté : fermée après 2 min

const rooms = new Map();      // code → salon
const seatsByToken = new Map(); // jeton de reconnexion → { room, seat }
let nextRoomId = 1;

// --- Utilitaires ----------------------------------------------------------
function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}
function clean(str, max) {
  return String(str || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function clamp(v, a, b, d) { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; }
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)];
    if (!rooms.has(s)) return s;
  }
}
const token = () => crypto.randomBytes(12).toString('hex');

// Vue d'un salon pour un joueur donné
function roomView(room, forSeat) {
  return {
    id: room.id, code: room.code, name: room.name, visibility: room.visibility,
    maxPlayers: room.maxPlayers, planets: room.planets, fillBots: room.fillBots,
    status: room.status, host: room.seats[0] ? room.seats[0].pseudo : '',
    youAreHost: room.seats[0] === forSeat,
    players: room.seats.map(s => ({ pseudo: s.pseudo, host: s === room.seats[0], me: s === forSeat })),
  };
}

function broadcastRoster(room) {
  for (const s of room.seats) send(s.ws, { k: 'roster', room: roomView(room, s) });
}

function publicList() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.visibility !== 'public' || r.status === 'over') continue;
    out.push({ id: r.id, name: r.name, host: r.seats[0] ? r.seats[0].pseudo : '?', players: r.seats.length,
      max: r.maxPlayers, planets: r.planets, status: r.status });
  }
  return out;
}

// --- Salons -----------------------------------------------------------------
function createRoom(client, opts) {
  if (rooms.size >= MAX_ROOMS) return send(client.ws, { k: 'error', msg: { k: 'srv.full' } });
  leaveRoom(client);
  const room = {
    id: 'r' + (nextRoomId++), code: makeCode(),
    name: clean(opts.name, 28) || `Partie de ${client.pseudo}`,
    visibility: opts.visibility === 'private' ? 'private' : 'public',
    maxPlayers: clamp(opts.maxPlayers, 2, 6, 4),
    planets: clamp(opts.planets, 5, 9, 7),
    fillBots: opts.fillBots !== false,
    status: 'waiting', seats: [], sim: null, timer: null, tickN: 0, emptySince: null,
  };
  rooms.set(room.code, room);
  seatClient(room, client);
  console.log(`[salon ${room.code}] créé par ${client.pseudo} (${room.visibility})`);
}

function joinRoom(client, room) {
  if (!room) return send(client.ws, { k: 'error', msg: { k: 'srv.noCode' } });
  if (client.seat && client.seat.room === room) return;
  if (room.status !== 'waiting') return send(client.ws, { k: 'error', msg: { k: 'srv.started' } });
  if (room.seats.length >= room.maxPlayers) return send(client.ws, { k: 'error', msg: { k: 'srv.full2' } });
  leaveRoom(client);
  seatClient(room, client);
}

function seatClient(room, client) {
  let pseudo = client.pseudo;
  while (room.seats.some(s => s.pseudo === pseudo)) pseudo = pseudo.slice(0, 14) + crypto.randomInt(1, 10);
  const seat = { room, pseudo, ws: client.ws, client, token: token(), pid: null, goneAt: null,
    account: client.account ? client.account.id : null };
  room.seats.push(seat);
  client.seat = seat;
  seatsByToken.set(seat.token, seat);
  send(client.ws, { k: 'joined', room: roomView(room, seat), token: seat.token });
  broadcastRoster(room);
}

// Le joueur quitte son salon d'attente (ou abandonne sa partie)
function leaveRoom(client, why) {
  const seat = client.seat;
  if (!seat) return;
  client.seat = null;
  const room = seat.room;
  if (room.status === 'waiting') {
    room.seats = room.seats.filter(s => s !== seat);
    seatsByToken.delete(seat.token);
    if (!room.seats.length) closeRoom(room);
    else broadcastRoster(room); // le suivant devient hôte si besoin
  } else if (room.status === 'playing') {
    seat.ws = null; seat.client = null;
    seatsByToken.delete(seat.token);
    if (room.sim && seat.pid !== null) room.sim.botifyPlayer(seat.pid, why || 'parti');
  }
}

function closeRoom(room) {
  clearInterval(room.timer);
  room.status = 'over';
  for (const s of room.seats) seatsByToken.delete(s.token);
  rooms.delete(room.code);
  console.log(`[salon ${room.code}] fermé`);
}

// --- Parties -------------------------------------------------------------
function startRoom(client) {
  const seat = client.seat;
  if (!seat) return;
  const room = seat.room;
  if (room.seats[0] !== seat) return send(client.ws, { k: 'error', msg: { k: 'srv.hostOnly' } });
  if (room.status !== 'waiting') return;
  const humans = room.seats.map(s => s.pseudo);
  const bots = room.fillBots ? Math.max(0, room.maxPlayers - humans.length) : 0;
  if (humans.length + bots < 2) return send(client.ws, { k: 'error', msg: { k: 'srv.needOpponent' } });

  room.sim = startGame({ planets: room.planets, humans, bots });
  room.status = 'playing';
  room.seats.forEach((s, i) => { s.pid = i; });
  const setup = room.sim.systemSetup();
  room.setup = setup;
  for (const s of room.seats) send(s.ws, { k: 'start', setup, you: s.pid });
  let last = Date.now();
  room.timer = setInterval(() => stepRoom(room, () => { const now = Date.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; return dt; }), TICK);
  console.log(`[salon ${room.code}] partie lancée : ${humans.join(', ')} + ${bots} bot(s)`);
}

function stepRoom(room, nextDt) {
  const sim = room.sim;
  const dt = nextDt();
  try {
    if (sim.G.phase !== 'menu' && sim.G.phase !== 'over') sim.update(dt);
  } catch (e) {
    console.error(`[salon ${room.code}] erreur de simulation`, e);
  }
  const now = Date.now();
  // Coupures trop longues : un bot prend la place
  for (const s of room.seats) {
    if (!s.ws && s.goneAt && now - s.goneAt > REJOIN_GRACE) {
      s.goneAt = null;
      seatsByToken.delete(s.token);
      sim.botifyPlayer(s.pid, 'connexion perdue');
    }
  }
  if (sim.G.phase === 'over' && !room.recorded) { room.recorded = true; recordRoom(room); }
  room.tickN++;
  if (room.tickN % SNAP_EVERY === 0) {
    const snap = JSON.stringify(sim.buildSnapshot(false));
    for (const s of room.seats) send(s.ws, snap);
  }
  // Plus aucun humain connecté depuis longtemps, ou partie finie : on ferme
  const anyone = room.seats.some(s => s.ws);
  if (anyone) room.emptySince = null; else room.emptySince = room.emptySince || now;
  if (room.emptySince && now - room.emptySince > (sim.G.phase === 'over' ? 5000 : ROOM_IDLE_END)) closeRoom(room);
}

// Fin de partie : historique et statistiques des joueurs inscrits (Supabase)
function recordRoom(room) {
  if (!supa.enabled() || !room.seats.some(s => s.account)) return;
  const G = room.sim.G;
  const seatOf = pid => room.seats.find(s => s.pid === pid);
  const players = G.players.map(p => {
    const seat = seatOf(p.id);
    return { name: p.name, account: seat ? seat.account : null, human: !!seat,
      won: !!(G.winner && G.winner.id === p.id), eliminated: !p.alive };
  });
  const w = G.winner ? seatOf(G.winner.id) : null;
  supa.recordMatch({ duration: Math.round(G.time), planets: room.planets,
    winner: w && w.account ? w.account : '', winnerName: G.winner ? G.winner.name : null, players })
    .then(ok => { if (ok) console.log(`[salon ${room.code}] partie enregistrée`); });
}

// Retour d'un joueur après une coupure (même onglet ou page rechargée)
function rejoin(client, tok) {
  const seat = seatsByToken.get(tok);
  if (!seat || seat.room.status !== 'playing' || !seat.room.sim) return false;
  const p = seat.room.sim.G.players[seat.pid];
  if (!p || p.isBot) return false;
  if (seat.client && seat.client !== client) { seat.client.seat = null; send(seat.ws, { k: 'closed', msg: { k: 'srv.otherTab' } }); }
  seat.ws = client.ws; seat.client = client; seat.goneAt = null;
  client.seat = seat; client.pseudo = seat.pseudo;
  send(client.ws, { k: 'start', setup: seat.room.setup, you: seat.pid, rejoin: true });
  send(client.ws, seat.room.sim.buildSnapshot(true));
  console.log(`[salon ${seat.room.code}] ${seat.pseudo} est revenu`);
  return true;
}

// --- Connexions --------------------------------------------------------------
// Présentation d'un joueur : compte (jeton Supabase) ou invité (pseudo libre)
async function hello(client, m) {
  let account = null, authError = null;
  if (m.auth && supa.enabled()) {
    account = await supa.verifyUser(String(m.auth));
    if (!account) authError = { k: 'acc.e.session' };
  }
  client.account = account;
  client.pseudo = account ? account.pseudo : (clean(m.pseudo, 16) || 'Pilote');
  // Un invité ne peut pas prendre le pseudo d'un joueur inscrit
  client.reserved = !account && !!(await supa.pseudoOwner(client.pseudo));
  const rejoined = m.token ? rejoin(client, String(m.token)) : false;
  send(client.ws, { k: 'welcome', version: VERSION, rejoined,
    account: account ? { pseudo: account.pseudo } : null, authError, reserved: client.reserved });
}

function onMessage(client, raw) {
  const now = Date.now();
  if (now - client.windowStart > 1000) { client.windowStart = now; client.count = 0; }
  if (++client.count > MAX_MSG_PER_SEC) return; // trop de messages : ignorés
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.k !== 'string') return;

  switch (m.k) {
    case 'hello':
      client.authPending = hello(client, m).catch(e => console.error('hello', e));
      return;
    case 'ping': return;
    case 'list': send(client.ws, { k: 'list', games: publicList() }); return;
    // Création et entrée dans un salon : après vérification du compte / du pseudo
    case 'create': case 'join': case 'joinId':
      client.authPending.then(() => {
        if (client.reserved) return send(client.ws, { k: 'error', msg: { k: 'srv.reserved', p: { name: client.pseudo } } });
        if (m.k === 'create') createRoom(client, m.opts || {});
        else if (m.k === 'join') joinRoom(client, rooms.get(String(m.code || '').toUpperCase()));
        else joinRoom(client, [...rooms.values()].find(r => r.id === m.id));
      });
      return;
    case 'leave': leaveRoom(client); return;
    case 'start': startRoom(client); return;
    case 'bye': leaveRoom(client, 'parti'); return;
    case 'cmd': {
      const seat = client.seat;
      if (!seat || !seat.room.sim || seat.pid === null) return;
      const p = seat.room.sim.G.players[seat.pid];
      if (!p || p.isBot) return;
      let r;
      try { r = seat.room.sim.applyCommand(seat.pid, m.c) || { ok: false }; }
      catch (e) { console.error('commande', e); r = { ok: false, msg: 'Erreur' }; }
      send(client.ws, { k: 'res', id: m.id, r: { ok: !!r.ok, msg: r.msg, launched: r.launched, colonists: r.colonists, accepted: r.accepted, clash: r.clash, free: r.free, cost: r.cost } });
      return;
    }
  }
}

function onClose(client) {
  const seat = client.seat;
  if (!seat) return;
  if (seat.room.status === 'playing') {
    seat.ws = null; seat.client = null; seat.goneAt = Date.now(); // il a 60 s pour revenir
    client.seat = null;
  } else {
    leaveRoom(client);
  }
}

// --- Serveur HTTP (page d'état) + WebSocket ------------------------------------
const server = http.createServer((req, res) => {
  const games = [...rooms.values()];
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({
    ok: true, name: 'Solar Conquest', version: VERSION, accounts: supa.enabled(),
    rooms: games.length, playing: games.filter(r => r.status === 'playing').length,
    players: games.reduce((n, r) => n + r.seats.filter(s => s.ws).length, 0),
  }));
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  const client = { ws, pseudo: 'Pilote', seat: null, windowStart: Date.now(), count: 0, alive: true,
    account: null, reserved: false, authPending: Promise.resolve() };
  ws.on('message', (data) => onMessage(client, data.toString()));
  ws.on('close', () => onClose(client));
  ws.on('error', () => {});
  ws.on('pong', () => { client.alive = true; });
  ws.client = client;
});

// Connexions mortes (ordinateur en veille, réseau coupé) : détectées par ping
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.client.alive) { ws.terminate(); continue; }
    ws.client.alive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Solar Conquest ${VERSION} : serveur prêt sur le port ${PORT}`));
