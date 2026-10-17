// ============================================================
// SOLAR CONQUEST — Couche réseau (salons, comptes)
// Toute l'interface passe par cet objet. Aujourd'hui il fonctionne en
// mode LOCAL (pas de serveur) : un serveur vivant est SIMULÉ (joueurs
// fictifs qui créent, rejoignent et lancent des parties) ; les comptes
// renvoient « serveur hors ligne ». Quand le serveur existera, seul ce
// fichier changera : mêmes fonctions, mêmes réponses, et Net.simulate
// passera à false (de vrais joueurs ne doivent pas croire jouer contre
// des humains).
// ============================================================

const Net = {
  mode: 'local',        // 'local' | 'online'
  simulate: true,       // en local : salons et joueurs simulés par des bots (à couper en ligne)
  room: null,           // salon courant { id, code, name, visibility, maxPlayers, planets, fillBots, players, host, status, startAt }
  account: null,        // compte connecté { pseudo, email, provider, stats } ou null
  onLaunch: null,       // appelé quand la partie du salon courant démarre (hôte simulé)

  online() { return this.mode === 'online'; },

  // Mode en ligne si une adresse de serveur est configurée (cf. js/online.js)
  init() {
    if (Online.init()) { this.mode = 'online'; this.simulate = false; }
  },

  // --- Salons ------------------------------------------------------
  // Liste des parties publiques ouvertes
  async listPublicGames() {
    if (this.online()) {
      // Une seule requête à la fois ; sinon on garde la dernière liste connue
      if (!Online.listPending && Online.isUp()) {
        Online.listPending = Online.request({ k: 'list' }, ['list'], 5000).then(m => {
          Online.listPending = null;
          if (m.k === 'list') Online.listCache = m.games;
        });
      }
      const mine = this.room && this.room.id;
      return { ok: true, simulated: false, games: Online.listCache.map(g => ({ ...g, startIn: null, mine: g.id === mine })) };
    }
    if (!this.online()) {
      const games = Sim.games.filter(g => g.visibility === 'public').map(g => ({
        id: g.id, name: g.name, host: g.host, players: g.players.length, max: g.maxPlayers,
        planets: g.planets, status: g.status, startIn: g.startAt ? Math.max(0, Math.ceil((g.startAt - Date.now()) / 1000)) : null,
        mine: !!(this.room && this.room.id === g.id),
      }));
      return { ok: true, simulated: this.simulate, games };
    }
  },

  // Rejoindre une partie privée avec son code : d'abord un vrai salon
  // ouvert par un autre joueur, sinon un salon simulé
  async joinByCode(code, pseudo) {
    if (!/^[A-Z0-9]{4,6}$/.test(code)) return { ok: false, msg: 'Le code contient 4 à 6 lettres ou chiffres.' };
    if (this.online()) return this.onlineJoin({ k: 'join', code }, pseudo);
    const real = await RealRoom.join(code, pseudo);
    if (real.ok || real.msg) return real;
    if (!this.online()) {
      const g = Sim.games.find(x => x.code === code);
      if (!g) return { ok: false, msg: `Aucune partie ne correspond au code ${code}.` };
      return Sim.join(g, pseudo);
    }
  },

  // Rejoindre une partie publique de la liste
  async joinPublic(gameId, pseudo) {
    if (this.online()) return this.onlineJoin({ k: 'joinId', id: gameId }, pseudo);
    if (!this.online()) {
      const g = Sim.games.find(x => x.id === gameId);
      if (!g) return { ok: false, msg: "Cette partie n'existe plus." };
      return Sim.join(g, pseudo);
    }
  },

  // Créer un salon (l'hôte choisit les options)
  // Demande au serveur : rejoindre ou créer un salon
  async onlineJoin(msg, pseudo) {
    if (Online.mismatch) return { ok: false, msg: Online.mismatchText() };
    await Online.sendHello(pseudo);
    const m = await Online.request(msg, ['joined', 'error']);
    if (m.k !== 'joined') return { ok: false, msg: m.msg };
    return { ok: true, room: this.room };
  },

  async createRoom(opts, pseudo) {
    if (this.online()) return this.onlineJoin({ k: 'create', opts }, pseudo);
    const g = Sim.newGame({ ...opts, host: pseudo, byPlayer: true });
    g.players = [{ pseudo, host: true, me: true }];
    this.room = g;
    RealRoom.open(g); // salon réel : d'autres joueurs peuvent le rejoindre avec le code
    return { ok: true, room: g };
  },

  async leaveRoom() {
    const g = this.room;
    this.room = null;
    if (this.online()) { Online.send({ k: 'leave' }); Online.clearToken(); return { ok: true }; }
    RealRoom.leave();
    if (g && g.real) return { ok: true };
    if (g) {
      if (g.byPlayer) Sim.remove(g); // l'hôte part : le salon ferme
      else g.players = g.players.filter(p => !p.me);
    }
    return { ok: true };
  },

  // Lancer la partie (hôte). En local : les autres joueurs deviennent des bots
  // qui portent leurs pseudos, les places libres sont complétées si demandé.
  async startRoom() {
    const r = this.room;
    if (!r) return { ok: false, msg: 'Aucun salon' };
    if (this.online()) {
      // Le serveur lance la partie et l'annonce à tous (message « start »)
      const m = await Online.request({ k: 'start' }, ['start', 'error']);
      return m.k === 'error' ? { ok: false, msg: m.msg } : { ok: true, pending: true };
    }
    // Salon réel avec d'autres joueurs humains : partie en réseau
    if (r.byPlayer && r.players.some(p => p.peer)) {
      if (!r.fillBots && r.players.length < 2) return { ok: false, msg: 'Il faut au moins un adversaire.' };
      r.status = 'playing'; r.playingUntil = Date.now() + 60000;
      this.room = null;
      return { ok: true, network: true, room: r };
    }
    RealRoom.leave();
    const others = r.players.filter(p => !p.me).map(p => p.pseudo);
    const fill = r.fillBots ? Math.max(0, r.maxPlayers - 1 - others.length) : 0;
    if (others.length + fill < 1) return { ok: false, msg: 'Il faut au moins un adversaire : attendez un joueur ou activez les bots.' };
    r.status = 'playing'; r.playingUntil = Date.now() + 60000;
    this.room = null;
    return { ok: true, local: true, planets: r.planets, opponents: others, bots: others.length + fill };
  },

  // --- Comptes ---------------------------------------------------------
  // Comptes (Supabase, cf. js/account.js)
  async login(email, password) {
    if (!Account.enabled()) return { ok: false, msg: 'Les comptes arrivent bientôt : pour l\'instant, un pseudo suffit pour jouer.' };
    return Account.login(email, password);
  },
  async register(pseudo, email, password) {
    if (!Account.enabled()) return { ok: false, msg: 'Les comptes arrivent bientôt : pour l\'instant, un pseudo suffit pour jouer.' };
    return Account.register(pseudo, email, password);
  },
  async googleSignIn() {
    return { ok: false, msg: 'La connexion Google arrive bientôt.' };
  },
  async logout() { this.account = null; return { ok: true }; },
};

