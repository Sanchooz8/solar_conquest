// ============================================================
// SOLAR CONQUEST — Interface : menu, HUD, interactions
// ============================================================

const el = (id) => document.getElementById(id);
let hudTimer = 0;
let toastTimer = null;

// --- Menu -------------------------------------------------------
function initMenu() {
  initLobby(); // accueil : pseudo, parties, création, salon, compte (js/lobby.js)

  el('btn-restart').addEventListener('click', () => {
    Session.close(); // quitte la partie réseau éventuelle
    G.phase = 'menu';
    UI.defeatShown = false;
    el('endscreen').hidden = true;
    el('hud').hidden = true;
    el('menu').hidden = false;
    showScreen('scr-home');
    refreshGames();
    UI.lock = null;
    UI.targetZoom = null;
    UI.placing = null;
    UI.aiming = false;
    UI.aimingColony = false;
    UI.aimingFleet = null;
  });

  initBuildbar();
  initMissilebar();
}

// --- Prompt & toast ----------------------------------------------
function showPrompt(html) { el('prompt').innerHTML = html; el('prompt').hidden = false; }
function hidePrompt() { el('prompt').hidden = true; }

function showToast(msg, ok) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.toggle('ok', !!ok);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// --- Fin de partie --------------------------------------------------
function showEndScreen(winner) {
  const mine = playerTerritories(G.me);
  const mins = Math.floor(G.time / 60), secs = Math.floor(G.time % 60);
  el('endscreen').hidden = false;
  if (winner && winner.id === G.me) {
    el('end-kicker').textContent = 'PARTIE TERMINÉE';
    el('end-title').textContent = 'VICTOIRE';
    el('end-sub').textContent = `Vous contrôlez ${mine} territoires sur ${G.cellsTotal}. Durée : ${mins} min ${secs} s.`;
  } else if (G.players[G.me] && G.players[G.me].alive && G.phase === 'over') {
    el('end-kicker').textContent = 'PARTIE TERMINÉE';
    el('end-title').textContent = 'DÉFAITE';
    el('end-sub').textContent = winner ? `${winner.name} remporte la partie. Durée : ${mins} min ${secs} s.` : `Durée : ${mins} min ${secs} s.`;
  } else {
    const humansLeft = G.players.some(p => !p.isBot && p.alive && p.id !== G.me);
    el('end-kicker').textContent = 'VOTRE COLONIE A ÉTÉ ÉLIMINÉE';
    el('end-title').textContent = 'DÉFAITE';
    el('end-sub').textContent = `Vous avez survécu ${mins} min ${secs} s. ` +
      (winner ? `${winner.name} remporte la partie.` : humansLeft ? 'La partie continue pour les autres joueurs.' : 'Le système appartient aux IA.');
  }
}

// --- HUD -------------------------------------------------------------
function updateHUD() {
  const me = G.players[G.me];
  el('stat-money').textContent = Math.floor(me.money) + ' $';

  // Population : actuelle / plafond total + vitesse de croissance réelle (courbe logistique)
  // Argent : revenu proportionnel à la population réelle + industries
  let pop = 0, cap = 0, growth = 0, income = 0;
  for (const c of ownedCells(G.me)) {
    pop += c.pop;
    cap += cellCap(c);
    income += c.pop * CONFIG.econ.incomePerPop + (c.building === 'industry' ? CONFIG.econ.industryIncome : 0);
    if (!c.contest) growth += cellPopGrowth(c);
  }
  el('stat-pop').textContent = Math.floor(pop);
  el('stat-popmax').textContent = '/ ' + cap;
  el('stat-growth').textContent = (growth >= 0 ? '+' : '−') + Math.abs(growth).toFixed(1) + '/s';
  el('stat-moneygrowth').textContent = '+' + income.toFixed(1) + '/s';

  // Bâtiments du joueur : icônes + nombre, types absents masqués
  const bc = {};
  for (const c of ownedCells(G.me)) if (c.building) bc[c.building] = (bc[c.building] || 0) + 1;
  fillBuildingIcons(el('tb-buildings'), bc);
}

// --- Volet d'information planète (haut à droite) --------------------------
// Sur la planète survolée ; à défaut, sur la planète verrouillée.
function updatePlanetInfo() {
  const panel = el('planetinfo');
  const p = UI.hoverPlanet || UI.lock;
  if (!p || G.phase === 'menu' || G.phase === 'over') { panel.hidden = true; return; }
  panel.hidden = false;
  el('pi-name').textContent = p.name;

  let total = 0, totalCap = 0;
  const perPlayer = new Map(), perCap = new Map();
  const bc = {};
  for (const c of planetCells(p)) {
    if (c.destroyed) continue;
    total += c.pop;
    if (c.owner !== null) {
      perPlayer.set(c.owner, (perPlayer.get(c.owner) || 0) + c.pop);
      perCap.set(c.owner, (perCap.get(c.owner) || 0) + cellCap(c));
      totalCap += cellCap(c);
    }
    if (c.building) bc[c.building] = (bc[c.building] || 0) + 1;
  }
  // Population / population max (somme des plafonds des territoires occupés)
  el('pi-pop').innerHTML = `${Math.floor(total)}<span class="pi-max"> / ${totalCap}</span>`;

  // Population par joueur (à la couleur du joueur), triée décroissante
  const rows = [...perPlayer.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, ppop]) => {
      const pl = G.players[id];
      return `<div class="pi-player"><span class="dot" style="background:${pl.color}"></span>` +
        `<span>${pl.name}</span><b>${Math.floor(ppop)}<span class="pi-max"> / ${perCap.get(id)}</span></b></div>`;
    }).join('');
  el('pi-players').innerHTML = rows ||
    '<div class="pi-player"><span>Aucune colonie</span></div>';

  fillBuildingIcons(el('pi-buildings'), bc);
}

