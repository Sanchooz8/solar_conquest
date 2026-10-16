// ============================================================
// SOLAR CONQUEST — Configuration & équilibrage
// Toutes les valeurs de gameplay sont regroupées ici pour
// pouvoir ajuster l'équilibre facilement.
// ============================================================

const CONFIG = {
  // Fonctionnalités activables. Les vaisseaux (spatioport, flottes) sont en
  // veille : le code est conservé, mais rien n'apparaît en jeu et les bots
  // ne les utilisent pas. Passer à true pour les réactiver.
  features: {
    fleets: false,
  },

  // Serveur de jeu multijoueur (adresse WebSocket, ex. 'wss://solar-conquest.onrender.com').
  // Vide : mode local (solo et salons de test). On peut aussi tester un autre
  // serveur en ajoutant ?server=wss://… à l'adresse de la page.
  server: {
    url: '',
  },

  system: {
    sunRadius: 52,
    firstOrbit: 150,          // distance de la 1re orbite au soleil
    orbitGapMin: 30,          // espace min entre deux orbites
    orbitGapMax: 70,
    planetRadiusMin: 24,
    planetRadiusMax: 48,
    spinMin: 0.03,            // rad/s — rotation "vinyle" min
    spinMax: 0.15,            // rad/s — rotation max
    orbitSpeedBase: 0.24,     // révolution = base / sqrt(orbit/100) — ralentie de 20 %
    orbitSpeedJitter: 0.35,   // variation aléatoire de révolution
  },

  grid: {
    sectorsMedium: 100,       // territoires en couronne pour une planète moyenne
    mediumRadius: 36,         // rayon d'une planète "moyenne"
    sectorsMin: 60,
    sectorsMax: 140,
    bandRatio: 0.067,         // épaisseur de la couronne / rayon (croûte fine)
    bandMin: 2,               // épaisseur minimale de la couronne
  },

  econ: {
    startMoney: 500,
    cityCost: 130,
    industryCost: 110,
    industryIncome: 2.8,      // $/s par industrie (rythme global ralenti de 20 %)
    incomePerPop: 0.008,      // $/s par point de population réelle (divisé par 2 — équilibrage v2)
    siloCost: 160,            // coût d'un silo à missiles
    shieldCost: 200,          // coût d'un bouclier
    colonyCost: 250,          // coût d'un centre de colonisation
    tradeportCost: 216,       // coût d'un port de commerce (+20 %)
    militaryCost: 200,        // coût d'une base militaire
    aaCost: 190,              // coût d'une défense anti-aérienne
    spaceportCost: 220,       // coût d'un spatioport
    costEscalation: 1.25,     // chaque bâtiment du même type sur une planète coûte ×1,25
  },

  shield: {
    arcSectors: 8,            // le bouclier couvre ~8 territoires de chaque côté
    grazeDepth: 0.5,          // explosion à moins de rayon + 50 % du cratère → dégâts au sol
    downTime: 12,             // touché par un missile : bouclier désactivé pendant 12 s
  },

  // Cargo de commerce : lancé par un port de commerce toutes les 30 s vers
  // une ville d'une planète aléatoire ; à l'arrivée, revenu important pour
  // l'expéditeur ET le destinataire. Suit sa cible comme un module de
  // colonisation et n'est pas bloqué par les boucliers.
  trade: {
    interval: 30,             // un cargo par planète équipée toutes les 30 s
    speed: 60,                // vitesse de croisière…
    boostAfter: 40,           // …au-delà de 40 s de voyage, accélération progressive
    boostRate: 4,             //    (+4 u/s par seconde) : il finit toujours par rattraper sa cible
    accel: 60,                // poussée jusqu'à la vitesse de croisière
    turn: 2.2,                // virage max (rad/s) — suit sa destination, visée anticipée
    riseSpeed: 32,            // décollage vertical depuis le port…
    riseAltitude: 45,         // …jusqu'à 45 u au-dessus de la surface avant de virer
    maxLife: 150,             // garde-fou : l'accélération garantit l'arrivée bien avant
    rewardSender: 150,        // revenu pour le joueur qui envoie le cargo
    rewardReceiver: 150,      // revenu pour le propriétaire du marché destinataire
    cityShare: 0.5,           // un seul port dans la partie : livraison à une ville, gains ÷ 2
  },


  // Module de colonisation : plus lent qu'un missile (120) mais plus rapide
  // qu'une planète (~20-50 u/s), et il suit sa planète cible pendant le vol
  // (les boucliers ne l'arrêtent pas — il transporte des troupes).
  colony: {
    speed: 80,                // vitesse de croisière
    accel: 70,                // poussée jusqu'à la vitesse de croisière
    turn: 2.6,                // virage max (rad/s) — suivi continu de la planète
    maxLife: 60,              // durée de vie (cibles mouvantes, contournement de la planète)
    attackShare: 0.35,        // part des colons engagée sur chaque territoire adjacent
    minColonists: 10,         // effectif minimum pour lancer un module
    approachAlt: 30,          // point d'atterrissage choisi : approche à 30 u au-dessus du point…
    landArc: 0.45,            // …et atterrissage seulement à moins de 0,45 rad (≈ 26°) de ce point
  },

  // Base militaire : soutien offensif, défensif, et tir d'artillerie local.
  military: {
    attackBonus: 0.20,        // +20 % de force à une attaque si la base est à portée locale de la cible
    maxAttackBases: 3,        // bonus cumulable jusqu'à 3 bases (+60 % max)
    defenseBonus: 0.20,       // +20 % de défense pour la base et ses 2 territoires adjacents
    fireRange: 7,             // portée de tir (territoires), même planète — vise l'ennemi le PLUS ÉLOIGNÉ à portée
    fireInterval: 10,         // un tir toutes les 10 s
    fireDamage: 50,           // population tuée à l'impact (à 0, le territoire redevient neutre)
    shellFlightTime: 1.1,     // durée de vol de l'obus (s)
    shellArc: 0.35,           // hauteur de l'arc, en rayons de planète
  },

  // Défense anti-aérienne (DAA) : tire des mini-missiles téléguidés sur les
  // menaces venues de l'espace (missiles et modules de colonisation ennemis)
  // détectées dans un cône orienté vers le ciel au-dessus du bâtiment.
  aa: {
    coneHalfAngle: 55,        // demi-angle du cône (degrés) → cône de 110°
    range: 120,               // portée de détection (unités ; planète moyenne : rayon 36)
    fireInterval: 3,          // un mini-missile toutes les 3 s
    interceptorSpeed: 230,    // vitesse du mini-missile (missile ennemi : 120, module : 80)
    interceptorTurn: 7,       // virage max (rad/s) — guidage serré
    interceptorLife: 2.2,     // durée de vie (s) : au-delà, autodestruction
    hitRadius: 4,             // distance d'impact
    moduleHits: 2,            // un module de colonisation encaisse 2 impacts
    showCone: true,           // cône de détection visible (réglage)
  },

  // Spatioport et flottes de vaisseaux
  fleet: {
    shipCost: 200,            // premier vaisseau
    shipCostEscalation: 1.25, // +25 % par vaisseau existant du joueur (stock + en vol)
    speed: 60,                // vitesse de croisière (missile 120, module 80)
    catchUpFactor: 1.25,      // jamais moins de 1,25 × la vitesse de la cible…
    catchUpMargin: 8,         // …+ 8 u/s : une flotte rattrape toujours une planète rapide
    accel: 50,
    turn: 2.4,                // virage max (rad/s)
    orbitGap: 16,             // altitude de l'orbite au-dessus de la surface
    orbitTurn: 0.7,           // glissement le long de l'orbite vers la cible (rad/s)
    formationRadius: 6,       // taille de la formation (6 vaisseaux)
    engageDistance: 26,       // distance d'arrêt face à une flotte visée
    weaponRange: 32,          // portée de tir des vaisseaux (-20 %)
    fireInterval: 2,          // un tir toutes les 2 s par vaisseau
    boltLife: 0.18,           // durée d'affichage du trait de tir
    buildingHits: 5,          // tirs pour détruire un bâtiment
    defenseInterval: 1,       // chaque bâtiment riposte : un petit tir par seconde…
    defenseRange: 24,         // …sur les vaisseaux en orbite (altitude 16 + formation), pas au-delà
    hullHits: 8,              // tirs de bâtiment pour détruire un vaisseau
    shipHits: 2,              // tirs de vaisseau pour détruire un vaisseau ennemi
    missileHitRadius: 3,      // contact missile / vaisseau
    missileBlastRadius: 12,   // souffle de l'explosion
    missileMaxKills: 3,       // vaisseaux détruits au maximum par explosion
  },

  silo: {
    capacity: 1,              // un seul missile par silo
    reloadTime: 10,           // s de recharge après un tir
  },

  missiles: {
    riseTime: 1.3,            // s de montée verticale avant la balistique
    riseSpeed: 30,            // unités/s pendant la montée
    flightSpeed: 120,         // vitesse de croisière en vol
    thrustAccel: 90,          // accélération (u/s²) après la montée, virage progressif
    gravSun: 250000,          // constante gravitationnelle du soleil
    gravPlanet: 20000,        // × (rayon/36)² pour chaque planète
    softening: 600,           // adoucissement anti-singularité (r² + soft)
    maxLife: 15,              // durée de vie max d'un missile en vol (s)
    homingTurn: 1.5,          // rad/s — correction de cap vers le point visé
    craterRadius: 5.5,        // rayon du cercle d'explosion (+25 % : ~4 territoires de large)
  },

  ui: {
    buildingMinPx: 8,         // taille minimale d'affichage des bâtiments (px écran)
    lockZoomBoost: 1.4,       // verrouillage en cours de partie : zoom ×1,4 max
    popEmptyAlpha: 0.28,      // jauge de population : opacité de la partie vide d'un territoire
    aim: {                    // viseur aimanté (colonisation, flottes)
      gear: 0.5,              // le viseur tourne 2 fois moins vite que la souris autour de la planète
      hold: 2.2,              // il se décroche à 2,2 × la distance d'accroche
    },
    shade: { light: 0.07, dark: 0.55 },      // ombrage des planètes par le soleil
    shadow: {                                 // ombre portée des vaisseaux, cargos, modules
      baseOffset: 2,          // décalage de l'ombre à l'opposé du soleil au ras du sol…
      maxOffset: 12,          // …et en plus à pleine altitude
      minScale: 0.55,         // taille de l'ombre : 100 % au ras du sol, 55 % en haut
      alpha: 0.45,            // opacité au ras du sol
      climb: 45,              // un cargo/module atteint sa pleine altitude à 45 u d'une surface
      fleetAlt: 0.85,         // altitude des vaisseaux en orbite
      reach: 40,              // ombre portée seulement à moins de 40 u d'une surface
      rimInset: 7,            // objet longeant le bord : ombre rentrée sous lui (plus si haut)
      sunShift: 3,            // léger décalage à l'opposé du soleil
    },
  },

  pop: {
    startPop: 55,             // population de la colonie de départ
    baseCap: 70,              // plafond de population par territoire
    cityCapBonus: 150,        // bonus de plafond avec une ville
    growthRate: 2.8,          // croissance maximale (pop/s), atteinte à 45 % du plafond — pour un plafond de 100 (dépend de la pop max, divisée par 2 — équilibrage v2)
    growthInflection: 0.45,   // fraction du plafond où la croissance est la plus rapide
    cityGrowthMult: 1.6,      // multiplicateur de croissance avec ville
  },

  combat: {
    attackShare: 0.10,        // part de la pop. LOCALE du joueur engagée (cf. localRange)
    localRange: 15,           // guerre locale : seuls les territoires à ≤ 15 secteurs
                              // de la cible fournissent la force d'attaque et le soutien
    attackCost: 50,           // coût en argent de chaque attaque
    minAttackForce: 5,        // force minimale pour lancer une attaque
    neutralDefense: 10,       // résistance d'un territoire neutre
    chipRatio: 0.30,          // dégâts/s à la défense = force × ratio
    minChip: 2.0,             // dégâts/s minimum garanti
    defAttrition: 0.05,       // attrition/s de l'attaque = défense × coef
    garrisonShare: 0.3,       // part de la force restante qui reste en garnison
    cascadeMinForce: 10,      // force min pour cascader sur le territoire suivant
    planetSupport: 0.05,      // bonus de défense = 5 % de la pop. LOCALE du défenseur (cf. localRange)
  },

  ai: {
    tickMin: 1.2,             // (ancien) délai entre décisions — remplacé par tickSlow/tickFast
    tickMax: 2.4,
    // Niveau des bots : 0 = très faible, 1 = très fort. Pour l'instant : faible.
    skillMin: 0.15,
    skillMax: 0.35,
    tickSlow: 3.2,            // délai entre deux décisions au niveau 0 (s)…
    tickFast: 0.8,            // …et au niveau 1
    mistakeMax: 0.55,         // probabilité de choisir une construction au hasard au niveau 0
    aimErrMax: 70,            // erreur de visée des missiles au niveau 0 (u)…
    aimErrMin: 4,             // …et au niveau 1
    landErrMax: 0.7,          // erreur d'angle de colonisation / de flotte au niveau 0 (rad)
    spaceCooldownSlow: 60,    // délai minimal entre deux opérations spatiales au niveau 0 (s)…
    spaceCooldownFast: 15,    // …et au niveau 1
    styleWeight: 1,           // poids de la dominante
    sideWeight: 0.35,         // poids des deux autres voies
  },

  // Diplomatie : alliances temporaires
  diplomacy: {
    duration: 300,            // une alliance dure 5 minutes
    requestTimeout: 20,       // une proposition sans réponse expire au bout de 20 s
    botThinkMin: 2,           // délai de réponse d'un bot (s)
    botThinkMax: 5,
    botAcceptChance: 0.4,     // un bot accepte sinon avec 40 % de chances
    botProposeMin: 70,        // un bot envisage une proposition toutes les 70 à 140 s…
    botProposeMax: 140,
    botProposeChance: 0.35,   // …et la fait avec 35 % de chances (voisins de planète)
    betrayDefenseDiv: 5,      // trahison : défense du traître divisée par 5…
    betrayVulnerable: 30,     // …pendant 30 s (l'attaque n'est pas touchée)
    traitorMark: 30,          // marqué « traître » 30 s, visible de tous : le trahir est sans pénalité
  },

  victoryShare: 0.90,         // part des territoires pour gagner
};

// Couleurs des joueurs (index 0 = joueur humain)
const PLAYER_COLORS = [
  '#00aaff', // cyan    — vous
  '#cdfb52', // lime
  '#f756a3', // rose
  '#ff2a00', // rouge-orange
  '#b28dff', // violet
  '#ffd166', // jaune
];

const BOT_NAMES = ['Vex', 'Kora', 'Nul', 'Iris', 'Zorg'];
