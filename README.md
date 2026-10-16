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
2. **Jeu (Netlify)** : `npm run build`, puis glisser le dossier `dist` dans l'onglet *Deploys* du site Netlify.

L'offre gratuite de Render met le serveur en veille après 15 minutes sans joueur : le premier joueur suivant attend son réveil (environ une minute). Le jeu l'indique et réessaie tout seul.
