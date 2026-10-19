# Solar Conquest

Jeu de conquête spatiale en temps réel, dans le navigateur, de 2 à 6 joueurs (humains ou bots).

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `client/` | Le jeu (HTML, CSS, JavaScript sans framework). C'est ce que voient les joueurs. |
| `server/` | Le serveur de jeu multijoueur (Node.js + WebSocket). Il fait tourner les parties en ligne avec **le même code de jeu** que le navigateur (`client/js`). |
| `tools/build.mjs` | Assemble le jeu en un seul fichier `dist/index.html`, à héberger sur Netlify. |
| `docs/` | Document de design du jeu. |
| `render.yaml` | Configuration de l'hébergement du serveur sur Render. |

## Comment ça marche

- **Solo** : tout se passe dans le navigateur, sans serveur.
- **En ligne** : le serveur gère les salons (codes à 4 caractères, liste des parties publiques), fait tourner chaque partie (bots compris), vérifie et applique les ordres des joueurs, et leur envoie l'état de la partie 10 fois par seconde. Un joueur dont la connexion saute (ou qui recharge la page) a 60 secondes pour revenir avant d'être remplacé par un bot.
- L'adresse du serveur se règle dans `client/js/config.js` (`server.url`). Pour tester un autre serveur sans rien changer : ajouter `?server=wss://adresse-du-serveur` à l'adresse de la page.

## Lancer en local

```bash
npm install
npm start                       # serveur sur le port 8080
# dans un autre terminal, servir le dossier client :
cd client && python3 -m http.server 8000
# puis ouvrir http://localhost:8000/?server=ws://localhost:8080 dans deux navigateurs
```

## Mettre en ligne

1. **Serveur (Render)** : New → Web Service → ce dépôt. Region Frankfurt, Build `npm install`, Start `npm start`, Instance Free. (Ou New → Blueprint, qui lit `render.yaml`.)
2. **Jeu (Netlify)** : le site Netlify est relié à ce dépôt ; à chaque mise à jour, il exécute `npm run build` et publie `dist/` (cf. `netlify.toml`). Sans liaison : `npm run build`, puis glisser le dossier `dist` dans l'onglet *Deploys*.

## Comptes joueurs (Supabase)

Les comptes (e-mail + mot de passe) sont gérés par Supabase ; ils restent facultatifs (on peut jouer en invité).

1. Créer un projet sur supabase.com (région Europe), puis dans **SQL Editor** coller et exécuter `supabase/schema.sql`.
2. **Authentication → URL Configuration** : *Site URL* = l'adresse du site Netlify (les liens de confirmation et de mot de passe oublié y renvoient).
3. Dans `client/js/config.js` (`supabase`) : l'adresse du projet et la clé **publique** (*publishable* / *anon*).
4. Sur Render, variables d'environnement du service : `SUPABASE_URL` et `SUPABASE_SERVICE_KEY` (clé **secrète** ; jamais dans le code).

Le serveur vérifie le jeton de connexion de chaque joueur, réserve les pseudos des comptes (un invité ne peut pas les prendre) et enregistre chaque partie en ligne terminée (table `matches`, statistiques dans `player_stats`).

## Langues

Le jeu est en anglais par défaut, avec un sélecteur English / Français en haut à gauche de l'accueil (`?lang=fr` dans l'adresse force le français). Tous les textes sont dans `client/js/i18n.js` : dans le code, `T('clé', { param })` ; dans le HTML, l'attribut `data-i18n="clé"`. Le serveur envoie des clés (`{ k, p }`) que chaque joueur traduit dans sa langue.

## Tutoriel « Comment jouer ? »

Le tutoriel du menu principal est dans `client/index.html` (bloc `#howto`, une version par langue), à mettre à jour à chaque évolution du jeu. Les chiffres (coûts, durées…) sont lus dans `CONFIG` grâce aux attributs `data-cfg` et restent justes tout seuls. Les illustrations sont dans `client/img/tuto/en/` et `client/img/tuto/fr/` ; `python3 tools/tuto_captures.py` les refait à partir du vrai jeu. Le build les intègre au fichier unique.

## Versions

Le numéro de version vient de `package.json` : le jeu l'affiche en bas de l'accueil et le serveur le donne à chaque connexion. Si le jeu et le serveur n'ont pas la même version, le jeu propose de recharger la page et n'ouvre pas de partie en ligne en attendant. Penser à augmenter la version à chaque mise à jour.

L'offre gratuite de Render met le serveur en veille après 15 minutes sans requête entrante. Pour l'éviter, le serveur s'appelle lui-même par son adresse publique (`RENDER_EXTERNAL_URL`, fournie par Render) toutes les 10 minutes. En continu, cela consomme environ 744 h par mois, sous les 750 h gratuites, à condition que ce soit le seul service gratuit du compte Render. Pour couper ce mécanisme : variable d'environnement `KEEP_AWAKE=off`. Si le serveur s'endort quand même (redémarrage par Render), le premier joueur attend son réveil (environ une minute) ; le jeu l'indique et réessaie tout seul. En secours, un service externe gratuit comme UptimeRobot peut appeler l'adresse du serveur toutes les 5 à 10 minutes.