// Icônes de bâtiments avec leur nombre ; les types absents ne sont pas affichés
const BUILDING_ORDER = ['city', 'industry', 'silo', 'shield', 'colony', 'tradeport', 'military', 'aa', 'spaceport'];
function fillBuildingIcons(box, counts) {
  const key = BUILDING_ORDER.map(t => counts[t] || 0).join(',');
  if (box.dataset.key === key) return; // inchangé : pas de reconstruction
  box.dataset.key = key;
  const parts = BUILDING_ORDER.filter(t => counts[t]).map(t =>
    `<span class="bico" title="${BUILDING_LABELS[t]}"><img src="${BUILDING_ICONS[t]}" alt="${BUILDING_LABELS[t]}">${counts[t]}</span>`);
  box.innerHTML = parts.length ? parts.join('') : '<span class="tb-empty">Aucun bâtiment</span>';
}

// Raccourcis 1 à 0 : boutons du bas, de gauche à droite
// (1–9 : bâtiments ; 0 : lancement de missiles)
const HOTKEY_BUTTONS = [...BUILDING_ORDER.map(t => 'bb-' + t), 'btn-launch'];
function hotkeyButton(code) {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (!m) return null;
  const n = m[1] === '0' ? 9 : parseInt(m[1]) - 1;
  return HOTKEY_BUTTONS[n] ? el(HOTKEY_BUTTONS[n]) : null;
}

// Les deux barres du bas ne se chevauchent jamais : la barre de
// construction se replie sur plusieurs lignes si la place manque
function layoutBottomBars() {
  const bb = el('buildbar'), mb = el('missilebar');
  const right = mb.hidden ? 0 : mb.offsetWidth + 10;
  bb.style.maxWidth = Math.max(160, innerWidth - right - 30) + 'px';
  el('toast').style.bottom = ((bb.hidden ? 0 : bb.offsetHeight) + 22) + 'px';
}

// --- Barre de construction (bas d'écran) -------------------------------
const BUILDING_LABELS = { city: 'Ville', industry: 'Industrie', silo: 'Silo', shield: 'Bouclier', colony: 'Colonisation', tradeport: 'Port de commerce', military: 'Base militaire', aa: 'Défense anti-aérienne', spaceport: 'Spatioport' };

function initBuildbar() {
  BUILDING_ORDER.forEach((type, i) => {
    const btn = el('bb-' + type);
    btn.insertAdjacentHTML('afterbegin', `<span class="kbd">${(i + 1) % 10}</span><img class="bbtn-ico" src="${BUILDING_ICONS[type]}" alt="">`);
    btn.title = `${BUILDING_LABELS[type]} — touche ${(i + 1) % 10}`;
  });
  // Vaisseaux en veille : le bouton du spatioport n'apparaît pas
  el('bb-spaceport').hidden = !CONFIG.features.fleets;
  el('btn-launch').insertAdjacentHTML('afterbegin', '<span class="kbd">0</span>');
  el('btn-launch').title = 'Lancement de missiles — touche 0';
  for (const type of BUILDING_ORDER) {
    el('bb-' + type).querySelector('.bbtn-cost').textContent = buildingBaseCost(type) + ' $';
    el('bb-' + type).addEventListener('click', () => {
      UI.placing = UI.placing === type ? null : type; // re-clic = annuler
      UI.aiming = false;
      UI.aimingColony = false;
      UI.aimingFleet = null;
      updateBuildbar();
      updateMissilebar();
      if (UI.placing) showToast('Cliquez sur la planète : construction à l\'emplacement proposé (Maj + clic : choisir le territoire) — Échap pour annuler', true);
    });
  }
}

// Visible dès qu'une planète est verrouillée ; boutons grisés si trop chers.
// Le coût affiché est le VRAI coût courant (×1,10 par bâtiment du même type
// déjà construit sur la planète verrouillée).
function updateBuildbar() {
  const bar = el('buildbar');
  const show = G.phase === 'playing' && UI.lock !== null;
  bar.hidden = !show;
  if (!show) { UI.placing = null; return; }
  const me = G.players[G.me];
  for (const type of ['city', 'industry', 'silo', 'shield', 'colony', 'tradeport', 'military', 'aa', 'spaceport']) {
    const b = el('bb-' + type);
    const cost = buildingCost(UI.lock, type);
    b.querySelector('.bbtn-cost').textContent = cost + ' $';
    b.disabled = me.money < cost;
    b.classList.toggle('active', UI.placing === type);
  }
}

// --- Panneau missiles & colonisation (bas à droite) -------------------
function missileCountNow() { return UI.missileCount ?? Math.max(1, missileMax()); }

