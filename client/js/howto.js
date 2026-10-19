// ============================================================
// SOLAR CONQUEST — « Comment jouer ? » (tutoriel du menu principal)
// Le texte est dans index.html (#howto). Ce fichier l'ouvre, remplit les
// chiffres depuis CONFIG (data-cfg, data-cost) et les icônes des bâtiments,
// et construit le sommaire à partir des titres des sections.
// ============================================================

const Howto = {
  ready: false,

  cfg(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), CONFIG); },

  fmt(v) { return typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) : String(v); },

  fill() {
    const box = el('howto');
    box.querySelectorAll('[data-cfg]').forEach(n => {
      let v = this.cfg(n.dataset.cfg);
      if (v == null) return;
      if (n.hasAttribute('data-pct')) v = this.fmt(Math.round(v * 100)) + ' %';
      else if (n.hasAttribute('data-min')) v = this.fmt(Math.round(v / 60));
      else v = this.fmt(v);
      n.textContent = (n.hasAttribute('data-plus') ? '+' : '') + v + (n.dataset.unit || '');
    });
    box.querySelectorAll('[data-cost]').forEach(n => { n.textContent = buildingBaseCost(n.dataset.cost) + ' $'; });
    box.querySelectorAll('[data-ico]').forEach(n => { if (BUILDING_ICONS[n.dataset.ico]) n.src = BUILDING_ICONS[n.dataset.ico]; });
    if (this.ready) return;
    this.ready = true;
    // Sommaire
    const toc = el('howto-toc');
    box.querySelectorAll('.howto-body section').forEach(sec => {
      const a = document.createElement('button');
      a.textContent = sec.querySelector('h2').textContent;
      a.dataset.target = sec.id;
      a.addEventListener('click', () => { const b = el('howto-body'); b.scrollTo({ top: this.top(sec), behavior: 'smooth' }); });
      toc.appendChild(a);
    });
    // Section en cours surlignée dans le sommaire
    el('howto-body').addEventListener('scroll', () => this.spy());
  },

  // Position d'une section dans la zone qui défile
  top(sec) { const b = el('howto-body'); return sec.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop; },

  spy() {
    const body = el('howto-body');
    let cur = null;
    for (const sec of body.querySelectorAll('section')) if (this.top(sec) - 40 <= body.scrollTop) cur = sec.id;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) cur = body.querySelector('section:last-of-type').id;
    el('howto-toc').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.target === (cur || 'ht-but')));
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
el('howto').addEventListener('click', (e) => { if (e.target === el('howto')) Howto.close(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('howto').hidden) Howto.close(); });
