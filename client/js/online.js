// ============================================================
// SOLAR CONQUEST — Connexion au serveur de jeu (WebSocket)
//
// Si une adresse de serveur est configurée (CONFIG.server.url, ou
// ?server=wss://… dans l'adresse de la page pour tester), le jeu passe en
// mode EN LIGNE : vraie liste de parties, salons sur le serveur, parties
// simulées par le serveur. Sinon il reste en mode local (solo, salons
// simulés). Le solo ne passe jamais par le serveur.
// ============================================================

const Online = {
  url: '',
  ws: null,
  status: 'off',        // 'off' | 'connecting' | 'online' | 'retrying'
  attempts: 0,
  firstFail: 0,         // première tentative ratée (réveil du serveur)
  waiting: [],          // requêtes en attente de réponse { kinds, resolve, timer }
  listCache: [],
  listPending: null,
  pingTimer: null,
  inGame: false,

  // --- Connexion -----------------------------------------------------------
  init() {
    let url = (typeof CONFIG.server === 'object' && CONFIG.server.url) || '';
    try {
      const q = new URLSearchParams(location.search).get('server');
      if (q) url = q === 'off' ? '' : q; // ?server=off : mode local (tests)
    } catch (e) { /* sans objet */ }
    this.url = url;
    if (!url) return false;
    this.connect();
    return true;
  },

  connect() {
    this.status = this.attempts ? 'retrying' : 'connecting';
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'online'; this.attempts = 0; this.firstFail = 0;
      this.sendHello(null, this.loadToken());
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ k: 'ping' }), 20000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.onMessage(m); };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      const wasOnline = this.status === 'online';
      this.status = 'retrying';
      for (const w of this.waiting) { clearTimeout(w.timer); w.resolve({ k: 'error', msg: T('net.lost') }); }
      this.waiting = [];
      if (wasOnline && this.inGame && G.phase !== 'over') showToast(T('net.reconnecting'));
      if (Net.room && Net.room.real && !this.inGame) { Net.room = null; if (G.phase === 'menu') { showScreen('scr-home'); showMenuToast(T('net.lost')); } }
      this.scheduleRetry();
    };
    ws.onerror = () => {};
  },

  scheduleRetry() {
    this.attempts++;
    if (!this.firstFail) this.firstFail = Date.now();
    setTimeout(() => this.connect(), Math.min(5000, 1000 + this.attempts * 700));
  },

  isUp() { return this.ws && this.ws.readyState === 1; },

  // Présentation au serveur : pseudo d'invité, ou jeton du compte connecté
  async sendHello(pseudo, rejoinToken) {
    const auth = Account.enabled() && Account.session ? await Account.token() : null;
    this.awaitingRejoin = !!rejoinToken;
    this.send({ k: 'hello', pseudo: pseudo || loadPseudo() || 'Pilot', auth: auth || undefined, token: rejoinToken || undefined });
  },

  send(m) { if (this.isUp()) this.ws.send(JSON.stringify(m)); },

  // Requête avec réponse attendue (un des types `kinds`)
  request(m, kinds, timeout = 8000) {
    return new Promise(resolve => {
      if (!this.isUp()) { resolve({ k: 'error', msg: this.statusText() }); return; }
      const w = { kinds, resolve };
      w.timer = setTimeout(() => { this.waiting = this.waiting.filter(x => x !== w); resolve({ k: 'error', msg: T('net.noAnswer') }); }, timeout);
      this.waiting.push(w);
      this.send(m);
    });
  },

  // --- Jeton de reconnexion (survit à un rechargement de la page) ------------
  saveToken(t) { try { sessionStorage.setItem('sc.token', t); } catch (e) { /* sans objet */ } },
  loadToken() { try { return sessionStorage.getItem('sc.token') || null; } catch (e) { return null; } },
  clearToken() { try { sessionStorage.removeItem('sc.token'); } catch (e) { /* sans objet */ } },

  // --- Messages du serveur ---------------------------------------------------------
  onMessage(m) {
    // Messages du serveur : jetons { k, p } traduits dans la langue du joueur
    if (m && m.msg && typeof m.msg === 'object') m.msg = txt(m.msg);
    // Réponses aux requêtes en attente
    const i = this.waiting.findIndex(w => w.kinds.includes(m.k));
    if (i >= 0) { const w = this.waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); }

    switch (m.k) {
      case 'welcome': {
        if (m.authError && Account.session) { Account.clearSession(); onAccountChange(); showMenuToast(txt(m.authError)); }
        // Jeu et serveur doivent être à la même version
        const before = this.serverVersion;
        this.serverVersion = m.version || null;
        this.mismatch = APP_VERSION !== 'dev' && !!m.version && m.version !== APP_VERSION;
        // Reconnexion pendant une partie qui n'existe plus
        const askedRejoin = this.awaitingRejoin; this.awaitingRejoin = false;
        if (askedRejoin && !m.rejoined && this.inGame && Session.role === 'client' && G.phase !== 'over') {
          this.inGame = false; this.clearToken();
          hostLost(before && before !== m.version
            ? T('net.updatedMidGame')
            : T('net.gameGone'));
        }
        if (this.mismatch && G.phase === 'menu') renderNetStatus();
        return;
      }
      case 'joined':
        this.saveToken(m.token);
        this.setRoom(m.room);
        return;
      case 'roster':
        if (Net.room && Net.room.real && Net.room.code === m.room.code) this.setRoom(m.room);
        return;
      case 'start':
        this.inGame = true;
        Net.room = null;
        startClientGame(this.transport, 'server', m.setup, m.you);
        Session.lastSeen.set('server', Date.now());
        Session.rejoining = !!m.rejoin;
        return;
      case 'closed':
        this.inGame = false; this.clearToken();
        if (Session.role === 'client') hostLost(m.msg || T('net.closed'));
        return;
    }
    if (Session.role === 'client' && (m.k === 'snap' || m.k === 'res' || m.k === 'bye')) {
      if (m.k === 'snap' && m.ph === 'over') { this.inGame = false; this.clearToken(); }
      sessionMessage('server', m);
    }
  },

  setRoom(view) {
    Net.room = Object.assign({}, view, { real: true, online: true, byPlayer: view.youAreHost });
  },

  // Transport utilisé par la session de jeu (cf. js/session.js)
  transport: {
    id: 'me', kind: 'ws',
    send(peer, m) { Online.send(m); },
    broadcast(m) { Online.send(m); return 0; },
    onMessage() {},
    close() { Online.inGame = false; Online.clearToken(); }, // la connexion reste ouverte pour le menu
  },

  mismatchText() {
    return T('net.mismatch', { game: APP_VERSION, server: this.serverVersion });
  },

  statusText() {
    if (this.status === 'online' && this.mismatch) return this.mismatchText();
    if (this.status === 'online') return T('net.online');
    const waited = this.firstFail ? (Date.now() - this.firstFail) / 1000 : 0;
    if (waited > 90) return T('net.unreachable');
    return T('net.connecting');
  },
};