function initMissilebar() {
  // Par défaut (null) : le maximum de missiles prêts
  el('ms-minus').addEventListener('click', () => {
    UI.missileCount = Math.max(1, missileCountNow() - 1);
    updateMissilebar();
  });
  el('ms-plus').addEventListener('click', () => {
    const n = missileCountNow() + 1;
    UI.missileCount = n >= missileMax() ? null : n;
    updateMissilebar();
  });
  el('btn-launch').addEventListener('click', () => {
    if (missileMax() === 0) return;
    UI.aiming = !UI.aiming;
    UI.aimingColony = false;
    UI.aimingFleet = null;
    UI.placing = null;
    canvas.style.cursor = UI.aiming ? 'none' : 'default';
    updateBuildbar();
    updateMissilebar();
    if (UI.aiming) showToast('Visez un point de la carte et cliquez pour tirer — Échap pour annuler', true);
  });
  el('co-minus').addEventListener('click', () => {
    UI.colonyShare = Math.max(0.05, UI.colonyShare - 0.05);
    updateMissilebar();
  });
  el('co-plus').addEventListener('click', () => {
    UI.colonyShare = Math.min(0.90, UI.colonyShare + 0.05);
    updateMissilebar();
  });
  el('btn-colony').addEventListener('click', () => {
    UI.aimingColony = !UI.aimingColony;
    UI.aiming = false;
    UI.aimingFleet = null;
    UI.placing = null;
    canvas.style.cursor = UI.aimingColony ? 'none' : 'default';
    updateBuildbar();
    updateMissilebar();
    if (UI.aimingColony) showToast("Approchez le viseur d'une planète : il s'accroche à son pourtour. Cliquez sur le point d'atterrissage — Échap pour annuler", true);
  });
  // Vaisseaux
  el('fl-minus').addEventListener('click', () => {
    const stock = UI.lock ? storedShips(G.me, UI.lock) : 0;
    const cur = UI.fleetCount ?? stock;
    UI.fleetCount = Math.max(1, cur - 1);
    updateMissilebar();
  });
  el('fl-plus').addEventListener('click', () => {
    const stock = UI.lock ? storedShips(G.me, UI.lock) : 0;
    const cur = UI.fleetCount ?? stock;
    UI.fleetCount = cur + 1 >= stock ? null : cur + 1; // au maximum : « tous »
    updateMissilebar();
  });
  el('fl-build').addEventListener('click', () => {
    if (!UI.lock) return;
    issue({ t: 'ship', p: UI.lock.id }, r => {
      if (!r.ok) showToast(r.msg); else showToast(`Vaisseau construit (${r.cost} $)`, true);
      updateMissilebar();
    });
  });
  el('btn-fleet').addEventListener('click', () => {
    if (!UI.lock || storedShips(G.me, UI.lock) === 0) return;
    const on = !(UI.aimingFleet && UI.aimingFleet.mode === 'launch');
    UI.aiming = false; UI.aimingColony = false; UI.placing = null;
    UI.aimingFleet = on ? { mode: 'launch' } : null;
    canvas.style.cursor = on ? 'none' : 'default';
    updateBuildbar();
    updateMissilebar();
    if (on) showToast("Visez une flotte ennemie, ou le pourtour d'une planète (le viseur s'y accroche) — Échap pour annuler", true);
  });
}

// Nombre de silos chargés sur la planète verrouillée (= nb max de missiles)
// Missiles tirables : chargés ET payables (CONFIG.missiles.launchCost chacun)
function missileMax() {
  if (!UI.lock) return 0;
  return Math.min(loadedSilos(G.me, UI.lock).length, Math.floor(G.players[G.me].money / CONFIG.missiles.launchCost));
}

// Colons embarquables : pourcentage choisi de la pop du joueur sur la planète
function colonyColonists() {
  if (!UI.lock) return 0;
  let total = 0;
  for (const c of planetCells(UI.lock)) {
    if (!c.destroyed && c.owner === G.me) total += c.pop;
  }
  return Math.floor(total * UI.colonyShare);
}

// Visible si la planète verrouillée possède un silo ou un centre de
// colonisation ; chaque section n'apparaît que si le bâtiment existe.
function updateMissilebar() {
  const bar = el('missilebar');
  const hasLock = G.phase === 'playing' && UI.lock !== null;
  const hasSilo = hasLock &&
    planetCells(UI.lock).some(c => c.owner === G.me && c.building === 'silo');
  const hasColony = hasLock &&
    planetCells(UI.lock).some(c => c.owner === G.me && c.building === 'colony');
  const hasPort = CONFIG.features.fleets && hasLock && spaceports(G.me, UI.lock).length > 0;
  el('fl-ctl').hidden = !hasPort;
  el('btn-fleet').hidden = !hasPort;
  if (!hasPort && UI.aimingFleet && UI.aimingFleet.mode === 'launch') UI.aimingFleet = null;
  if (hasPort) {
    const stock = storedShips(G.me, UI.lock);
    if (UI.fleetCount !== null && UI.fleetCount >= stock) UI.fleetCount = null;
    const n = UI.fleetCount ?? stock;
    el('fl-stock').textContent = stock;
    el('fl-value').textContent = UI.fleetCount === null ? (stock ? stock + ' (tous)' : '0') : n;
    el('fl-minus').disabled = n <= 1;
    el('fl-plus').disabled = UI.fleetCount === null;
    const cost = shipCost(G.me);
    el('fl-cost').textContent = cost;
    el('fl-build').disabled = G.players[G.me].money < cost;
    el('btn-fleet').disabled = stock === 0;
    el('btn-fleet').classList.toggle('active', !!(UI.aimingFleet && UI.aimingFleet.mode === 'launch'));
  }
  bar.hidden = !hasSilo && !hasColony && !hasPort;
  el('ms-ctl').hidden = !hasSilo;
  el('btn-launch').hidden = !hasSilo;
  el('co-ctl').hidden = !hasColony;
  el('btn-colony').hidden = !hasColony;
  if (!hasSilo) UI.aiming = false;
  if (!hasColony) UI.aimingColony = false;
  if (bar.hidden) return;

  if (hasSilo) {
    const max = missileMax();
    if (UI.missileCount !== null && UI.missileCount >= max) UI.missileCount = null;
    const n = missileCountNow();
    el('ms-value').innerHTML = UI.missileCount === null && max ? `${max}<small class="ms-max">MAX</small>` : String(UI.missileCount === null ? 0 : n);
    el('ms-minus').disabled = n <= 1;
    el('ms-plus').disabled = UI.missileCount === null;
    const unit = CONFIG.missiles.launchCost;
    el('ms-cost').textContent = max ? `${unit} $ / missile · salve ${unit * n} $` : `${unit} $ / missile`;
    const btn = el('btn-launch');
    btn.disabled = max === 0;
    btn.classList.toggle('active', UI.aiming);
    updateSiloGauges(loadedSilos(G.me, UI.lock).length);
  }
  if (hasColony) {
    el('co-value').textContent = Math.round(UI.colonyShare * 100) + ' %';
    el('co-minus').disabled = UI.colonyShare <= 0.05;
    el('co-plus').disabled = UI.colonyShare >= 0.90;
    const btn = el('btn-colony');
    el('co-cost').textContent = CONFIG.colony.launchCost + ' $ / envoi';
    btn.disabled = colonyColonists() < CONFIG.colony.minColonists || G.players[G.me].money < CONFIG.colony.launchCost;
    btn.classList.toggle('active', UI.aimingColony);
  }
}

