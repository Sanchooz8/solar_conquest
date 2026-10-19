// ============================================================
// SOLAR CONQUEST — Encarts publicitaires (accueil et salon d'attente)
//
// Réglages dans CONFIG.ads (js/config.js). Sans identifiant d'éditeur
// (client vide), aucun encart n'apparaît. Pour voir la mise en page avec des
// encarts factices : ajouter ?ads=demo à l'adresse.
// Les encarts ne sont que dans le menu : jamais pendant une partie.
// AdSense (Europe) : activer le message de consentement certifié de Google
// (AdSense > Confidentialité et messages > RGPD), sinon pas de pub personnalisée.
// Le fichier ads.txt est généré au build à partir de CONFIG.ads.client.
// ============================================================

const Ads = {
  loaded: false,
  demo: false,

  cfg() { return CONFIG.ads || {}; },
  enabled() { return this.demo || !!(this.cfg().client && this.cfg().provider === 'adsense'); },

  init() {
    try { this.demo = new URLSearchParams(location.search).get('ads') === 'demo'; } catch (e) { /* sans objet */ }
    if (!this.enabled()) return;
    if (!this.demo) {
      const s = document.createElement('script');
      s.async = true; s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(this.cfg().client);
      document.head.appendChild(s);
      this.loaded = true;
    }
    this.fill('home');
  },

  // Remplit l'encart d'un écran la première fois qu'il est visible
  // (AdSense a besoin d'un emplacement affiché pour mesurer sa largeur)
  fill(where) {
    if (!this.enabled()) return;
    const box = el('ad-' + where);
    if (!box || box.dataset.filled) return;
    const slot = (this.cfg().slots || {})[where];
    if (!this.demo && !slot) return;
    box.hidden = false;
    box.dataset.filled = '1';
    const inner = box.querySelector('.ad-inner');
    if (this.demo) { inner.innerHTML = `<div class="ad-demo">${box.dataset.size}</div>`; return; }
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = this.cfg().client;
    ins.dataset.adSlot = slot;
    ins.dataset.adFormat = where === 'home' ? 'horizontal' : 'rectangle';
    ins.dataset.fullWidthResponsive = 'true';
    inner.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { box.hidden = true; }
  },
};
