// ============================================================
// SOLAR CONQUEST — Écrans d'accueil : pseudo, parties publiques,
// code privé, création de partie, salon d'attente, compte.
// Tout passe par Net (js/net.js) : en local aujourd'hui, en ligne demain.
// ============================================================

const Lobby = { vis: 'public', tab: 'login' };

function showScreen(id) {
  for (const s of ['scr-home', 'scr-create', 'scr-lobby']) el(s).hidden = s !== id;
}

// --- Pseudo ---------------------------------------------------------
function loadPseudo() {
  try { return localStorage.getItem('sc.pseudo') || ''; } catch (e) { return ''; }
}
function savePseudo(p) {
  try { localStorage.setItem('sc.pseudo', p); } catch (e) { /* stockage indisponible : sans conséquence */ }
}

// Valide le pseudo ; affiche l'erreur et place le curseur dans le champ si besoin
function requirePseudo() {
  const input = el('in-pseudo');
  const p = input.value.trim().replace(/\s+/g, ' ');
  let err = '';
  if (p.length < 2) err = 'Choisissez un pseudo de 2 à 16 caractères.';
  else if (!/^[\p{L}\p{N} _.-]+$/u.test(p)) err = 'Lettres, chiffres, espaces, « _ », « - » et « . » uniquement.';
  el('pseudo-err').textContent = err;
  if (err) { input.focus(); return null; }
  input.value = p;
  savePseudo(p);
  return p;
}

// --- Parties publiques ------------------------------------------------
function gameStatusText(g) {
  if (g.mine) return 'Votre salon';
  if (g.status === 'starting') return `Démarre dans ${g.startIn} s`;
  if (g.status === 'playing') return 'En cours';
  return g.players >= g.max ? 'Complète' : 'En attente';
}

async function refreshGames() {
  const box = el('games');
  const r = await Net.listPublicGames();
  const rank = g => (g.status === 'waiting' ? 0 : g.status === 'starting' ? 1 : 2);
  const sorted = r.games.slice().sort((a, b) => rank(a) - rank(b));
  // Parties en cours : seulement les 3 plus récentes, pour garder la liste lisible
  const games = sorted.filter(g => g.status !== 'playing').concat(sorted.filter(g => g.status === 'playing').slice(-3));
  if (!games.length) {
    box.innerHTML = '<div class="games-empty">Aucune partie publique ouverte pour le moment. Créez la vôtre !</div>';
    return;
  }
  // Reconstruit seulement si la liste a changé (évite le clignotement)
  const key = games.map(g => [g.id, g.players, g.status, g.startIn, g.mine].join(':')).join('|');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  for (const g of games) {
    const row = document.createElement('div');
    const open = g.status === 'waiting' && g.players < g.max && !g.mine;
    row.className = 'game-row' + (open ? '' : ' demo');
    row.innerHTML =
      `<div style="min-width:0"><div class="g-name"></div><div class="g-meta"></div></div>` +
      `<span class="g-players">${g.players} / ${g.max}</span>` +
      `<button class="btn-sec"${open ? '' : ' disabled'}>${open ? 'Rejoindre' : gameStatusText(g)}</button>`;
    row.querySelector('.g-name').textContent = g.name;
    row.querySelector('.g-meta').textContent = `Hôte : ${g.host} · ${g.planets} planètes · ${gameStatusText(g)}`;
    row.querySelector('button').addEventListener('click', async () => {
      const p = requirePseudo(); if (!p) return;
      const res = await Net.joinPublic(g.id, p);
      if (!res.ok) { showMenuToast(res.msg); return; }
      renderLobby(); showScreen('scr-lobby');
    });
    box.appendChild(row);
  }
}