// Jauges de silos : une pastille par silo de la planète verrouillée,
// pleine quand le missile est prêt, qui se remplit pendant la recharge.
function updateSiloGauges(ready) {
  const silos = planetCells(UI.lock)
    .filter(c => c.owner === G.me && c.building === 'silo' && !c.destroyed)
    .sort((a, b) => (a.sector ?? 0) - (b.sector ?? 0));
  const box = el('ms-silos');
  while (box.children.length < silos.length) {
    const pip = document.createElement('span');
    pip.className = 'ms-pip';
    pip.appendChild(document.createElement('i'));
    box.appendChild(pip);
  }
  while (box.children.length > silos.length) box.lastChild.remove();
  let next = Infinity;
  silos.forEach((c, i) => {
    const loaded = (c.missiles || 0) > 0;
    const k = loaded ? 1 : Math.min(1, (c.reloadT || 0) / CONFIG.silo.reloadTime);
    if (!loaded) next = Math.min(next, CONFIG.silo.reloadTime - (c.reloadT || 0));
    const pip = box.children[i];
    pip.classList.toggle('ready', loaded);
    pip.firstChild.style.width = (k * 100).toFixed(1) + '%';
  });
  el('ms-reload').textContent = `${ready}/${silos.length} prêt${ready > 1 ? 's' : ''}` +
    (next < Infinity ? ` · prochain ${Math.ceil(next)} s` : '');
}

// --- Verrouillage de planète & caméra -------------------------------
function lockPlanet(p) {
  UI.lock = p;
  UI.camOffset.x = 0;
  UI.camOffset.y = 0;
  // Zoom de travail : la planète occupe ~30 % de l'écran
  const fullZoom = Math.min(12, Math.max(0.5, (Math.min(W, H) * 0.30) / p.radius));
  if (G.phase === 'placement') {
    // Premier clic (fondation de la colonie) : vrai zoom de travail complet
    UI.targetZoom = fullZoom;
    showToast(p.name + ' verrouillée — cliquez un territoire pour fonder', true);
  } else if (UI.cam.zoom >= fullZoom) {
    // Déjà très proche : on recentre sans toucher au zoom
    UI.targetZoom = UI.cam.zoom;
  } else {
    // Verrouillage en cours de partie : léger zoom seulement (×1,4 max),
    // pour ne pas perturber la vue en place
    UI.targetZoom = Math.min(fullZoom, UI.cam.zoom * CONFIG.ui.lockZoomBoost);
  }
}

function unlockPlanet() {
  UI.lock = null;
  UI.targetZoom = null;
  UI.placing = null;
  UI.aiming = false;
  UI.aimingColony = false;
  UI.aimingFleet = null;
  UI.camOffset.x = 0;
  UI.camOffset.y = 0;
}

// La caméra suit la planète verrouillée : approche en douceur pendant
// l'animation de verrouillage, puis accrochage exact avec conservation du
// décalage choisi par le joueur (un drag déplace la caméra sans recentrer)
function followCamera(dt) {
  if (!UI.lock) return;
  const p = UI.lock;
  if (UI.targetZoom !== null) {
    const k = 1 - Math.exp(-dt * 6);
    UI.cam.x += (p.x - UI.cam.x) * k;
    UI.cam.y += (p.y - UI.cam.y) * k;
    UI.cam.zoom += (UI.targetZoom - UI.cam.zoom) * k;
    if (Math.abs(UI.targetZoom - UI.cam.zoom) / UI.targetZoom < 0.02) {
      UI.targetZoom = null;
      UI.camOffset.x = 0;
      UI.camOffset.y = 0;
    }
  } else {
    UI.cam.x = p.x + UI.camOffset.x;
    UI.cam.y = p.y + UI.camOffset.y;
  }
}

