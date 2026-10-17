// ============================================================
// SOLAR CONQUEST — Accès du serveur de jeu à Supabase (comptes, statistiques)
//
// Variables d'environnement (à définir sur Render, jamais dans le code) :
//   SUPABASE_URL          adresse du projet, ex. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_KEY  clé SECRÈTE du projet (sb_secret_… ou service_role)
// Sans elles, le serveur fonctionne sans comptes (joueurs invités uniquement).
// ============================================================
'use strict';

const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';

function enabled() { return !!(URL && KEY); }

function headers(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  // Ancienne clé « service_role » (jeton JWT) : elle sert aussi d'autorisation
  if (KEY.startsWith('eyJ') && !h.Authorization) h.Authorization = 'Bearer ' + KEY;
  return h;
}

async function call(path, { method = 'GET', body, auth } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(URL + path, {
      method, signal: ctrl.signal,
      headers: headers(auth ? { Authorization: 'Bearer ' + auth } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Jeton de connexion d'un joueur → { id, pseudo } (ou null s'il n'est pas valable)
async function verifyUser(token) {
  if (!enabled() || !token) return null;
  const u = await call('/auth/v1/user', { auth: token });
  if (!u.ok || !u.data || !u.data.id) return null;
  const p = await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(u.data.id)}&select=pseudo`);
  const pseudo = p.ok && Array.isArray(p.data) && p.data[0] ? p.data[0].pseudo : null;
  return { id: u.data.id, pseudo: pseudo || 'Pilote' };
}

// Identifiant du compte qui possède ce pseudo (null s'il est libre ou en cas de panne)
async function pseudoOwner(pseudo) {
  if (!enabled() || !pseudo) return null;
  const r = await call('/rest/v1/rpc/pseudo_owner', { method: 'POST', body: { p: pseudo } });
  return r.ok && typeof r.data === 'string' ? r.data : null;
}

// Fin de partie : historique + statistiques des joueurs inscrits
async function recordMatch(payload) {
  if (!enabled()) return false;
  const r = await call('/rest/v1/rpc/record_match', { method: 'POST', body: { p: payload } });
  if (!r.ok) console.error('Supabase : enregistrement de la partie impossible', r.status, r.data);
  return r.ok;
}

module.exports = { enabled, verifyUser, pseudoOwner, recordMatch };
