// ============================================================
// SOLAR CONQUEST — Langues (anglais par défaut, français)
//
// T('clé', { param }) renvoie le texte dans la langue du joueur.
// Sur le serveur (pas de navigateur), T renvoie un jeton { k, p } : il voyage
// dans les messages et chaque joueur le traduit dans SA langue avec txt().
// Dans le HTML : data-i18n="clé" (texte), data-i18n-html (HTML),
// data-i18n-ph (placeholder), data-i18n-title (infobulle), data-i18n-aria.
// Textes : I18N_STR ci-dessous, [anglais, français]. Paramètres : {nom}.
// ============================================================

const I18N_LANGS = ['en', 'fr'];
const I18N_KEY = 'sc.lang';
const I18N_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

let LANG = 'en';
if (I18N_BROWSER) {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    const saved = localStorage.getItem(I18N_KEY);
    LANG = I18N_LANGS.includes(q) ? q : I18N_LANGS.includes(saved) ? saved : 'en';
  } catch (e) { LANG = 'en'; }
}

function I18N_fill(s, p) {
  if (!p) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (p[k] === undefined ? m : txt(p[k])));
}

// Texte traduit (navigateur) ou jeton à traduire chez le destinataire (serveur)
function T(key, p) {
  if (!I18N_BROWSER) return p ? { k: key, p } : { k: key };
  const e = I18N_STR[key];
  if (!e) return key;
  return I18N_fill(e[LANG === 'fr' ? 1 : 0] ?? e[0], p);
}

// Affichage : accepte une chaîne, un jeton { k, p } ou rien
function txt(m) {
  if (m === null || m === undefined) return '';
  if (typeof m === 'object' && m.k) return T(m.k, m.p);
  return String(m);
}

// Applique la langue aux éléments marqués dans le HTML
function applyI18n(root = I18N_BROWSER ? document : null) {
  if (!root) return;
  document.documentElement.lang = LANG;
  root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = T(n.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(n => { n.innerHTML = T(n.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-ph]').forEach(n => { n.placeholder = T(n.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = T(n.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', T(n.dataset.i18nAria)); });
  root.querySelectorAll('[data-lang]').forEach(n => { n.hidden = n.dataset.lang !== LANG; });
}

// Montant : « $50 » en anglais, « 50 $ » en français
function money(n) { return LANG === 'fr' ? n + ' $' : '$' + n; }

const I18N_HOOKS = [];   // fonctions à rappeler quand la langue change
function onLangChange(fn) { I18N_HOOKS.push(fn); }

function setLang(l) {
  if (!I18N_LANGS.includes(l) || l === LANG) return;
  LANG = l;
  try { localStorage.setItem(I18N_KEY, l); } catch (e) { /* sans objet */ }
  applyI18n();
  for (const fn of I18N_HOOKS) { try { fn(); } catch (e) { console.error(e); } }
}