// --- Entrées souris / clavier --------------------------------------------
function initInput() {
  let dragStart = null, camStart = null, dragged = false;

  canvas.addEventListener('mousedown', (e) => {
    dragStart = { x: e.clientX, y: e.clientY };
    camStart = { x: UI.cam.x, y: UI.cam.y };
    dragged = false;
  });

  window.addEventListener('mousemove', (e) => {
    UI.mouse.x = e.clientX; UI.mouse.y = e.clientY;
    UI.shift = e.shiftKey;
    if (dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
      if (dragged) {
        UI.targetZoom = null; // un drag annule l'animation de verrouillage
        UI.cam.x = camStart.x - dx / UI.cam.zoom;
        UI.cam.y = camStart.y - dy / UI.cam.zoom;
        // La planète reste verrouillée : on mémorise le décalage choisi,
        // la caméra ne se recentre pas au relâchement
        if (UI.lock) {
          UI.camOffset.x = UI.cam.x - UI.lock.x;
          UI.camOffset.y = UI.cam.y - UI.lock.y;
        }
      }
    }
    updateHover(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', (e) => {
    UI.shift = e.shiftKey;
    if (dragStart && !dragged && e.target === canvas) handleClick(e.clientX, e.clientY);
    dragStart = null;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    UI.targetZoom = null; // le zoom manuel annule le zoom de verrouillage
    const before = screenToWorld(e.clientX, e.clientY);
    UI.cam.zoom = Math.min(30, Math.max(0.05, UI.cam.zoom * Math.exp(-e.deltaY * 0.0024)));
    const after = screenToWorld(e.clientX, e.clientY);
    UI.cam.x += before.x - after.x;
    UI.cam.y += before.y - after.y;
    // Le décalage suit le zoom manuel pour rester cohérent avec le verrouillage
    if (UI.lock) {
      UI.camOffset.x = UI.cam.x - UI.lock.x;
      UI.camOffset.y = UI.cam.y - UI.lock.y;
    }
  }, { passive: false });

  // Maj enfoncée : pose manuelle des bâtiments
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') UI.shift = false; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') UI.shift = true;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // saisie en cours
    // Tab : planète suivante parmi les miennes
    if (e.key === 'Tab' && G.phase === 'playing') { e.preventDefault(); cycleMyPlanet(e.shiftKey ? -1 : 1); return; }
    if (G.phase === 'playing' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const btn = hotkeyButton(e.code);
      if (btn) {
        e.preventDefault();
        if (!btn.hidden && !btn.disabled && btn.offsetParent !== null) btn.click();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (UI.aimingFleet) {
        UI.aimingFleet = null;
        canvas.style.cursor = 'default';
        updateMissilebar();
        return;
      }
      if (UI.aimingColony) { // Échap annule d'abord la visée ou la pose en cours
        UI.aimingColony = false;
        UI.aimingFleet = null;
        canvas.style.cursor = 'default';
        updateMissilebar();
        return;
      }
      if (UI.aiming) {
        UI.aiming = false;
        canvas.style.cursor = 'default';
        updateMissilebar();
        return;
      }
      if (UI.placing) {
        UI.placing = null;
        updateBuildbar();
        return;
      }
      unlockPlanet();
    }
    if (e.key === 'c' || e.key === 'C') centerOnMyPlanet();
  });
}

// Verrouille la planète où le joueur possède le plus de territoires
function centerOnMyPlanet() {
  let best = null, bestCount = 0;
  for (const p of G.planets) {
    const count = planetCells(p).filter(c => c.owner === G.me).length;
    if (count > bestCount) { best = p; bestCount = count; }
  }
  if (best) lockPlanet(best);
}

function updateHover(sx, sy) {
  if (G.phase === 'menu' || G.phase === 'over') { UI.hover = null; UI.hoverPlanet = null; return; }
  const w = screenToWorld(sx, sy);
  UI.hover = null; UI.hoverPlanet = null;
  const hit = pickAt(w); // en gestion à distance : toute la bordure est cliquable
  if (hit) { UI.hoverPlanet = hit.planet; UI.hover = hit.cell; }
  canvas.style.cursor = (UI.aiming || UI.aimingColony || UI.aimingFleet) ? 'none' : (UI.placing ? 'crosshair' : (UI.hoverPlanet ? 'pointer' : 'default'));
}