// ============================================================
// Simulation locale d'un serveur vivant (mode local uniquement)
// Des joueurs fictifs créent des parties, les rejoignent et les lancent ;
// ils rejoignent aussi le salon du joueur. Coupé par Net.simulate = false.
// ============================================================
const SIM_NAMES = ['Orion', 'Lyra', 'Vega', 'NovaX', 'Kestrel', 'Zephyr', 'Astra_7', 'Mira', 'Draco', 'Helios',
  'Nebulon', 'Quasar', 'Tycho', 'Sirius', 'Calypso', 'Rigel', 'Andromeda', 'Polaris', 'Cosmo42', 'Ixion',
  'Kaïa', 'Lunaire', 'Stellar_Fox', 'Titan', 'Nyx', 'Pulsar', 'Altaïr', 'Comète', 'Gaïa', 'Hyperion'];
const SIM_TITLES = ['Conquête du dimanche', 'Débutants bienvenus', 'Blitz rapide', 'Guerre des anneaux',
  'Pas de trahison svp', 'Partie détente', 'Cratères à volonté', 'Alliance ou rien', 'Système de Kepler',
  'Revanche !', 'Ceinture de feu', '1v1v1v1', 'Grands espaces', 'Commerce et missiles'];

const Sim = {
  games: [],
  nextId: 1,
  last: 0,

  pick(list) { return list[Math.floor(Math.random() * list.length)]; },

  // Pseudo libre (pas déjà dans la partie, ni le pseudo du joueur)
  // Joueurs simulés déjà occupés (dans un salon en attente ou une partie)
  busyNames() {
    const busy = new Set();
    for (const x of this.games) for (const p of x.players) busy.add(p.pseudo);
    return busy;
  },

  freeName(g) {
    const taken = this.busyNames();
    for (const p of g.players) taken.add(p.pseudo);
    const pool = SIM_NAMES.filter(n => !taken.has(n));
    return pool.length ? this.pick(pool) : 'Pilote' + Math.floor(Math.random() * 900 + 100);
  },

  newGame(o) {
    const g = {
      id: 'g' + (this.nextId++), code: makeRoomCode(),
      name: o.name, visibility: o.visibility || 'public', host: o.host,
      maxPlayers: o.maxPlayers, planets: o.planets, fillBots: o.fillBots ?? true,
      players: [], status: 'waiting', createdAt: Date.now(),
      startAt: null, playingUntil: null, byPlayer: !!o.byPlayer,
      // l'hôte simulé lance quand le salon est plein, ou au bout d'un moment
      patience: 35000 + Math.random() * 60000,
    };
    this.games.push(g);
    return g;
  },

  spawn() {
    const host = this.freeName({ players: [] }); // un joueur ne gère qu'une partie à la fois
    const g = this.newGame({
      name: Math.random() < 0.4 ? `Partie de ${host}` : this.pick(SIM_TITLES),
      visibility: Math.random() < 0.85 ? 'public' : 'private',
      host, maxPlayers: 2 + Math.floor(Math.random() * 5), planets: 5 + Math.floor(Math.random() * 5),
    });
    g.players.push({ pseudo: host, host: true });
    const extra = Math.floor(Math.random() * Math.min(2, g.maxPlayers - 1));
    for (let i = 0; i < extra; i++) g.players.push({ pseudo: this.freeName(g) });
  },

  remove(g) { this.games = this.games.filter(x => x !== g); },

  join(g, pseudo) {
    if (g.status !== 'waiting') return { ok: false, msg: g.status === 'playing' ? 'Cette partie est déjà en cours.' : 'Cette partie démarre, trop tard pour la rejoindre.' };
    if (g.players.length >= g.maxPlayers) return { ok: false, msg: 'Cette partie est complète.' };
    if (Net.room) Net.leaveRoom();
    g.players.push({ pseudo, me: true });
    Net.room = g;
    return { ok: true, room: g };
  },

  // Une seconde de vie du « serveur »
  tick() {
    const now = Date.now();
    const waitingPublic = this.games.filter(g => g.visibility === 'public' && g.status === 'waiting' && !g.byPlayer).length;
    if (waitingPublic < 3 || (waitingPublic < 6 && Math.random() < 0.08)) this.spawn();

    for (const g of this.games.slice()) {
      const mine = Net.room === g;
      if (g.status === 'waiting') {
        // Arrivées et départs de joueurs simulés
        // Le salon du joueur n'accueille plus de joueurs simulés : de vrais
        // joueurs peuvent le rejoindre avec le code
        const rate = g.byPlayer ? 0 : 0.07;
        if (g.players.length < g.maxPlayers && Math.random() < rate) g.players.push({ pseudo: this.freeName(g) });
        const leavers = g.players.filter(p => !p.host && !p.me);
        if (leavers.length && Math.random() < 0.015) { const out = this.pick(leavers); g.players = g.players.filter(p => p !== out); }
        // Lancement par l'hôte simulé (le joueur, lui, lance quand il veut)
        if (!g.byPlayer && (g.players.length >= g.maxPlayers || (now - g.createdAt > g.patience && g.players.length >= 2))) {
          g.status = 'starting'; g.startAt = now + 5000;
        }
      } else if (g.status === 'starting' && now >= g.startAt) {
        g.status = 'playing'; g.playingUntil = now + 20000 + Math.random() * 40000;
        if (mine) {
          Net.room = null;
          const others = g.players.filter(p => !p.me).map(p => p.pseudo);
          if (Net.onLaunch) Net.onLaunch({ planets: g.planets, opponents: others, bots: others.length, name: g.name });
        }
      } else if (g.status === 'playing' && now >= g.playingUntil) {
        this.remove(g); // partie terminée : elle quitte la liste
      }
      // Un salon simulé vide disparaît
      if (!g.byPlayer && g.status === 'waiting' && !g.players.some(p => p.host)) this.remove(g);
    }
  },

  start() {
    if (!Net.simulate || Net.online()) return;
    for (let i = 0; i < 4; i++) this.spawn();
    // quelques parties déjà en cours, pour un serveur qui a l'air vivant
    for (const g of this.games.slice(0, 1)) { g.status = 'playing'; g.playingUntil = Date.now() + 25000; }
    setInterval(() => this.tick(), 1000);
  },
};

