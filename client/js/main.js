// ============================================================
// SOLAR CONQUEST — Bootstrap & boucle principale
// ============================================================

function main() {
  initRender();
  initMenu();
  initInput();
  initDiplomacyUI();

  let last = performance.now();
  function frame(t) {
    const rawDt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const dt = rawDt * G.speed;

    if (!G.paused && G.phase !== 'menu' && G.phase !== 'over') {
      // Le client ne simule rien : il affiche l'état envoyé par l'hôte
      if (Session.role === 'client') clientUpdate(rawDt);
      else update(dt);
    }
    sessionTick(rawDt);
    followCamera(rawDt);
    tickUI(rawDt);
    render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