function handleClick(sx, sy) {
  if (G.phase === 'over' || G.paused) return;
  const w = screenToWorld(sx, sy);

  // Mode visée flotte : planète ou flotte ennemie
  if (UI.aimingFleet) {
    const pickR = Math.max(10, 14 / UI.cam.zoom);
    const foe = fleetAt(w.x, w.y, pickR, f => isHostile(G.me, f.owner));
    let target = foe ? { kind: 'fleet', fleet: foe } : null;
    // Planète : le point visé est celui du viseur aimanté sur le rail
    updateAimSnap();
    if (!target && UI.snap) target = { kind: 'planet', planet: UI.snap.planet, ang: UI.snap.ang };
    UI.snap = null;
    const mode = UI.aimingFleet;
    UI.aimingFleet = null;
    canvas.style.cursor = 'default';
    updateMissilebar();
    if (!target) { showToast('La cible doit être une planète ou une flotte ennemie — ordre annulé'); return; }
    if (mode.mode === 'retarget') {
      if (!fleetAlive(mode.fleet)) return;
      issue({ t: 'retarget', fleet: mode.fleet, target });
      showToast(target.kind === 'fleet' ? 'Flotte : interception de la flotte ennemie' : `Flotte en route vers ${target.planet.name}`, true);
      return;
    }
    const stock = storedShips(G.me, UI.lock);
    issue({ t: 'fleet', p: UI.lock.id, n: UI.fleetCount ?? stock, target }, r => {
      if (!r.ok) showToast(r.msg);
      else showToast(`Flotte de ${r.launched} vaisseau${r.launched > 1 ? 'x' : ''} lancée !`, true);
    });
    UI.fleetCount = null;
    return;
  }

  // Clic sur une de mes flottes : sélection pour un nouvel ordre
  if (G.phase === 'playing') {
    const mine = fleetAt(w.x, w.y, Math.max(8, 12 / UI.cam.zoom), f => f.owner === G.me);
    if (mine) {
      UI.aiming = false; UI.aimingColony = false; UI.placing = null;
      UI.aimingFleet = { mode: 'retarget', fleet: mine };
      canvas.style.cursor = 'none';
      updateBuildbar(); updateMissilebar();
      showToast(`Flotte (${mine.ships.length}) sélectionnée : visez une planète ou une flotte ennemie — Échap pour annuler`, true);
      return;
    }
  }

  // Mode visée colonisation : la cible doit être une planète
  if (UI.aimingColony) {
    // Le point d'atterrissage est celui du viseur aimanté sur le rail
    updateAimSnap();
    const sn = UI.snap;
    UI.snap = null;
    UI.aimingColony = false;
    UI.aimingFleet = null;
    canvas.style.cursor = 'default';
    updateMissilebar();
    if (!sn) { showToast("Approchez le viseur d'une planète pour choisir le point d'atterrissage — lancement annulé"); return; }
    issue({ t: 'colony', p: UI.lock.id, share: UI.colonyShare, tp: sn.planet.id, ang: sn.ang }, r => {
      if (!r.ok) showToast(r.msg);
      else showToast(`Module de colonisation lancé (${r.colonists} colons) !`, true);
    });
    return;
  }

  // Mode visée missile : le clic définit la cible du tir groupé
  if (UI.aiming) {
    issue({ t: 'missiles', p: UI.lock.id, n: missileCountNow(), x: w.x, y: w.y }, r => {
      if (!r.ok) showToast(r.msg);
      else showToast(r.launched > 1 ? `${r.launched} missiles lancés !` : 'Missile lancé !', true);
    });
    UI.aiming = false;
    canvas.style.cursor = 'default';
    updateMissilebar();
    return;
  }

  // Planète sous le curseur (corps entier, pas seulement la couronne)
  const hit = pickAt(w);
  const planet = hit ? hit.planet : null;
  let cell = hit ? hit.cell : null;

  // Clic dans le vide : libère le verrouillage
  if (!planet) {
    unlockPlanet();
    return;
  }

  // Clic sur une planète non verrouillée : on la verrouille, la caméra la suit
  if (UI.lock !== planet) {
    lockPlanet(planet);
    return;
  }

  // --- Planète verrouillée : actions ---
  if (G.phase === 'placement') {
    // Une seule colonie de départ : les clics suivants sont ignorés pendant
    // que les IA fondent les leurs
    if (G.players[G.me].colonyPlaced || UI.founding) return;
    if (cell && cell.owner === null) {
      UI.founding = true; // une seule demande en vol (client)
      issue({ t: 'found', p: planet.id, s: cell.sector }, r => {
        UI.founding = false;
        if (!r.ok) { if (r.msg) showToast(r.msg); return; }
        if (G.phase === 'placement') {
          showPrompt(Session.isNet() && G.players.some(p => !p.isBot && !p.colonyPlaced && p.id !== G.me)
            ? 'Colonie fondée. <strong>En attente des autres joueurs…</strong>'
            : 'Colonie fondée. <strong>Les IA fondent leurs colonies…</strong>');
        }
      });
    }
    return;
  }

  if (G.phase !== 'playing') return;

  // Mode pose de bâtiment : un clic n'importe où sur la planète construit à
  // l'emplacement proposé ; Maj + clic : sur le territoire visé
  if (UI.placing) {
    const type = UI.placing;
    const target = UI.shift ? cell : suggestBuildCell(G.me, planet, type);
    if (!target) { showToast(UI.shift ? 'Visez un de vos territoires libres' : 'Aucun territoire libre pour ce bâtiment sur cette planète'); return; }
    issue({ t: 'build', p: planet.id, s: target.sector, b: type }, r => {
      if (!r.ok) { showToast(r.msg); return; }
      showToast(BUILDING_LABELS[type] + ' construit', true);
      if (UI.placing === type) UI.placing = null;
      updateBuildbar();
    });
    return;
  }

  if (!cell) return; // clic dans l'intérieur de la planète : rien
  // Clic sur un de mes territoires : rien à faire
  if (cell.owner === G.me) return;

  // Visée par camp : peu importe le territoire cliqué, l'action se résout
  // sur le territoire du camp visé qui est contigu à l'un des miens
  // (le plus proche du clic s'il y a plusieurs points de contact)
  const targetOwner = cell.owner;
  const frontier = [];
  for (const c of planetCells(planet)) {
    if (c.destroyed) continue;
    if (c.owner === targetOwner && cellNeighbors(c).some(n => n.owner === G.me && !n.destroyed)) {
      frontier.push(c);
    }
  }
  if (!frontier.length) {
    const ownsHere = planetCells(planet).some(c => c.owner === G.me);
    if (ownsHere) showToast('Hors de portée — ce camp n\'a aucun territoire contigu aux vôtres');
    return;
  }
  let target = frontier[0], bestD = Infinity;
  for (const f of frontier) {
    const c = cellCentroid(f);
    const d = Math.hypot(c.x - w.x, c.y - w.y);
    if (d < bestD) { bestD = d; target = f; }
  }

  // Une seule mécanique : l'attaque (neutre comme ennemi) — coût en
  // argent + part de ma population sur la planète
  if (target.contest && target.contest.attacker !== G.me) { showToast('Territoire déjà attaqué par un tiers'); return; }
  issue({ t: 'attack', p: planet.id, s: target.sector }, r => {
    if (!r.ok) showToast(r.msg);
    else showToast(r.clash ? 'Choc frontal — les forces s\'annulent !' : 'Attaque lancée — population engagée', true);
  });
}