// ------------------------------------------------------------
// Textes : 'clé': ['English', 'Français']
// ------------------------------------------------------------
const I18N_STR = {

  // --- game.js
  'err.destroyed': ["Territory destroyed", "Territoire détruit"],
  'err.badTarget': ["Invalid target", "Cible invalide"],
  'err.alliedAttack': ["You are allied with {name}: you cannot attack", "Alliance en cours avec {name} : attaque impossible"],
  'err.noMoney': ["Not enough money", "Argent insuffisant"],
  'err.noPopNear': ["Not enough population nearby to attack", "Population insuffisante à proximité pour attaquer"],
  'err.fleetsOff': ["Spaceships are disabled", "Les vaisseaux sont désactivés"],
  'err.notOwned': ["You do not own this territory", "Territoire non possédé"],
  'err.hasBuilding': ["There is already a building here", "Bâtiment déjà présent"],
  'err.inCombat': ["Territory under attack", "Territoire en combat"],
  'err.missileFunds': ["Not enough money: ${n} per missile", "Fonds insuffisants : {n} $ par missile"],
  'err.noMissile': ["No missile loaded on this planet", "Aucun missile chargé sur cette planète"],
  'err.modulePlanet': ["The module can only target a planet", "Le module ne peut viser qu’une planète"],
  'err.noColonyCenter': ["No colonization center on this planet", "Aucun centre de colonisation sur cette planète"],
  'err.fewColonists': ["Not enough colonists ({n} min.)", "Pas assez de colons ({n} min)"],
  'err.colonyFunds': ["Not enough money: ${n} per colonization launch", "Fonds insuffisants : {n} $ par envoi de colonisation"],
  'msg.colonistsJoined': ["{n} colonists joined {planet}", "{n} colons ont rejoint {planet}"],
  'msg.moduleLanded': ["Colonization module landed on {planet}!", "Module de colonisation arrivé sur {planet} !"],
  'msg.enemyLanded': ["Enemy colonists landed on {planet}!", "Des colons ennemis ont atterri sur {planet} !"],
  'msg.cargoDown': ["One of your cargo ships was shot down", "Un de vos cargos a été abattu"],
  'msg.tradeInner': ["Domestic trade: +${n}", "Commerce intérieur : +{n} $"],
  'msg.cargoDelivered': ["Cargo delivered: +${n} from trade", "Cargo livré : +{n} $ de commerce"],
  'msg.cargoDeliveredCity': ["Cargo delivered: +${n} from trade (city, half income)", "Cargo livré : +{n} $ de commerce (ville, gain ÷ 2)"],
  'msg.cargoReceived': ["Cargo received: +${n} from trade", "Cargo reçu : +{n} $ de commerce"],
  'msg.moduleDown': ["Colonization module shot down by enemy air defense", "Module de colonisation abattu par la DCA ennemie"],
  'prompt.botsFounding': ["Colony founded. <strong>The AIs are founding their colonies…</strong>", "Colonie fondée. <strong>Les IA fondent leurs colonies…</strong>"],
  'msg.gameStarts': ["The game begins — expand!", "La partie commence — étendez-vous !"],

  // --- session / diplomatie / flottes / bots
  'err.badCommand': ["Invalid command", "Commande invalide"],
  'err.taken': ["Territory already taken", "Territoire déjà pris"],
  'err.unknownCell': ["Unknown territory", "Territoire inconnu"],
  'err.unknownBuilding': ["Unknown building", "Bâtiment inconnu"],
  'err.outOfReach': ["Out of reach", "Hors de portée"],
  'err.thirdParty': ["Territory already attacked by another player", "Territoire déjà attaqué par un tiers"],
  'err.unknownCommand': ["Unknown command", "Commande inconnue"],
  'msg.reconnected': ["Reconnected: you are back in the game", "Reconnecté : vous reprenez la partie"],
  'why.noAnswer': ["not responding", "ne répond plus"],
  'why.left': ["left", "parti"],
  'end.hostSilent': ["The host is not responding: the game is over.", "L’hôte ne répond plus : la partie est terminée."],
  'end.hostLeft': ["The host left the game.", "L’hôte a quitté la partie."],
  'msg.leftWhy': ["{name} left the game ({why}): a bot takes over", "{name} a quitté la partie ({why}) : un bot le remplace"],
  'msg.left': ["{name} left the game: a bot takes over", "{name} a quitté la partie : un bot le remplace"],
  'end.lostKicker': ["CONNECTION LOST", "CONNEXION PERDUE"],
  'end.over': ["GAME OVER", "FIN DE PARTIE"],
  'err.badPlayer': ["Invalid player", "Joueur invalide"],
  'err.alreadyAllied': ["Already allied with {name}", "Déjà allié avec {name}"],
  'err.alreadyProposed': ["Proposal already sent to {name}", "Proposition déjà envoyée à {name}"],
  'err.noAlliance': ["No alliance to betray", "Aucune alliance à trahir"],
  'err.noSpaceport': ["No spaceport on this planet", "Aucun spatioport sur cette planète"],
  'err.noShip': ["No ship in stock on this planet", "Aucun vaisseau en stock sur cette planète"],
  'msg.fleetDestroyed': ["{b} destroyed by an enemy fleet on {planet}", "{b} détruit(e) par une flotte ennemie sur {planet}"],
  'style.colons': ["colonists", "colons"],
  'style.missiles': ["missiles", "missiles"],
  'style.fleet': ["spaceships", "vaisseaux"],
  'skill.0': ["very weak", "très faible"],
  'skill.1': ["weak", "faible"],
  'skill.2': ["average", "moyen"],
  'skill.3': ["strong", "fort"],
  'skill.4': ["expert", "expert"],
  'b.city': ["City", "Ville"],
  'b.industry': ["Industry", "Industrie"],
  'b.silo': ["Silo", "Silo"],
  'b.shield': ["Shield", "Bouclier"],
  'b.colony': ["Colonization", "Colonisation"],
  'b.tradeport': ["Trade port", "Port de commerce"],
  'b.military': ["Military base", "Base militaire"],
  'b.aa': ["Air defense", "Défense anti-aérienne"],
  'b.spaceport': ["Spaceport", "Spatioport"],
  'b.undefined': ["Building", "Bâtiment"],

  // --- ui.js (jeu)
  'end.finished': ["GAME OVER", "PARTIE TERMINÉE"],
  'end.victory': ["VICTORY", "VICTOIRE"],
  'end.defeat': ["DEFEAT", "DÉFAITE"],
  'end.victorySub': ["You control {mine} territories out of {total}. Duration: {m} min {s} s.", "Vous contrôlez {mine} territoires sur {total}. Durée : {m} min {s} s."],
  'end.winnerSub': ["{name} wins the game. Duration: {m} min {s} s.", "{name} remporte la partie. Durée : {m} min {s} s."],
  'end.durationSub': ["Duration: {m} min {s} s.", "Durée : {m} min {s} s."],
  'end.eliminated': ["YOUR COLONY HAS BEEN ELIMINATED", "VOTRE COLONIE A ÉTÉ ÉLIMINÉE"],
  'end.survived': ["You survived {m} min {s} s.", "Vous avez survécu {m} min {s} s."],
  'end.wins': ["{name} wins the game.", "{name} remporte la partie."],
  'end.continues': ["The game goes on for the other players.", "La partie continue pour les autres joueurs."],
  'end.aiOwns': ["The system belongs to the AIs.", "Le système appartient aux IA."],
  'pi.noColony': ["No colony", "Aucune colonie"],
  'hud.noBuilding': ["No building", "Aucun bâtiment"],
  'bshort.aa': ["Air def.", "DAA"],
  'bshort.tradeport': ["Trade port", "Port de commerce"],
  'bshort.military': ["Military base", "Base militaire"],
  'bb.title': ["{b} — key {k}", "{b} — touche {k}"],
  'bb.launchTitle': ["Missile launch — key 0", "Lancement de missiles — touche 0"],
  'toast.placing': ["Click the planet: builds at the suggested spot (Shift + click: choose the territory) — Esc to cancel", "Cliquez sur la planète : construction à l’emplacement proposé (Maj + clic : choisir le territoire) — Échap pour annuler"],
  'toast.aimMissile': ["Aim at a point on the map and click to fire — Esc to cancel", "Visez un point de la carte et cliquez pour tirer — Échap pour annuler"],
  'toast.aimColony': ["Move the crosshair near a planet: it snaps to its edge. Click the landing point — Esc to cancel", "Approchez le viseur d’une planète : il s’accroche à son pourtour. Cliquez sur le point d’atterrissage — Échap pour annuler"],
  'toast.shipBuilt': ["Ship built (${n})", "Vaisseau construit ({n} $)"],
  'toast.aimFleet': ["Aim at an enemy fleet, or at a planet’s edge (the crosshair snaps to it) — Esc to cancel", "Visez une flotte ennemie, ou le pourtour d’une planète (le viseur s’y accroche) — Échap pour annuler"],
  'fl.all': ["(all)", "(tous)"],
  'ms.cost': ["${u} / missile", "{u} $ / missile"],
  'ms.costVolley': ["${u} / missile · volley ${t}", "{u} $ / missile · salve {t} $"],
  'co.cost': ["${u} / launch", "{u} $ / envoi"],
  'ms.ready1': ["{r}/{n} ready", "{r}/{n} prêt"],
  'ms.readyN': ["{r}/{n} ready", "{r}/{n} prêts"],
  'ms.next': [" · next in {s} s", " · prochain {s} s"],
  'toast.lockedFound': ["{planet} locked — click a territory to found your colony", "{planet} verrouillée — cliquez un territoire pour fonder"],
  'toast.fleetBadTarget': ["The target must be a planet or an enemy fleet — order cancelled", "La cible doit être une planète ou une flotte ennemie — ordre annulé"],
  'toast.fleetIntercept': ["Fleet: intercepting the enemy fleet", "Flotte : interception de la flotte ennemie"],
  'toast.fleetTo': ["Fleet heading to {planet}", "Flotte en route vers {planet}"],
  'toast.fleetLaunched1': ["Fleet of {n} ship launched!", "Flotte de {n} vaisseau lancée !"],
  'toast.fleetLaunchedN': ["Fleet of {n} ships launched!", "Flotte de {n} vaisseaux lancée !"],
  'toast.fleetSelected': ["Fleet ({n}) selected: aim at a planet or an enemy fleet — Esc to cancel", "Flotte ({n}) sélectionnée : visez une planète ou une flotte ennemie — Échap pour annuler"],
  'toast.colonyNoSnap': ["Move the crosshair near a planet to choose the landing point — launch cancelled", "Approchez le viseur d’une planète pour choisir le point d’atterrissage — lancement annulé"],
  'toast.moduleLaunched': ["Colonization module launched ({n} colonists)!", "Module de colonisation lancé ({n} colons) !"],
  'toast.missilesN': ["{n} missiles launched!", "{n} missiles lancés !"],
  'toast.missile1': ["Missile launched!", "Missile lancé !"],
  'prompt.waitPlayers': ["Colony founded. <strong>Waiting for the other players…</strong>", "Colonie fondée. <strong>En attente des autres joueurs…</strong>"],
  'toast.aimFreeCell': ["Aim at one of your free territories", "Visez un de vos territoires libres"],
  'toast.noFreeCell': ["No free territory for this building on this planet", "Aucun territoire libre pour ce bâtiment sur cette planète"],
  'toast.built': ["{b} built", "{b} construit(e)"],
  'toast.outOfReach': ["Out of reach — this player has no territory next to yours", "Hors de portée — ce camp n’a aucun territoire contigu aux vôtres"],
  'toast.clash': ["Head-on clash — the forces cancel out!", "Choc frontal — les forces s’annulent !"],
  'toast.attack': ["Attack launched — population committed", "Attaque lancée — population engagée"],
  'sb.ally': ["ALLY", "ALLIÉ"],
  'sb.proposed': ["proposed…", "proposé…"],
  'sb.traitor': ["TRAITOR", "TRAÎTRE"],
  'sb.you': ["(you)", "(vous)"],
  'tip.bot': ["Bot · favors {style} · level {level}", "Bot · dominante {style} · niveau {level}"],
  'tip.traitor': ["Traitor for {t} more: betraying them has no penalty", "Traître encore {t} : le trahir est sans pénalité"],
  'tip.alliances': ["ALLIANCES", "ALLIANCES"],
  'tip.noAlliance': ["No alliance in progress", "Aucune alliance en cours"],
  'toast.allyProposed': ["Alliance proposed to {name}…", "Alliance proposée à {name}…"],
  'cm.betray': ["Betray the alliance", "Trahir l’alliance"],
  'cm.traitorFree': ["{name} is a traitor: betraying them has no penalty.", "{name} est un traître : le trahir est sans pénalité."],
  'cm.betrayCost': ["Your defense will be divided by {d} for {s} s.", "Votre défense sera divisée par {d} pendant {s} s."],
  'cm.sent': ["Proposal sent…", "Proposition envoyée…"],
  'cm.propose': ["Propose an alliance ({m} min)", "Proposer une alliance ({m} min)"],
  'cm.warnTraitor': ["Careful: {name} betrayed someone recently.", "Attention : {name} a trahi récemment."],
  'dip.refused': ["{name} refuses the alliance", "{name} refuse l’alliance"],
  'dip.formed': ["Alliance formed with {name} for {m} minutes", "Alliance conclue avec {name} pour {m} minutes"],
  'dip.formedOthers': ["{a} and {b} formed an alliance", "{a} et {b} ont conclu une alliance"],
  'dip.howMissile': [" (missile on an allied territory)", " (missile sur un territoire allié)"],
  'dip.youBetrayed': ["You betrayed {name}{how}", "Vous avez trahi {name}{how}"],
  'dip.youBetrayedFree': ["{name} was a traitor: no penalty.", "{name} était un traître : aucune pénalité."],
  'dip.youBetrayedCost': ["Your defense is divided by {d} for {s} s.", "Votre défense est divisée par {d} pendant {s} s."],
  'dip.betrayedYou': ["{name} betrayed you{how}!", "{name} vous a trahi{how} !"],
  'dip.betrayedYouFree': ["You were marked as a traitor: they suffer no penalty.", "Vous étiez marqué comme traître : il ne subit aucune pénalité."],
  'dip.betrayedYouCost': ["Their defense is divided by {d} for {s} s: time to strike back.", "Sa défense est divisée par {d} pendant {s} s : c’est le moment de riposter."],
  'dip.betrayedOthers': ["{a} betrayed {b}", "{a} a trahi {b}"],
  'dip.ended': ["Alliance with {name} has ended", "Fin de l’alliance avec {name}"],

  // --- serveur / connexion
  'srv.full': ["The server is full, try again later.", "Le serveur est plein, réessayez plus tard."],
  'srv.noCode': ["No game matches this code.", "Aucune partie ne correspond à ce code."],
  'srv.started': ["This game has already started.", "Cette partie a déjà commencé."],
  'srv.full2': ["This game is full.", "Cette partie est complète."],
  'srv.hostOnly': ["Only the host can start the game.", "Seul l’hôte peut lancer la partie."],
  'srv.needOpponent': ["You need at least one opponent: wait for a player or enable bots.", "Il faut au moins un adversaire : attendez un joueur ou activez les bots."],
  'srv.otherTab': ["Game resumed in another tab.", "Partie reprise dans un autre onglet."],
  'srv.reserved': ["The name “{name}” belongs to a registered player: log in, or choose another name.", "Le pseudo « {name} » appartient à un joueur inscrit : connectez-vous, ou choisissez un autre pseudo."],
  'net.lost': ["Connection to the server lost.", "Connexion au serveur perdue."],
  'net.reconnecting': ["Connection lost — reconnecting…", "Connexion perdue — reconnexion…"],
  'net.noAnswer': ["The server is not responding.", "Le serveur ne répond pas."],
  'net.updatedMidGame': ["The server has just been updated: the game was interrupted. Reload the page to play again.", "Le serveur vient d’être mis à jour : la partie a été interrompue. Rechargez la page pour rejouer."],
  'net.gameGone': ["The game is no longer available (disconnected for too long).", "La partie n’est plus disponible (coupure trop longue)."],
  'net.closed': ["Game closed.", "Partie fermée."],
  'net.mismatch': ["A new version of the game is available (game {game}, server {server}). Reload the page; if this message stays, try again in a minute.", "Une nouvelle version du jeu est disponible (jeu {game}, serveur {server}). Rechargez la page ; si ce message reste, réessayez dans une minute."],
  'net.online': ["Connected to the server", "Connecté au serveur"],
  'net.unreachable': ["Server unreachable for now: you can play solo in the meantime.", "Serveur injoignable pour le moment : vous pouvez jouer en solo en attendant."],
  'net.connecting': ["Connecting to the server… (if it was asleep, waking up can take up to a minute)", "Connexion au serveur… (s’il était en veille, son réveil peut prendre jusqu’à une minute)"],

  // --- net.js (salons)
  'lob.codeFormat': ["The code has 4 to 6 letters or digits.", "Le code contient 4 à 6 lettres ou chiffres."],
  'lob.noCode': ["No game matches the code {code}.", "Aucune partie ne correspond au code {code}."],
  'lob.gone': ["This game no longer exists.", "Cette partie n’existe plus."],
  'lob.noRoom': ["No room", "Aucun salon"],
  'lob.needOpp': ["You need at least one opponent.", "Il faut au moins un adversaire."],
  'acc.soon': ["Accounts are coming soon: for now, a name is enough to play.", "Les comptes arrivent bientôt : pour l’instant, un pseudo suffit pour jouer."],
  'acc.googleSoon': ["Google sign-in is coming soon.", "La connexion Google arrive bientôt."],
  'lob.gameOf': ["{name}’s game", "Partie de {name}"],
  'lob.inProgress': ["This game is already in progress.", "Cette partie est déjà en cours."],
  'lob.tooLate': ["This game is starting, too late to join.", "Cette partie démarre, trop tard pour la rejoindre."],
  'lob.hostSilent': ["The host is not responding: the room has closed.", "L’hôte ne répond plus : le salon a fermé."],
  'lob.hostClosed': ["The host closed the room.", "L’hôte a fermé le salon."],

  // --- account.js
  'acc.unreachable': ["Account service unreachable. Check your connection.", "Service des comptes injoignable. Vérifiez votre connexion."],
  'acc.e.creds': ["Incorrect email or password.", "E-mail ou mot de passe incorrect."],
  'acc.e.unconfirmed': ["Email address not confirmed yet: click the link you received by email.", "Adresse e-mail pas encore confirmée : cliquez sur le lien reçu par e-mail."],
  'acc.e.exists': ["An account already exists with this email address.", "Un compte existe déjà avec cette adresse e-mail."],
  'acc.e.weak': ["Password too weak: 8 characters minimum.", "Mot de passe trop faible : 8 caractères minimum."],
  'acc.e.mailRate': ["Too many emails sent: try again in a few minutes.", "Trop d’e-mails envoyés : réessayez dans quelques minutes."],
  'acc.e.rate': ["Too many attempts: try again in a few minutes.", "Trop de tentatives : réessayez dans quelques minutes."],
  'acc.e.signupOff': ["Sign-ups are closed for now.", "Les inscriptions sont fermées pour le moment."],
  'acc.e.badEmail': ["Invalid email address.", "Adresse e-mail non valable."],
  'acc.e.samePass': ["The new password must be different from the old one.", "Le nouveau mot de passe doit être différent de l’ancien."],
  'acc.e.session': ["Session expired: log in again.", "Session expirée : reconnectez-vous."],
  'acc.e.generic': ["Something went wrong. Try again.", "Une erreur est survenue. Réessayez."],
  'acc.linkExpired': ["Link expired or already used: start again.", "Lien expiré ou déjà utilisé : recommencez."],
  'acc.linkBad': ["Invalid link.", "Lien non valable."],
  'acc.confirmed': ["Address confirmed: you are logged in!", "Adresse confirmée : vous êtes connecté !"],
  'acc.pseudoTaken': ["The name “{name}” is already taken.", "Le pseudo « {name} » est déjà pris."],
  'acc.checkMail': ["Almost done: click the link sent to {email} to confirm your account.", "Presque fini : cliquez sur le lien envoyé à {email} pour confirmer votre compte."],
  'acc.recoverSent': ["If an account exists for {email}, an email has just been sent with a link to choose a new password.", "Si un compte existe pour {email}, un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe."],
  'acc.resetExpired': ["Link expired: start “Forgot password” again.", "Lien expiré : recommencez « Mot de passe oublié »."],

  // --- lobby.js
  'lob.pseudoLen': ["Choose a name of 2 to 16 characters.", "Choisissez un pseudo de 2 à 16 caractères."],
  'lob.pseudoChars': ["Letters, digits, spaces, “_”, “-” and “.” only.", "Lettres, chiffres, espaces, « _ », « - » et « . » uniquement."],
  'acc.passLen': ["The password must have at least 8 characters.", "Le mot de passe doit contenir au moins 8 caractères."],
  'acc.passMismatch': ["The two passwords do not match.", "Les deux mots de passe ne correspondent pas."],
  'lob.yourRoom': ["Your room", "Votre salon"],
  'lob.startsIn': ["Starts in {s} s", "Démarre dans {s} s"],
  'lob.playing': ["In progress", "En cours"],
  'lob.full': ["Full", "Complète"],
  'lob.waiting': ["Waiting", "En attente"],
  'lob.noGames': ["No public game open right now. Create your own!", "Aucune partie publique ouverte pour le moment. Créez la vôtre !"],
  'lob.join': ["Join", "Rejoindre"],
  'lob.gameMeta': ["Host: {host} · {n} planets · {status}", "Hôte : {host} · {n} planètes · {status}"],
  'net.reload': ["Reload", "Recharger"],
  'net.offSim': ["Server not online yet: games and players are simulated by bots, for testing.", "Serveur pas encore en ligne : parties et joueurs simulés par des bots, pour tester."],
  'net.offLocal': ["Server not online yet: games are played locally, against bots.", "Serveur pas encore en ligne : les parties se jouent en local, contre des bots."],
  'lob.visPublic': ["Visible in the list of public games; it can also be joined with its code.", "Visible dans la liste des parties publiques ; on peut aussi la rejoindre avec son code."],
  'lob.visPrivate': ["Hidden from the list: only players who have the code can join.", "Invisible dans la liste : seuls les joueurs qui ont le code peuvent la rejoindre."],
  'lob.public': ["Public", "Publique"],
  'lob.private': ["Private", "Privée"],
  'lob.nPlanets': ["{n} planets", "{n} planètes"],
  'lob.maxPlayers': ["{n} players max", "{n} joueurs max"],
  'lob.host': ["Host: {name}", "Hôte : {name}"],
  'lob.you': ["you", "vous"],
  'lob.bots': ["Bots in empty seats", "Bots sur les places libres"],
  'lob.noBots': ["No bots", "Sans bots"],
  'lob.hostTag': ["HOST", "HÔTE"],
  'lob.botSlot': ["Bot at launch", "Bot au lancement"],
  'lob.freeSlot': ["Empty seat", "Place libre"],
  'lob.startsInNote': ["The game starts in {s} s…", "La partie démarre dans {s} s…"],
  'lob.waitHost': ["Waiting for {name} to start. The game starts when the room is full, or when the host decides.", "En attente du lancement par {name}. Elle démarre quand le salon est complet, ou quand l’hôte le décide."],
  'lob.needOther': ["Wait for at least one other player, or enable bots to start.", "Attendez au moins un autre joueur, ou activez les bots pour lancer."],
  'lob.share': ["Share the code; start whenever you want.", "Partagez le code ; lancez quand vous voulez."],
  'lob.shareBots': ["Empty seats will be taken by bots.", "Les places libres seront prises par des bots."],
  'lob.testTabs': ["(Test: for now, players can join from another tab of this browser.)", "(Test : pour l’instant, les joueurs peuvent rejoindre depuis un autre onglet de ce navigateur.)"],
  'lob.simNote': ["(Simulated players while waiting for the server.)", "(Joueurs simulés en attendant le serveur.)"],
  'lob.copied': ["Code copied", "Code copié"],
  'lob.selected': ["Code selected: copy it with Ctrl+C", "Code sélectionné : copiez-le avec Ctrl+C"],
  'prompt.found': ["Click a planet to <strong>lock</strong> it, then a territory on its rim to found your colony.", "Cliquez sur une planète pour la <strong>verrouiller</strong>, puis sur un territoire de sa couronne pour fonder votre colonie."],
  'acc.titleMe': ["My account", "Mon compte"],
  'acc.titleReset': ["New password", "Nouveau mot de passe"],
  'acc.title': ["Your account", "Votre compte"],
  'acc.submitReg': ["CREATE MY ACCOUNT", "CRÉER MON COMPTE"],
  'acc.submitLogin': ["LOG IN", "SE CONNECTER"],
  'acc.enterEmail': ["Enter a valid email address.", "Saisissez une adresse e-mail valide."],
  'acc.pseudoChars': ["Name: letters, digits, spaces, “_”, “-” and “.” only.", "Pseudo : lettres, chiffres, espaces, « _ », « - » et « . » uniquement."],
  'acc.welcome': ["Logged in: welcome {name}!", "Connecté : bienvenue {name} !"],
  'acc.emailFirst': ["First enter your email address above.", "Saisissez d’abord votre adresse e-mail ci-dessus."],
  'acc.passSaved': ["Password saved: you are logged in.", "Mot de passe enregistré : vous êtes connecté."],
  'acc.pseudoTitle': ["Your account name", "Pseudo de votre compte"],
  'acc.chipMe': ["{name} · My account", "{name} · Mon compte"],
  'acc.chipLogin': ["Log in · Sign up", "Se connecter · S’inscrire"],
  'acc.hintMe': ["stats saved", "statistiques enregistrées"],
  'acc.hint': ["to reserve your name and keep your stats", "pour réserver votre pseudo et garder vos statistiques"],
  'acc.loggedOut': ["You are logged out.", "Vous êtes déconnecté."],
  'lob.launching': ["“{name}” is starting!", "« {name} » démarre !"],
  'lob.roomClosed': ["The room has closed.", "Le salon a fermé."],

  // --- overview.js
  'mp.atkTitle': ["Territories under attack", "Territoires attaqués"],
  'mp.combat': ["COMBAT", "COMBAT"],
  'mp.incTitle': ["Enemy missiles or modules incoming", "Missiles ou modules ennemis en approche"],
  'mp.incoming': ["{n} INCOMING", "{n} EN APPROCHE"],
  'mp.info': ["{n} terr. · {pop}", "{n} terr. · {pop}"],
  'mp.head': ["MY PLANETS", "MES PLANÈTES"],
  'mp.tab': ["Tab: next", "Tab : suivante"],
  'mp.none': ["None", "Aucune"],
  'edge.missile': ["MISSILE", "MISSILE"],
  'edge.colonists': ["COLONISTS", "COLONS"],

  // --- index.html (menus, HUD)
  'home.kicker': ["REAL-TIME STRATEGY — MULTIPLAYER", "STRATÉGIE TEMPS RÉEL — MULTIJOUEUR"],
  'home.howto': ["How to play?", "Comment jouer ?"],
  'home.pseudo': ["YOUR NAME", "VOTRE PSEUDO"],
  'home.pseudoPh': ["e.g. Captain_Nova", "ex. Capitaine_Nova"],
  'home.public': ["PUBLIC GAMES", "PARTIES PUBLIQUES"],
  'home.refresh': ["Refresh", "Actualiser"],
  'home.private': ["PRIVATE GAME", "PARTIE PRIVÉE"],
  'home.codeAria': ["Private game code", "Code de la partie privée"],
  'home.new': ["NEW GAME", "NOUVELLE PARTIE"],
  'home.newText': ["Choose the system, public or private, and share the code with your friends.", "Choisissez le système, publique ou privée, et partagez le code avec vos amis."],
  'home.create': ["CREATE A GAME", "CRÉER UNE PARTIE"],
  'home.solo': ["Quick solo game against 3 bots", "Partie solo rapide contre 3 bots"],
  'cr.title': ["Create a game", "Créer une partie"],
  'cr.name': ["GAME NAME", "NOM DE LA PARTIE"],
  'cr.vis': ["VISIBILITY", "VISIBILITÉ"],
  'cr.visAria': ["Visibility", "Visibilité"],
  'cr.privateCode': ["Private (code)", "Privée (code)"],
  'cr.maxp': ["MAX PLAYERS", "JOUEURS MAX"],
  'cr.planets': ["PLANETS", "PLANÈTES"],
  'cr.fill': ["Fill empty seats with bots at launch", "Compléter les places libres avec des bots au lancement"],
  'cr.back': ["Back", "Retour"],
  'cr.go': ["CREATE THE ROOM", "CRÉER LE SALON"],
  'lb.code': ["GAME CODE", "CODE DE LA PARTIE"],
  'lb.copy': ["Copy", "Copier"],
  'lb.players': ["PLAYERS", "JOUEURS"],
  'lb.leave': ["Leave the room", "Quitter le salon"],
  'lb.start': ["START THE GAME", "LANCER LA PARTIE"],
  'ui.close': ["Close", "Fermer"],
  'acc.intro': ["An account reserves your name and keeps your stats (games played, wins). It is optional to play.", "Un compte réserve votre pseudo et conserve vos statistiques (parties jouées, victoires). Il reste facultatif pour jouer."],
  'acc.tabLogin': ["Log in", "Connexion"],
  'acc.tabReg': ["Sign up", "Inscription"],
  'acc.google': ["Continue with Google", "Continuer avec Google"],
  'acc.orEmail': ["or by email", "ou par e-mail"],
  'acc.pseudo': ["NAME", "PSEUDO"],
  'acc.email': ["EMAIL", "E-MAIL"],
  'acc.pass': ["PASSWORD", "MOT DE PASSE"],
  'acc.pass2': ["CONFIRM PASSWORD", "CONFIRMER LE MOT DE PASSE"],
  'acc.forgot': ["Forgot password?", "Mot de passe oublié ?"],
  'acc.games': ["online games", "parties en ligne"],
  'acc.wins': ["wins", "victoires"],
  'acc.rate': ["win rate", "taux de victoire"],
  'acc.statsNote': ["Stats count finished online games.", "Les statistiques comptent les parties en ligne terminées."],
  'acc.logout': ["Log out", "Se déconnecter"],
  'acc.chooseNew': ["Choose your new password.", "Choisissez votre nouveau mot de passe."],
  'acc.newPass': ["NEW PASSWORD", "NOUVEAU MOT DE PASSE"],
  'acc.confirm': ["CONFIRM", "CONFIRMER"],
  'acc.save': ["SAVE", "ENREGISTRER"],
  'hud.money': ["MONEY", "ARGENT"],
  'hud.pop': ["POPULATION", "POPULATION"],
  'sb.players': ["PLAYERS", "JOUEURS"],
  'sb.hint': ["right-click: diplomacy", "clic droit : diplomatie"],
  'ally.kicker': ["ALLIANCE PROPOSAL", "PROPOSITION D’ALLIANCE"],
  'ally.offers': ["offers you a 5-minute alliance", "vous propose une alliance de 5 minutes"],
  'ally.sub': ["During the alliance, you cannot attack each other.", "Pendant l’alliance, vous ne pourrez plus vous attaquer l’un l’autre."],
  'ally.yes': ["Accept", "Accepter"],
  'ally.no': ["Decline", "Refuser"],
  'bt.kicker': ["BETRAYAL", "TRAHISON"],
  'pi.pop': ["Population", "Population"],
  'ms.label': ["MISSILES", "NOMBRE DE MISSILES"],
  'ms.silosAria': ["Planet silo status", "État des silos de la planète"],
  'ms.launch': ["LAUNCH<br>MISSILES", "LANCEMENT<br>MISSILES"],
  'co.label': ["COLONISTS (% PLANET POP.)", "COLONS (% POP. PLANÈTE)"],
  'co.launch': ["LAUNCH<br>COLONISTS", "LANCEMENT<br>COLONISATION"],
  'fl.ships': ["SHIPS", "VAISSEAUX"],
  'fl.stock': ["IN STOCK", "EN STOCK"],
  'fl.build': ["+1 ship", "+1 vaisseau"],
  'fl.launch': ["LAUNCH<br>FLEET", "LANCEMENT<br>FLOTTE"],
  'end.again': ["PLAY AGAIN", "REJOUER"],
  'mm.title': ["Minimap: click to go there", "Mini-carte : cliquez pour vous y rendre"],

  // --- divers
  'sb.youName': ["You", "Vous"],
};
