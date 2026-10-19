// ============================================================
// SOLAR CONQUEST — Comptes joueurs (Supabase Auth, par e-mail)
//
// Le jeu parle directement à Supabase (inscription, connexion, mot de passe
// oublié) avec la clé PUBLIQUE du projet. Le serveur de jeu vérifie ensuite
// le jeton de connexion pour réserver le pseudo et enregistrer les parties.
// Sans configuration (CONFIG.supabase vide), les comptes sont désactivés et
// l'on joue en invité avec un simple pseudo.
// ============================================================

const AUTH_KEY = 'sc.auth';

const Account = {
  session: null,   // { access_token, refresh_token, expires_at, user: { id, email } }
  profile: null,   // { pseudo }
  stats: null,     // { games, wins, eliminated }

  cfg() { return (typeof CONFIG.supabase === 'object' && CONFIG.supabase) || {}; },
  enabled() { const c = this.cfg(); return !!(c.url && c.anonKey); },
  loggedIn() { return !!(this.session && this.profile); },

  // --- Appels à Supabase -----------------------------------------------------
  async api(path, { method = 'GET', body, token } = {}) {
    const c = this.cfg();
    const headers = { apikey: c.anonKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    else if (c.anonKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + c.anonKey; // ancienne clé « anon »
    try {
      const base = c.url.replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
      const res = await fetch(base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { msg: T('acc.unreachable') } };
    }
  },

  // Messages d'erreur de Supabase traduits pour le joueur
  errorText(r) {
    const d = r.data || {};
    const code = d.error_code || d.code || d.error || '';
    const map = {
      invalid_credentials: 'acc.e.creds', invalid_grant: 'acc.e.creds',
      email_not_confirmed: 'acc.e.unconfirmed',
      user_already_exists: 'acc.e.exists', email_exists: 'acc.e.exists',
      weak_password: 'acc.e.weak',
      over_email_send_rate_limit: 'acc.e.mailRate', over_request_rate_limit: 'acc.e.rate',
      signup_disabled: 'acc.e.signupOff', email_address_invalid: 'acc.e.badEmail',
      same_password: 'acc.e.samePass', session_not_found: 'acc.e.session',
    };
    if (map[code]) return T(map[code]);
    if (r.status === 0) return d.msg;
    return d.msg || d.error_description || d.message || T('acc.e.generic');
  },

  // --- Session ---------------------------------------------------------------
  setSession(d) {
    this.session = {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (+d.expires_in || 3600),
      user: d.user ? { id: d.user.id, email: d.user.email } : (this.session && this.session.user) || null,
    };
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(this.session)); } catch (e) { /* sans objet */ }
  },

  clearSession() {
    this.session = null; this.profile = null; this.stats = null;
    try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* sans objet */ }
  },

  // Jeton valable (rafraîchi s'il expire bientôt), ou null
  async token() {
    if (!this.session) return null;
    if (this.session.expires_at - Date.now() / 1000 > 90) return this.session.access_token;
    const r = await this.api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: this.session.refresh_token } });
    if (!r.ok || !r.data || !r.data.access_token) { this.clearSession(); onAccountChange(); return null; }
    this.setSession(r.data);
    return this.session.access_token;
  },

  async loadProfile() {
    const t = await this.token();
    if (!t || !this.session.user) return false;
    const id = encodeURIComponent(this.session.user.id);
    const [p, s] = await Promise.all([
      this.api(`/rest/v1/profiles?id=eq.${id}&select=pseudo`, { token: t }),
      this.api(`/rest/v1/player_stats?id=eq.${id}&select=games,wins,eliminated`, { token: t }),
    ]);
    if (p.ok && Array.isArray(p.data) && p.data[0]) this.profile = p.data[0];
    if (s.ok && Array.isArray(s.data) && s.data[0]) this.stats = s.data[0];
    return !!this.profile;
  },

  // Au chargement : session mémorisée, ou retour depuis un lien reçu par e-mail
  async init() {
    if (!this.enabled()) return;
    try { this.session = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { this.session = null; }
    const redirect = this.readRedirect();
    if (redirect && redirect.access_token) {
      const u = await this.api('/auth/v1/user', { token: redirect.access_token });
      this.setSession({ ...redirect, user: u.ok ? u.data : null });
    }
    if (this.session) await this.loadProfile();
    onAccountChange();
    if (redirect) {
      if (redirect.error) showMenuToast(redirect.error_description ? T('acc.linkExpired') : T('acc.linkBad'));
      else if (redirect.type === 'recovery') openPasswordReset();
      else if (redirect.type === 'signup' || redirect.type === 'email') showMenuToast(T('acc.confirmed'), true);
    }
  },

  // Paramètres ajoutés à l'adresse par Supabase (#access_token=…&type=…)
  readRedirect() {
    const h = location.hash.replace(/^#/, '');
    if (!/access_token=|error=/.test(h)) return null;
    const q = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + location.search);
    const o = {};
    for (const [k, v] of q) o[k] = v;
    return o;
  },

  redirectUrl() { return location.origin + location.pathname; },

  // --- Actions -----------------------------------------------------------
  async register(pseudo, email, password) {
    const owner = await this.api('/rest/v1/rpc/pseudo_owner', { method: 'POST', body: { p: pseudo } });
    if (owner.ok && owner.data) return { ok: false, msg: T('acc.pseudoTaken', { name: pseudo }) };
    const r = await this.api('/auth/v1/signup?redirect_to=' + encodeURIComponent(this.redirectUrl()), {
      method: 'POST', body: { email, password, data: { pseudo } },
    });
    if (!r.ok) {
      if (/database error/i.test(JSON.stringify(r.data || ''))) return { ok: false, msg: T('acc.pseudoTaken', { name: pseudo }) };
      return { ok: false, msg: this.errorText(r) };
    }
    if (r.data && r.data.access_token) {
      this.setSession(r.data);
      await this.loadProfile();
      onAccountChange();
      return { ok: true };
    }
    return { ok: true, confirm: true, msg: T('acc.checkMail', { email }) };
  },

  async login(email, password) {
    const r = await this.api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (!r.ok || !r.data || !r.data.access_token) return { ok: false, msg: this.errorText(r) };
    this.setSession(r.data);
    await this.loadProfile();
    onAccountChange();
    return { ok: true };
  },

  async logout() {
    const t = this.session && this.session.access_token;
    this.clearSession();
    onAccountChange();
    if (t) this.api('/auth/v1/logout', { method: 'POST', token: t });
  },

  async recover(email) {
    const r = await this.api('/auth/v1/recover?redirect_to=' + encodeURIComponent(this.redirectUrl()), { method: 'POST', body: { email } });
    if (!r.ok) return { ok: false, msg: this.errorText(r) };
    return { ok: true, msg: T('acc.recoverSent', { email }) };
  },

  async setPassword(password) {
    const t = await this.token();
    if (!t) return { ok: false, msg: T('acc.resetExpired') };
    const r = await this.api('/auth/v1/user', { method: 'PUT', token: t, body: { password } });
    if (!r.ok) return { ok: false, msg: this.errorText(r) };
    return { ok: true };
  },
};