// Rafraîchissement périodique du HUD
function tickUI(dt) {
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.12;
    if (G.phase === 'playing' || G.phase === 'placement') {
      // Éliminé alors que la partie continue pour d'autres (multijoueur)
      const meP = G.players[G.me];
      if (G.phase === 'playing' && meP && !meP.alive && !UI.defeatShown) { UI.defeatShown = true; showEndScreen(null); }
      updateHUD();
      updateScoreboard();
      updateAllyAsk();
      updateBuildbar();
      updateMissilebar();
      updatePlanetInfo();
      updateMyPlanets();
      layoutBottomBars();
    } else {
      el('planetinfo').hidden = true;
      el('myplanets').hidden = true;
    }
  }
}


// --- Tableau des joueurs ---------------------------------------------------
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateScoreboard() {
  const box = el('scoreboard');
  const show = G.phase === 'playing' || G.phase === 'placement';
  box.hidden = !show;
  if (!show) { hideAllyTip(); return; }
  updateAllyTip();

  const stats = G.players.map(p => ({ pop: 0, cap: 0 }));
  for (const pl of G.planets) for (const c of planetCells(pl)) {
    if (c.destroyed || c.owner === null) continue;
    stats[c.owner].pop += c.pop;
    stats[c.owner].cap += cellCap(c);
  }
  const rows = el('sb-rows');
  while (rows.children.length < G.players.length) {
    const r = document.createElement('div');
    r.className = 'sb-row';
    r.innerHTML = '<span class="dot"></span><span class="sb-name"></span><span class="sb-pop"></span><span class="sb-money"></span>';
    const id = rows.children.length;
    r.dataset.pid = id;
    r.addEventListener('contextmenu', (e) => { e.preventDefault(); hideAllyTip(); openPlayerMenu(+r.dataset.pid, e.clientX, e.clientY); });
    r.addEventListener('mouseenter', () => { _tipPid = +r.dataset.pid; _tipRow = r; updateAllyTip(); });
    r.addEventListener('mouseleave', hideAllyTip);
    rows.appendChild(r);
  }
  G.players.forEach((p, i) => {
    const r = rows.children[i];
    r.classList.toggle('me', i === G.me);
    r.classList.toggle('dead', !p.alive);
    r.children[0].style.background = p.color;
    const al = i !== G.me ? allianceOf(G.me, i) : null;
    const wait = i !== G.me && pendingRequest(G.me, i);
    let tag = '';
    if (al) tag = `<span class="tag ally">ALLIÉ ${fmtTime(al.until - G.time)}</span>`;
    else if (wait) tag = '<span class="tag wait">proposé…</span>';
    // Traître : visible de tous les joueurs, avec le temps restant
    if (isTraitor(i)) tag += `<span class="tag vuln">TRAÎTRE ${fmtTime(p.traitorUntil - G.time)}</span>`;
    const you = i === G.me && p.name !== 'Vous' ? ' <span class="pi-max">(vous)</span>' : '';
    r.children[1].innerHTML = `${p.name}${you}${tag}`;
    r.children[2].innerHTML = `${Math.floor(stats[i].pop)}<span class="pi-max"> / ${stats[i].cap}</span>`;
    r.children[3].textContent = Math.floor(p.money) + ' $';

  });
}

// Fiche d'alliances au survol d'un pseudo : avec qui ce joueur est allié,
// et dans combien de temps chaque alliance prend fin
let _tipPid = null, _tipRow = null;
function updateAllyTip() {
  const tip = el('sbtip');
  if (_tipPid === null || !G.players[_tipPid] || G.phase !== 'playing') { tip.hidden = true; return; }
  const p = G.players[_tipPid];
  const allies = G.alliances
    .filter(al => al.a === _tipPid || al.b === _tipPid)
    .map(al => ({ id: al.a === _tipPid ? al.b : al.a, left: al.until - G.time }))
    .sort((a, b) => a.left - b.left);
  let html = `<div class="tip-head"><span class="dot" style="background:${p.color}"></span>${p.name}</div>`;
  if (p.isBot && p.profile) html += `<div class="tip-none">Bot · dominante ${BOT_STYLE_LABELS[p.profile.style]} · niveau ${skillLabel(p.profile.skill)}</div>`;
  if (isTraitor(_tipPid)) html += `<div class="tip-traitor">Traître encore ${fmtTime(p.traitorUntil - G.time)} : le trahir est sans pénalité</div>`;
  html += '<div class="tip-label">ALLIANCES</div>';
  html += allies.length
    ? allies.map(a => `<div class="tip-row"><span class="dot" style="background:${G.players[a.id].color}"></span>${G.players[a.id].name}<b>${fmtTime(a.left)}</b></div>`).join('')
    : '<div class="tip-none">Aucune alliance en cours</div>';
  tip.innerHTML = html;
  tip.hidden = false;
  const rb = _tipRow.getBoundingClientRect(), sb = el('scoreboard').getBoundingClientRect();
  tip.style.left = (sb.right + 8) + 'px';
  tip.style.top = Math.min(innerHeight - tip.offsetHeight - 8, rb.top - 4) + 'px';
}
function hideAllyTip() { _tipPid = null; _tipRow = null; el('sbtip').hidden = true; }

// Proposer une alliance (clic droit sur un pseudo ou un territoire)
function askAllianceWith(pid) {
  if (G.phase !== 'playing' || pid === G.me || !G.players[pid]) return;
  issue({ t: 'ally', to: pid }, r => {
    if (!r.ok) showToast(r.msg);
    else if (!r.accepted) showToast(`Alliance proposée à ${G.players[pid].name}…`, true);
  });
}

