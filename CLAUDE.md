# Solar Conquest — consignes de travail

- Répondre en français.
- À chaque évolution des règles ou de l'interface, mettre aussi à jour :
  1. le tutoriel « Comment jouer ? » : texte dans `client/index.html` (bloc `#howto`),
     chiffres lus automatiquement dans `CONFIG` via `data-cfg` ; illustrations à refaire
     avec `python3 tools/tuto_captures.py [nom]` si l'écran a changé ;
  2. le document de design `docs/Solar Conquest - Game Design.docx` ;
  3. le numéro de version dans `package.json` (le serveur et le jeu doivent avoir le même).
- Le serveur (`server/`) exécute les fichiers de jeu du client (config, world, game, fleet,
  diplomacy, ai, session) : toute règle doit y fonctionner sans affichage.
- Ne jamais mettre la clé secrète Supabase dans le code (variable d'environnement sur Render).