function renderNetStatus() {
  if (Net.online()) {
    const up = Online.status === 'online';
    const html = `<span class="led"${up ? ' style="background:#4ade80;box-shadow:0 0 6px #4ade80"' : ''}></span>` + Online.statusText();
    if (el('net-status').dataset.html !== html) { el('net-status').innerHTML = html; el('net-status').dataset.html = html; }
    return;
  }
  el('net-status').innerHTML = Net.online()
    ? '<span class="led" style="background:#4ade80;box-shadow:0 0 6px #4ade80"></span>Connecté au serveur'
    : Net.simulate
      ? '<span class="led"></span>Serveur pas encore en ligne : parties et joueurs simulés par des bots, pour tester.'
      : '<span class="led"></span>Serveur pas encore en ligne : les parties se jouent en local, contre des bots.';
}

// --- Création de partie ---------------------------------------------------
function openCreate() {
  const p = requirePseudo(); if (!p) return;
  if (!el('in-gname').value) el('in-gname').value = `Partie de ${p}`;
  showScreen('scr-create');
  el('in-gname').focus();
}

function setVisibility(v) {
  Lobby.vis = v;
  for (const b of document.querySelectorAll('[data-vis]')) {
    const on = b.dataset.vis === v;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  }
  el('vis-help').textContent = v === 'public'
    ? 'Visible dans la liste des parties publiques ; on peut aussi la rejoindre avec son code.'
    : "Invisible dans la liste : seuls les joueurs qui ont le code peuvent la rejoindre.";
}

async function createRoom() {
  const p = requirePseudo(); if (!p) { showScreen('scr-home'); return; }
  const opts = {
    name: el('in-gname').value.trim() || `Partie de ${p}`,
    visibility: Lobby.vis,
    maxPlayers: parseInt(el('opt-maxp').value),
    planets: parseInt(el('opt-planets').value),
    fillBots: el('opt-fill').checked,
  };
  const r = await Net.createRoom(opts, p);
  if (!r.ok) { showMenuToast(r.msg); return; }
  renderLobby();
  showScreen('scr-lobby');
}

// --- Salon d'attente ---------------------------------------------------------
function renderLobby() {
  const r = Net.room;
  if (!r) return;
  const host = !!r.byPlayer;
  el('lobby-name').textContent = r.name;
  el('lobby-code').textContent = r.code;
  el('lobby-meta').innerHTML = '';
  for (const t of [r.visibility === 'public' ? 'Publique' : 'Privée', `${r.planets} planètes`,
    `${r.maxPlayers} joueurs max`, `Hôte : ${host ? 'vous' : r.host}`, r.fillBots ? 'Bots sur les places libres' : 'Sans bots']) {
    const s = document.createElement('span'); s.textContent = t; el('lobby-meta').appendChild(s);
  }
  const slots = el('lobby-slots');
  const key = r.players.map(p => p.pseudo).join(',') + '|' + r.maxPlayers;
  if (slots.dataset.key !== key) {
    slots.dataset.key = key; slots.innerHTML = '';
    for (let i = 0; i < r.maxPlayers; i++) {
      const pl = r.players[i];
      const d = document.createElement('div');
      d.className = 'slot' + (pl ? '' : ' empty');
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      if (pl) {
        d.innerHTML = `<span class="dot" style="background:${color}"></span><span class="who"></span><span class="role">${pl.host ? 'HÔTE' : ''}</span>`;
        d.querySelector('.who').textContent = pl.pseudo + (pl.me ? ' (vous)' : '');
      } else {
        d.innerHTML = `<span class="dot" style="background:${color};opacity:.35"></span><span class="who">${r.fillBots ? 'Bot au lancement' : 'Place libre'}</span>`;
      }
      slots.appendChild(d);
    }
  }
  const btn = el('btn-start');
  btn.hidden = !host;
  let note;
  if (!host) {
    note = r.status === 'starting'
      ? `La partie démarre dans ${Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000))} s…`
      : `En attente du lancement par ${r.host}. Elle démarre quand le salon est complet, ou quand l'hôte le décide.`;
  } else {
    const others = r.players.length - 1;
    btn.disabled = !r.fillBots && others < 1;
    btn.hidden = false;
    note = btn.disabled ? 'Attendez au moins un autre joueur, ou activez les bots pour lancer.'
      : 'Partagez le code ; lancez quand vous voulez.' + (r.fillBots ? ' Les places libres seront prises par des bots.' : '') +
        (Net.online() ? '' : ' (Test : pour l\'instant, les joueurs peuvent rejoindre depuis un autre onglet de ce navigateur.)');
  }
  if (!r.real && !Net.online() && Net.simulate) note += ' (Joueurs simulés en attendant le serveur.)';
  el('lobby-note').textContent = note;
}

