// ============================================================
// SOLAR CONQUEST — Moteur de jeu côté serveur
//
// Le serveur fait tourner EXACTEMENT le même code de jeu que le navigateur
// (client/js/*.js). Chaque partie a son propre « bac à sable » (contexte
// vm de Node) : son propre état G, ses propres bots, sans rien partager
// avec les autres parties. Les fonctions d'affichage (messages, écrans)
// sont remplacées par des fonctions vides : le serveur n'a pas d'écran,
// il transmet les messages aux joueurs concernés via les instantanés.
// ============================================================
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'client', 'js');
const FILES = ['config.js', 'world.js', 'game.js', 'fleet.js', 'diplomacy.js', 'ai.js', 'session.js'];

// Compilé une seule fois, exécuté dans chaque partie
const scripts = FILES.map(f => new vm.Script(fs.readFileSync(path.join(DIR, f), 'utf8'), { filename: f }));
const exportScript = new vm.Script(`({
  G, CONFIG, Session,
  update, applyCommand, buildSnapshot, systemSetup, newGame, botifyPlayer,
})`);

function noop() {}

function createSim() {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    // Affichage : sans objet sur le serveur
    showToast: noop, showPrompt: noop, hidePrompt: noop, showEndScreen: noop, onDiplomacyEvent: noop,
  };
  vm.createContext(ctx);
  for (const s of scripts) s.runInContext(ctx);
  return exportScript.runInContext(ctx);
}

// Nouvelle partie : humans = pseudos (dans l'ordre des places), bots = nombre de bots
function startGame({ planets, humans, bots }) {
  const sim = createSim();
  sim.newGame(planets, bots, humans);
  sim.G.me = -1;                 // le serveur n'est aucun joueur
  sim.Session.role = 'host';     // il simule et diffuse
  return sim;
}

module.exports = { startGame };