// Code de salon : 4 caractères faciles à dicter (sans 0/O ni 1/I)
function makeRoomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// ============================================================
// Salons réels (entre navigateurs) : protocole du salon d'attente
//   client → hôte : join {pseudo} · leave · ping
//   hôte → client : welcome {room} · refuse {msg} · roster {players} · start {setup, you} · bye
// Puis la partie elle-même passe par Session (js/session.js).
// ============================================================
const RealRoom = {
  transport: null,
  role: null,          // 'host' | 'client'
  room: null,
  hostPeer: null,
  seen: new Map(),
  timer: null,

  makeTransport(code) { return makeTabTransport(code); },

  // --- Hôte -----------------------------------------------------------
  open(room) {
    this.leave();
    this.role = 'host'; this.room = room;
    this.transport = this.makeTransport(room.code);
    this.transport.onMessage((peer, m) => this.onMessage(peer, m));
    this.timer = setInterval(() => this.prune(), 1000);
  },

  roster() {
    return this.room.players.map(p => ({ pseudo: p.pseudo, host: !!p.host }));
  },

  broadcastRoster() {
    for (const p of this.room.players) if (p.peer) {
      this.transport.send(p.peer, { k: 'roster', players: this.room.players.map(q => ({ pseudo: q.pseudo, host: !!q.host, me: q === p })) });
    }
  },

  prune() {
    if (this.role === 'host' && this.room) {
      const now = Date.now();
      const before = this.room.players.length;
      this.room.players = this.room.players.filter(p => !p.peer || now - (this.seen.get(p.peer) || now) < PEER_TIMEOUT);
      if (this.room.players.length !== before) this.broadcastRoster();
    }
    if (this.role === 'client' && this.transport) {
      this.transport.send(this.hostPeer, { k: 'ping' });
      if (Date.now() - (this.seen.get(this.hostPeer) || Date.now()) > PEER_TIMEOUT && Net.room && Net.room.real) {
        this.leave(); Net.room = null;
        showScreen('scr-home'); showMenuToast("L'hôte ne répond plus : le salon a fermé.");
      }
    }
  },

  // --- Client ---------------------------------------------------------
  // Résout { ok: true } si un salon réel répond, { ok: false, msg } s'il
  // refuse, { ok: false } (sans message) si personne ne répond
  join(code, pseudo) {
    this.leave();
    const t = this.makeTransport(code);
    return new Promise(resolve => {
      const done = (r) => { clearTimeout(to); resolve(r); };
      const to = setTimeout(() => { t.close(); done({ ok: false }); }, 1200);
      t.onMessage((peer, m) => {
        if (m.k === 'welcome') {
          this.role = 'client'; this.transport = t; this.hostPeer = peer; this.seen.set(peer, Date.now());
          this.room = Object.assign({}, m.room, { real: true, byPlayer: false, players: m.players });
          Net.room = this.room;
          t.onMessage((p2, m2) => this.onMessage(p2, m2));
          this.timer = setInterval(() => this.prune(), 1000);
          done({ ok: true, room: this.room });
        } else if (m.k === 'refuse') { t.close(); done({ ok: false, msg: m.msg }); }
      });
      t.broadcast({ k: 'join', pseudo });
    });
  },

  leave() {
    clearInterval(this.timer); this.timer = null;
    if (this.transport && !Session.transport) {
      if (this.role === 'client' && this.hostPeer) this.transport.send(this.hostPeer, { k: 'leave' });
      if (this.role === 'host') this.transport.broadcast({ k: 'bye' });
      this.transport.close();
    }
    this.transport = null; this.role = null; this.room = null; this.hostPeer = null; this.seen.clear();
  },

  onMessage(peer, m) {
    this.seen.set(peer, Date.now());
    // Partie lancée : tout passe à la session de jeu
    if (Session.transport === this.transport && Session.role !== 'solo') { sessionMessage(peer, m); return; }
    if (this.role === 'host') {
      const r = this.room;
      if (m.k === 'join') {
        if (r.status !== 'waiting') { this.transport.send(peer, { k: 'refuse', msg: 'Cette partie a déjà commencé.' }); return; }
        if (r.players.some(p => p.peer === peer)) return;
        if (r.players.length >= r.maxPlayers) { this.transport.send(peer, { k: 'refuse', msg: 'Cette partie est complète.' }); return; }
        let pseudo = String(m.pseudo || 'Joueur').slice(0, 16);
        while (r.players.some(p => p.pseudo === pseudo)) pseudo = pseudo.slice(0, 14) + Math.floor(Math.random() * 9 + 1);
        r.players.push({ pseudo, peer });
        const info = { code: r.code, name: r.name, visibility: r.visibility, maxPlayers: r.maxPlayers, planets: r.planets, fillBots: r.fillBots, host: r.host, status: 'waiting' };
        this.transport.send(peer, { k: 'welcome', room: info, players: r.players.map(q => ({ pseudo: q.pseudo, host: !!q.host, me: q.peer === peer })) });
        this.broadcastRoster();
      } else if (m.k === 'leave') {
        r.players = r.players.filter(p => p.peer !== peer);
        this.broadcastRoster();
      }
    } else if (this.role === 'client') {
      if (peer !== this.hostPeer) return;
      if (m.k === 'roster') { this.room.players = m.players; }
      else if (m.k === 'bye') {
        this.leave(); Net.room = null;
        if (G.phase === 'menu') { showScreen('scr-home'); showMenuToast("L'hôte a fermé le salon."); }
      } else if (m.k === 'start') {
        clearInterval(this.timer); this.timer = null;
        Net.room = null;
        startClientGame(this.transport, peer, m.setup, m.you);
        sessionMessage(peer, { k: 'ping' });
      }
    }
  },
};