async function copyCode() {
  const code = Net.room ? Net.room.code : '';
  try { await navigator.clipboard.writeText(code); showMenuToast('Code copié', true); }
  catch (e) {
    const r = document.createRange(); r.selectNodeContents(el('lobby-code'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    showMenuToast('Code sélectionné : copiez-le avec Ctrl+C');
  }
}

// Lancer la partie : en local, nouvelle partie contre des bots
async function startFromLobby() {
  const r = await Net.startRoom();
  if (!r.ok) { showMenuToast(r.msg); return; }
  if (r.pending) return; // en ligne : le serveur annonce le lancement
  if (r.network) { startHostGame(RealRoom.transport, r.room); return; }
  startLocalGame(r.planets, r.bots, r.opponents);
}

// Nouvelle partie simulée ici (solo, ou hôte d'une partie en réseau).
// names : pseudos portés par les bots ; humans : joueurs humains (hôte en tête)
function startLocalGame(planets, bots, names = [], humans = null) {
  const pseudo = loadPseudo() || 'Vous';
  const hs = humans || [pseudo];
  const maxBots = Math.max(0, 6 - hs.length);
  newGame(planets, Math.max(hs.length > 1 ? 0 : 1, Math.min(maxBots, bots)), hs);
  const botIds = G.players.filter(p => p.isBot).map(p => p.id);
  names.slice(0, botIds.length).forEach((n, i) => { G.players[botIds[i]].name = n; });
  enterGameScreen();
}

// Passage du menu à l'écran de jeu (commun à l'hôte, au solo et aux clients)
function enterGameScreen() {
  fitCamera();
  el('menu').hidden = true;
  el('hud').hidden = false;
  el('endscreen').hidden = true;
  showPrompt('Cliquez sur une planète pour la <strong>verrouiller</strong>, puis sur un territoire de sa couronne pour fonder votre colonie.');
  UI.lock = null; UI.targetZoom = null; UI.placing = null;
  UI.aiming = false; UI.aimingColony = false; UI.aimingFleet = null;
  UI.missileCount = 1; UI.colonyShare = 0.25; UI.defeatShown = false; UI.founding = false;
}

// --- Compte -------------------------------------------------------------
function openAccount() {
  el('acct').hidden = false;
  setAcctTab(Lobby.tab);
  el('acct-err').textContent = '';
}
function closeAccount() { el('acct').hidden = true; el('btn-account').focus(); }

function setAcctTab(tab) {
  Lobby.tab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  }
  for (const f of document.querySelectorAll('.reg-only')) f.hidden = tab !== 'register';
  el('acct-submit').textContent = tab === 'register' ? 'CRÉER MON COMPTE' : 'SE CONNECTER';
  el('in-pass').autocomplete = tab === 'register' ? 'new-password' : 'current-password';
  if (tab === 'register' && !el('in-rpseudo').value) el('in-rpseudo').value = loadPseudo();
  el('acct-err').textContent = '';
}

async function submitAccount(e) {
  e.preventDefault();
  const email = el('in-email').value.trim(), pass = el('in-pass').value;
  let err = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err = 'Saisissez une adresse e-mail valide.';
  else if (pass.length < 8) err = 'Le mot de passe doit contenir au moins 8 caractères.';
  else if (Lobby.tab === 'register') {
    const rp = el('in-rpseudo').value.trim();
    if (rp.length < 2) err = 'Choisissez un pseudo de 2 à 16 caractères.';
    else if (pass !== el('in-pass2').value) err = 'Les deux mots de passe ne correspondent pas.';
  }
  if (err) { el('acct-err').textContent = err; return; }
  const r = Lobby.tab === 'register'
    ? await Net.register(el('in-rpseudo').value.trim(), email, pass)
    : await Net.login(email, pass);
  if (!r.ok) { el('acct-err').textContent = r.msg; return; }
  Net.account = r.account; renderAccountChip(); closeAccount();
}

function renderAccountChip() {
  const a = Net.account;
  el('btn-account').textContent = a ? `${a.pseudo} · Mon compte` : "Se connecter · S'inscrire";
  document.querySelector('.acct-hint').textContent = a ? 'statistiques enregistrées' : 'pour conserver vos statistiques';
}

// Petit message sous les écrans d'accueil (réutilise le toast du jeu)
function showMenuToast(msg, ok) { showToast(msg, ok); }

// --- Branchements ---------------------------------------------------------
function initLobby() {
  el('in-pseudo').value = loadPseudo();
  el('in-pseudo').addEventListener('input', () => { el('pseudo-err').textContent = ''; });
  el('in-pseudo').addEventListener('keydown', e => { if (e.key === 'Enter') openCreate(); });

  el('btn-refresh').addEventListener('click', refreshGames);
  el('in-code').addEventListener('input', () => {
    el('in-code').value = el('in-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  const join = async () => {
    const p = requirePseudo(); if (!p) return;
    const r = await Net.joinByCode(el('in-code').value, p);
    if (!r.ok) { showMenuToast(r.msg); return; }
    renderLobby(); showScreen('scr-lobby');
  };
  el('btn-join-code').addEventListener('click', join);
  el('in-code').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

  el('btn-create').addEventListener('click', openCreate);
  el('btn-solo').addEventListener('click', () => { if (requirePseudo()) startLocalGame(7, 3); });

  for (const b of document.querySelectorAll('[data-vis]')) b.addEventListener('click', () => setVisibility(b.dataset.vis));
  el('opt-maxp').addEventListener('input', () => el('val-maxp').textContent = el('opt-maxp').value);
  el('opt-planets').addEventListener('input', () => el('val-planets').textContent = el('opt-planets').value);
  el('btn-create-back').addEventListener('click', () => showScreen('scr-home'));
  el('btn-create-go').addEventListener('click', createRoom);

  el('btn-copy-code').addEventListener('click', copyCode);
  el('btn-lobby-leave').addEventListener('click', async () => { await Net.leaveRoom(); showScreen('scr-home'); refreshGames(); });
  el('btn-start').addEventListener('click', startFromLobby);

  el('btn-account').addEventListener('click', openAccount);
  el('acct-close').addEventListener('click', closeAccount);
  el('acct').addEventListener('mousedown', e => { if (e.target === el('acct')) closeAccount(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !el('acct').hidden) closeAccount(); });
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => setAcctTab(b.dataset.tab));
  el('acct-form').addEventListener('submit', submitAccount);
  el('btn-google').addEventListener('click', async () => {
    const r = await Net.googleSignIn();
    if (!r.ok) el('acct-err').textContent = r.msg;
  });

  setVisibility('public');
  Net.init(); // en ligne si un serveur est configuré
  // Serveur simulé (mode local uniquement) : la liste et le salon se mettent à jour d'eux-mêmes
  Sim.start();
  Net.onLaunch = (info) => {
    if (G.phase !== 'menu') return;
    showMenuToast(`« ${info.name} » démarre !`, true);
    startLocalGame(info.planets, info.bots, info.opponents);
  };
  setInterval(() => {
    if (el('menu').hidden) return;
    renderNetStatus();
    if (!el('scr-home').hidden) refreshGames();
    if (!el('scr-lobby').hidden) {
      if (!Net.room || (!Net.room.real && !Sim.games.includes(Net.room))) { Net.room = null; showScreen('scr-home'); showMenuToast('Le salon a fermé.'); refreshGames(); }
      else renderLobby();
    }
  }, 1000);
  renderNetStatus();
  renderAccountChip();
  refreshGames();
  showScreen('scr-home');
}