// --- Proposition reçue : notification au centre, en haut -------------------
let _askReq = null;
function updateAllyAsk() {
  const box = el('allyask');
  const req = G.phase === 'playing' ? G.allyRequests.find(r => r.to === G.me) : null;
  if (!req) { box.hidden = true; _askReq = null; return; }
  if (req !== _askReq) {
    _askReq = req;
    const from = G.players[req.from];
    el('aa-name').textContent = from.name;
    el('aa-name').style.color = from.color;
    el('aa-dot').style.background = from.color;
    box.hidden = false;
  }
  const k = Math.max(0, (req.expires - G.time) / CONFIG.diplomacy.requestTimeout);
  el('aa-bar').style.width = (k * 100).toFixed(1) + '%';
}

// Menu de diplomatie au clic droit : proposer, ou trahir une alliance
let _menuPid = null;
function openPlayerMenu(pid, x, y) {
  if (G.phase !== 'playing' || pid === G.me || !G.players[pid] || !G.players[pid].alive) return;
  _menuPid = pid;
  const p = G.players[pid];
  el('cm-name').textContent = p.name;
  el('cm-name').style.color = p.color;
  el('cm-dot').style.background = p.color;
  refreshPlayerMenu();
  const m = el('ctxmenu');
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px';
  m.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px';
  el('cm-action').focus();
}

function refreshPlayerMenu() {
  const pid = _menuPid;
  const btn = el('cm-action'), note = el('cm-note');
  btn.disabled = false;
  btn.classList.remove('betray');
  if (areAllied(G.me, pid)) {
    btn.textContent = "Trahir l'alliance";
    btn.classList.add('betray');
    note.textContent = isTraitor(pid)
      ? `${G.players[pid].name} est un traître : le trahir est sans pénalité.`
      : `Votre défense sera divisée par ${CONFIG.diplomacy.betrayDefenseDiv} pendant ${CONFIG.diplomacy.betrayVulnerable} s.`;
  } else if (pendingRequest(G.me, pid)) {
    btn.textContent = 'Proposition envoyée…';
    btn.disabled = true;
    note.textContent = '';
  } else {
    btn.textContent = 'Proposer une alliance (5 min)';
    note.textContent = isTraitor(pid) ? `Attention : ${G.players[pid].name} a trahi récemment.` : '';
  }
}

function closePlayerMenu() { el('ctxmenu').hidden = true; _menuPid = null; }

let _alertTimer = null;
function showBetrayalAlert(text, sub) {
  el('bt-text').innerHTML = text;
  el('bt-sub').textContent = sub;
  el('betrayal').hidden = false;
  clearTimeout(_alertTimer);
  _alertTimer = setTimeout(() => { el('betrayal').hidden = true; }, 4500);
}

function initDiplomacyUI() {
  el('cm-action').addEventListener('click', () => {
    const pid = _menuPid;
    if (pid === null) return;
    closePlayerMenu();
    if (areAllied(G.me, pid)) issue({ t: 'betray', to: pid }, r => { if (!r.ok && r.msg) showToast(r.msg); });
    else askAllianceWith(pid);
  });
  window.addEventListener('mousedown', (e) => { if (!el('ctxmenu').contains(e.target)) closePlayerMenu(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayerMenu(); });
  canvas.addEventListener('wheel', closePlayerMenu, { passive: true });
  // Réponse à une proposition : la demande disparaît tout de suite à l'écran
  const answer = (accept) => {
    if (!_askReq) return;
    const from = _askReq.from;
    if (Session.role === 'client') G.allyRequests = G.allyRequests.filter(q => q !== _askReq);
    issue({ t: 'answer', from, accept });
    updateAllyAsk();
  };
  el('aa-yes').addEventListener('click', () => answer(true));
  el('aa-no').addEventListener('click', () => answer(false));
  // Clic droit sur la carte : territoire d'un autre joueur → proposition
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (G.phase !== 'playing') return;
    const hit = pickAt(screenToWorld(e.clientX, e.clientY));
    const c = hit && hit.cell;
    if (c && c.owner !== null && c.owner !== G.me) openPlayerMenu(c.owner, e.clientX, e.clientY);
  });
}

// Événements diplomatiques publiés par la simulation
function onDiplomacyEvent(type, d) {
  const name = id => G.players[id] ? G.players[id].name : '?';
  if (type === 'refused' && d.from === G.me) showToast(`${name(d.to)} refuse l'alliance`);
  else if (type === 'formed') {
    if (d.a === G.me || d.b === G.me) showToast(`Alliance conclue avec ${name(d.a === G.me ? d.b : d.a)} pour 5 minutes`, true);
    else showToast(`${name(d.a)} et ${name(d.b)} ont conclu une alliance`);
  } else if (type === 'betrayed') {
    const D = CONFIG.diplomacy;
    const how = d.how === 'missile' ? ' (missile sur un territoire allié)' : '';
    const t = G.players[d.traitor], v = G.players[d.victim];
    const tag = pl => `<b style="color:${pl.color}">${pl.name}</b>`;
    if (d.traitor === G.me) {
      showBetrayalAlert(`Vous avez trahi ${tag(v)}${how}`,
        d.free ? `${v.name} était un traître : aucune pénalité.` : `Votre défense est divisée par ${D.betrayDefenseDiv} pendant ${D.betrayVulnerable} s.`);
    } else if (d.victim === G.me) {
      showBetrayalAlert(`${tag(t)} vous a trahi${how} !`,
        d.free ? 'Vous étiez marqué comme traître : il ne subit aucune pénalité.' : `Sa défense est divisée par ${D.betrayDefenseDiv} pendant ${D.betrayVulnerable} s : c'est le moment de riposter.`);
    } else {
      showToast(`${t.name} a trahi ${v.name}`);
    }
  } else if (type === 'ended' && (d.a === G.me || d.b === G.me)) {
    showToast(`Fin de l'alliance avec ${name(d.a === G.me ? d.b : d.a)}`);
  }
}
