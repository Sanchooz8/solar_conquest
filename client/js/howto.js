// ============================================================
// SOLAR CONQUEST — « Comment jouer ? » (tutoriel du menu principal)
// Le texte est dans index.html (#howto). Ce fichier l'ouvre, remplit les
// chiffres depuis CONFIG (data-cfg, data-cost) et les icônes des bâtiments,
// et construit le sommaire à partir des titres des sections.
// ============================================================

const Howto = {
  ready: false,

  cfg(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), CONFIG); },

  fmt(v) { return typeof v === 'number' ? v.toLocaleString(LANG === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 3 }) : String(v); },

  fill() {
    const box = el('howto');
    box.querySelectorAll('[data-cfg]').forEach(n => {
      let v = this.cfg(n.dataset.cfg);
      if (v == null) return;
      if (n.hasAttribute('data-pct')) v = this.fmt(Math.round(v * 100)) + (LANG === 'fr' ? ' %' : '%');
      else if (n.hasAttribute('data-min')) v = this.fmt(Math.round(v / 60));
      else v = this.fmt(v);
      n.textContent = (n.hasAttribute('data-plus') ? '+' : '') + (n.dataset.unit === ' $' ? money(v) : v + (n.dataset.unit || ''));
    });
    box.querySelectorAll('[data-cost]').forEach(n => { n.textContent = money(buildingBaseCost(n.dataset.cost)); });
    box.querySelectorAll('[data-ico]').forEach(n => { if (BUILDING_ICONS[n.dataset.ico]) n.src = BUILDING_ICONS[n.dataset.ico]; });
    // Sommaire de la langue affichée (reconstruit au changement de langue)
    if (this.tocLang !== LANG) {
      this.tocLang = LANG;
      const toc = el('howto-toc');
      toc.innerHTML = '';
      this.sections().forEach(sec => {
        const a = document.createElement('button');
        a.textContent = sec.querySelector('h2').textContent;
        a.dataset.target = sec.id;
        a.addEventListener('click', () => { const b = el('howto-body'); b.scrollTo({ top: this.top(sec), behavior: 'smooth' }); });
        toc.appendChild(a);
      });
    }
    if (this.ready) return;
    this.ready = true;
    // Section en cours surlignée dans le sommaire
    el('howto-body').addEventListener('scroll', () => this.spy());
  },

  // Position d'une section dans la zone qui défile
  top(sec) { const b = el('howto-body'); return sec.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop; },

  sections() { return [...el('howto-body').querySelectorAll(`.howto-lang[data-lang="${LANG}"] section`)]; },

  spy() {
    const body = el('howto-body');
    let cur = null;
    const secs = this.sections();
    for (const sec of secs) if (this.top(sec) - 40 <= body.scrollTop) cur = sec.id;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) cur = secs[secs.length - 1].id;
    el('howto-toc').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.target === (cur || secs[0].id)));
  },

  open() {
    this.fill();
    el('howto').hidden = false;
    el('howto-body').scrollTop = 0;
    this.spy();
    el('howto-close').focus();
  },

  close() {
    el('howto').hidden = true;
    el('btn-howto').focus();
  },
};

el('btn-howto').addEventListener('click', () => Howto.open());
el('howto-close').addEventListener('click', () => Howto.close());
onLangChange(() => { if (!el('howto').hidden) { Howto.fill(); el('howto-body').scrollTop = 0; Howto.spy(); } });
el('howto').addEventListener('click', (e) => { if (e.target === el('howto')) Howto.close(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('howto').hidden) Howto.close(); });
