// ============================================================
// SOLAR CONQUEST — Diplomatie : alliances temporaires
// Un joueur propose une alliance à un autre ; celui-ci accepte ou
// refuse. Acceptée, l'alliance dure 5 minutes : les deux joueurs ne
// peuvent plus s'attaquer (conquête, artillerie, DAA, flottes, riposte
// des bâtiments, interception de cargos, modules de colonisation).
// ============================================================

// Les deux joueurs sont-ils alliés en ce moment ?
function areAllied(a, b) {
  if (a === null || b === null || a === undefined || b === undefined || a === b) return false;
  return G.alliances.some(al => (al.a === a && al.b === b) || (al.a === b && al.b === a));
}

function allianceOf(a, b) {
  return G.alliances.find(al => (al.a === a && al.b === b) || (al.a === b && al.b === a)) || null;
}

// « Ennemi » au sens militaire : autre joueur, non allié
function isHostile(a, b) {
  return a !== null && b !== null && a !== undefined && b !== undefined && a !== b && !areAllied(a, b);
}

function pendingRequest(from, to) {
  return G.allyRequests.find(r => r.from === from && r.to === to) || null;
}

// Proposer une alliance
function requestAlliance(fromId, toId) {
  const from = G.players[fromId], to = G.players[toId];
  if (!from || !to || !to.alive || !from.alive || fromId === toId) return { ok: false, msg: 'Joueur invalide' };
  if (areAllied(fromId, toId)) return { ok: false, msg: `Déjà allié avec ${to.name}` };
  if (pendingRequest(fromId, toId)) return { ok: false, msg: `Proposition déjà envoyée à ${to.name}` };
  // Proposition croisée : l'autre nous l'avait déjà proposée → accord immédiat
  const crossed = pendingRequest(toId, fromId);
  if (crossed) { answerAlliance(crossed, true); return { ok: true, accepted: true }; }
  const D = CONFIG.diplomacy;
  const req = { from: fromId, to: toId, expires: G.time + D.requestTimeout,
    decideAt: G.time + rand(D.botThinkMin, D.botThinkMax) };
  G.allyRequests.push(req);
  emitDiplo('request', req);
  return { ok: true };
}

// Réponse à une proposition
function answerAlliance(req, accept) {
  const i = G.allyRequests.indexOf(req);
  if (i < 0) return;
  G.allyRequests.splice(i, 1);
  if (accept && G.players[req.from].alive && G.players[req.to].alive) {
    formAlliance(req.from, req.to);
  } else {
    emitDiplo('refused', req);
  }
}

function formAlliance(a, b) {
  const al = { a, b, until: G.time + CONFIG.diplomacy.duration };
  G.alliances.push(al);
  // Les combats en cours entre les deux camps cessent
  for (const p of G.planets) for (const c of planetCells(p)) {
    const ct = c.contest;
    if (ct && c.owner !== null && areAllied(ct.attacker, c.owner)) {
      c.pop = Math.max(1, (ct.defense - ct.bonus) * (ct.scale || 1));
      c.contest = null;
    }
  }
  emitDiplo('formed', al);
}

// Expiration des alliances et des propositions ; décisions des bots
function updateDiplomacy(dt) {
  for (let i = G.alliances.length - 1; i >= 0; i--) {
    const al = G.alliances[i];
    if (G.time >= al.until || !G.players[al.a].alive || !G.players[al.b].alive) {
      G.alliances.splice(i, 1);
      emitDiplo('ended', al);
    }
  }
  for (const req of G.allyRequests.slice()) {
    if (G.time >= req.expires) { answerAlliance(req, false); continue; }
    const target = G.players[req.to];
    if (target.isBot && G.time >= req.decideAt) answerAlliance(req, botAcceptsAlliance(target, req.from));
  }
  for (const p of G.players) if (p.isBot && p.alive) botProposeAlliance(p, dt);
}

// --- Trahison --------------------------------------------------------
// Rompre une alliance avant son terme. Le traître devient vulnérable :
// sa défense est divisée par 5 pendant 30 s, et il reste « traître »
// pendant 5 min. Trahir un traître est sans pénalité.
function isVulnerable(id) {
  const p = G.players[id];
  return !!p && (p.vulnerableUntil || 0) > G.time;
}

function isTraitor(id) {
  const p = G.players[id];
  return !!p && (p.traitorUntil || 0) > G.time;
}

function betrayAlliance(traitorId, victimId, how) {
  const al = allianceOf(traitorId, victimId);
  if (!al) return { ok: false, msg: 'Aucune alliance à trahir' };
  G.alliances.splice(G.alliances.indexOf(al), 1);
  const D = CONFIG.diplomacy;
  const free = isTraitor(victimId); // trahir un traître : aucune pénalité
  if (!free) {
    const t = G.players[traitorId];
    t.vulnerableUntil = G.time + D.betrayVulnerable;
    t.traitorUntil = G.time + D.traitorMark;
  }
  emitDiplo('betrayed', { traitor: traitorId, victim: victimId, how, free });
  return { ok: true, free };
}

// --- Bots ---------------------------------------------------------
function playerPopTotal(id) {
  let s = 0;
  for (const p of G.planets) for (const c of planetCells(p)) if (c.owner === id && !c.destroyed) s += c.pop;
  return s;
}

// Un bot est-il attaqué en ce moment par un tiers ?
function underAttackBy(botId, exceptId) {
  for (const p of G.planets) for (const c of planetCells(p))
    if (c.owner === botId && c.contest && c.contest.attacker !== exceptId) return true;
  return false;
}

// Un bot accepte si le demandeur est plus fort que lui, s'il est déjà
// attaqué par un tiers, ou sinon avec une probabilité modérée
function botAcceptsAlliance(bot, fromId) {
  const D = CONFIG.diplomacy;
  if (playerPopTotal(fromId) > playerPopTotal(bot.id) * 1.2) return true;
  if (underAttackBy(bot.id, fromId)) return true;
  return Math.random() < D.botAcceptChance;
}

// De temps en temps, un bot propose une alliance à un joueur avec qui il
// partage une planète (son voisin direct, donc une menace)
function botProposeAlliance(bot, dt) {
  const D = CONFIG.diplomacy;
  bot.diploT = (bot.diploT ?? rand(D.botProposeMin, D.botProposeMax)) - dt;
  if (bot.diploT > 0) return;
  bot.diploT = rand(D.botProposeMin, D.botProposeMax);
  if (Math.random() > D.botProposeChance) return;
  const myPlanets = new Set();
  for (const p of G.planets) for (const c of planetCells(p)) if (c.owner === bot.id) myPlanets.add(p);
  const neighbours = new Set();
  for (const p of myPlanets) for (const c of planetCells(p))
    if (c.owner !== null && c.owner !== bot.id && G.players[c.owner].alive) neighbours.add(c.owner);
  const cands = [...neighbours].filter(id => !areAllied(bot.id, id) && !pendingRequest(bot.id, id));
  if (!cands.length) return;
  requestAlliance(bot.id, cands[Math.floor(Math.random() * cands.length)]);
}

// --- Événements vers l'interface ------------------------------------
// La simulation ne connaît pas l'écran : elle publie des événements que
// l'interface affiche (et que le serveur relaiera en multijoueur).
function emitDiplo(type, data) {
  if (typeof onDiplomacyEvent === 'function') onDiplomacyEvent(type, data);
  // Multijoueur : chaque client l'affiche de son point de vue
  if (typeof Session !== 'undefined') Session.event({ k: 'diplo', type, data: JSON.parse(JSON.stringify(data)) });
}
