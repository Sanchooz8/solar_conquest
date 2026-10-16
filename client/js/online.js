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
      if (q) url = q;
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
      this.send({ k: 'hello', pseudo: loadPseudo() || 'Pilote', token: this.loadToken() });
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
      for (const w of this.waiting) { clearTimeout(w.timer); w.resolve({ k: 'error', msg: 'Connexion au serveur perdue.' }); }
      this.waiting = [];
      if (wasOnline && this.inGame && G.phase !== 'over') showToast('Connexion perdue — reconnexion…');
      if (Net.room && Net.room.real && !this.inGame) { Net.room = null; if (G.phase === 'menu') { showScreen('scr-home'); showMenuToast('Connexion au serveur perdue.'); } }
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

  send(m) { if (this.isUp()) this.ws.send(JSON.stringify(m)); },

  // Requête avec réponse attendue (un des types `kinds`)
  request(m, kinds, timeout = 8000) {
    return new Promise(resolve => {
      if (!this.isUp()) { resolve({ k: 'error', msg: this.statusText() }); return; }
      const w = { kinds, resolve };
      w.timer = setTimeout(() => { this.waiting = this.waiting.filter(x => x !== w); resolve({ k: 'error', msg: 'Le serveur ne répond pas.' }); }, timeout);
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
    // Réponses aux requêtes en attente
    const i = this.waiting.findIndex(w => w.kinds.includes(m.k));
    if (i >= 0) { const w = this.waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); }

    switch (m.k) {
      case 'welcome':
        // Reconnexion pendant une partie qui n'existe plus
        if (!m.rejoined && this.inGame && Session.role === 'client' && G.phase !== 'over') {
          this.inGame = false; this.clearToken();
          hostLost("La partie n'est plus disponible (coupure trop longue).");
        }
        return;
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
        if (Session.role === 'client') hostLost(m.msg || 'Partie fermée.');
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

  statusText() {
    if (this.status === 'online') return 'Connecté au serveur';
    const waited = this.firstFail ? (Date.now() - this.firstFail) / 1000 : 0;
    if (waited > 90) return 'Serveur injoignable pour le moment : vous pouvez jouer en solo en attendant.';
    return 'Connexion au serveur… (s\'il était en veille, son réveil peut prendre jusqu\'à une minute)';
  },
};
