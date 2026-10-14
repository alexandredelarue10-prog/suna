# Portfolio + admin + police-suna

- **`/`** : page publique avec tes projets (`hub/projets.json`, champ `"public": false` pour en masquer un).
- **`/admin`** : connexion par mot de passe (hash bcrypt dans `server.js`, remplaçable via `HUB_PASSWORD_HASH` sur Render). Permet de : fermer chaque site séparément (police-suna, dojo…) avec un message personnalisé, tu gardes l'accès, afficher un bandeau d'annonce sur tous les sites (script commun `hub/public/assets/annonce.js`), déconnecter tous les utilisateurs, voir les comptes et sessions actives.
- **`/dojo-fuinjutsu/`** : site RP du dojo de fuinjutsu (`apps/dojo-fuinjutsu/`) : grades Maître / Co-Maître / Professeur / Adepte, quatre Barrières, grimoire, examens, séances (récurrentes) avec appel, annonces, carnet, notifications, profils avec distinctions et retours des professeurs, recherche, suspension de comptes, export CSV, stats. Le compte admin du hub y agit comme Maître (il valide les premiers comptes).
- **`/dojo-sensoriel/`** : site RP du dojo des ninja sensoriels (`apps/dojo-sensoriel/`), mêmes grades et mêmes fonctions que le dojo de fuinjutsu, avec quatre « sphères » de détection de chakra et une salle d'entraînement (exercice de détection + classement). Comptes séparés ; le compte admin du hub y agit aussi comme Maître.
- **`/police-suna/`** : le site complet (`apps/police-suna/`), avec ses propres comptes.

Réglages admin stockés dans la table `hub_settings`. `HUB_SESSION_SECRET` : chaîne aléatoire ; la changer déconnecte l'admin partout.

Ajouter un projet : une entrée dans `hub/projets.json` (`id`, `nom`, `description`, `tags`, `statut`, `url`, `public`).

---

# Police de Sunagakure — Site officiel

Site de gestion pour la police de Suna (RP Naruto) : vitrine publique, organigramme, code pénal
complet, casiers judiciaires, et système de comptes avec validation par les hauts gradés.

Construit en **Node.js + Express + PostgreSQL**, front-end en HTML/CSS/JS pur (aucun framework
lourd) pour rester très léger en consommation de données et en ressources serveur.

## Fonctionnalités

- **Comptes & grades** : inscription publique → statut "en attente" → validation par un haut
  gradé qui choisit le grade (poste) et le rang ninja. Grades entièrement modifiables (nom,
  niveau hiérarchique, couleur, permissions) depuis l'interface, sans toucher au code.
- **Code pénal modulable** : tous les articles (village + Pays du Vent), le système de blâmes et
  le système de récidive sont éditables depuis le site par les gradés habilités.
- **Codes d'alerte / protocoles** : les 5 niveaux (Bleu à Noir) avec déclenchement, mobilisation
  et actions, éditables.
- **Casiers judiciaires** : fiche par individu, historique d'infractions rattachées au code
  pénal (amende, cellule/T.I.G, récidive).
- **Organigramme public** et **communiqués officiels** sur la page d'accueil.
- **Compte principal protégé** créé automatiquement au premier démarrage :
  - Identifiant : `DEV`
  - Mot de passe : `roidudev`
  - Grade : **Fondateur** — un grade réservé, créé exprès pour lui et qu'aucun autre compte ne
    peut jamais recevoir (verrouillé même contre modification/suppression par l'interface).
  - **Change ce mot de passe dès le premier déploiement** (page "Mon profil" une fois connecté —
    c'est la seule chose que ce compte peut modifier sur lui-même).
  - Ce compte est **protégé** : personne (pas même lui-même) ne peut changer son grade, son rang,
    ou le supprimer depuis l'interface.
- **Anti auto-promotion** : aucun utilisateur, quel que soit son grade, ne peut modifier son
  propre grade ou son propre rang ninja depuis l'interface. Seul un autre haut gradé habilité
  peut le faire.
- **Rangs ninja modulables** : comme les grades, les rangs (Genin, Chûnin, Kakunin, TKJ, Jônin…)
  sont gérables depuis `/admin-rangs.html` — création, modification, suppression, sans toucher
  au code.
- **Dépôts de plainte** (`/plaintes.html`) : ouvert à tout membre approuvé (pas besoin de
  permission spéciale). Fiche détaillée (plaignant, mis en cause, faits, statut), témoignages
  multiples éditables à tout moment, infractions liées au code pénal. Une plainte peut être
  marquée **privée** : elle reste alors invisible aux autres membres, mais toujours consultable
  par son créateur et par les Gérant et plus (`peut_valider_comptes`).
- **Pôles** : spécialisations transversales, indépendantes du grade — un compte peut appartenir
  à plusieurs pôles à la fois, assignables depuis `/admin-comptes.html`. **DEV appartient
  automatiquement aux trois**, resynchronisé à chaque démarrage.
  - **Administratif** (`/administratif.html`) : rapport des amendes perçues par agent sur une
    période donnée, gestion des formations (avec formateur et participants), demandes de congé
    (tout membre peut en faire une, le pôle les traite), évaluations périodiques par agent, et
    statistiques des comptes en lecture seule (totaux, répartition par grade/pôle, dernière
    connexion).
  - **Enquête** (`/enquetes.html`) : dossiers d'enquête reliant plusieurs casiers et plaintes
    entre eux, avec suivi de statut (ouverte / en cours / clôturée), chronologie d'événements
    horodatés, et pièces à conviction (nom, description, localisation).
  - **Sécurité** (`/securite.html`) : journal des incidents de sécurité, registre des entrées et
    sorties du village, suivi des escortes diplomatiques (destination, personnalité, agents
    assignés), et niveaux de sécurité par zone — en complément du planning des patrouilles.
- **Casiers enrichis** : mandats d'arrêt formels (arrestation/perquisition/comparution, actif ou
  levé), galerie de photos, export CSV de l'ensemble des casiers.
- **Annuaire des habitants** (`/habitants.html`) : contexte RP pour les personnes non fichées
  judiciairement.
- **Annonces internes** : fil réservé aux membres connectés sur le tableau de bord, distinct des
  communiqués publics de l'accueil.
- **Historique de connexion** : date de dernière connexion visible sur chaque compte dans
  `/admin-comptes.html`.
- **Journal d'activité** : historique des actions administratives (validations de compte,
  changements de grade/rang, modifications du code pénal, casiers créés/supprimés, blâmes
  appliqués, activation d'un code d'alerte…), consultable sur `/journal.html`.
- **Bandeau d'alerte actif** : un haut gradé habilité peut activer un code d'alerte (Bleu à Noir)
  en un clic depuis `/protocoles.html` ; il s'affiche alors en bandeau sur la page d'accueil.
  Un seul code est actif à la fois.
- **Avis de recherche public** : les casiers au statut "recherché" apparaissent automatiquement
  sur la page d'accueil, sans qu'il soit nécessaire d'être connecté.
- **Export PDF d'un casier** : bouton "Télécharger (PDF)" sur la fiche d'un casier, génère un
  document officiel avec les infractions.
- **Filtres avancés sur les casiers** : recherche par nom, statut, niveau de danger minimum et
  village.
- **Dossier disciplinaire par agent** : un haut gradé peut appliquer un blâme (du barème existant)
  directement au profil d'un membre depuis `/admin-comptes.html` (bouton "Dossier"). Impossible
  de se l'appliquer à soi-même ou à un compte protégé.
- **Planning de service** (`/planning.html`) : organiser des patrouilles par date, avec agent
  assigné, horaires et notes.
- **Statistiques** (`/statistiques.html`) : infractions par catégorie et par mois, effectifs et
  casiers ouverts — sans librairie de graphique externe (barres en CSS pur).
- **Recherche globale** : barre de recherche dans la navigation, cherchant simultanément dans
  les casiers, le code pénal et les membres.
- **Notifications** : pastille indiquant le nombre de demandes de compte en attente, visible
  directement dans le menu "Comptes".

## Structure du projet

```
suna-police/
├── server.js                 # point d'entrée
├── src/
│   ├── config/db.js          # connexion PostgreSQL
│   ├── db/schema.sql         # schéma complet
│   ├── db/seed.js            # données de départ (idempotent, sans danger à relancer)
│   ├── middleware/auth.js    # auth + permissions
│   └── routes/               # API (auth, users, grades, sanctions, blames, recidives, alertes, casiers, actus)
└── public/                   # front-end statique (HTML/CSS/JS, aucun build nécessaire)
```

---

## 1. Déploiement sur GitHub

```bash
cd suna-police
git init
git add .
git commit -m "Site police de Sunagakure"
git branch -M main
git remote add origin https://github.com/<ton-compte>/<ton-repo>.git
git push -u origin main
```

Le fichier `.gitignore` exclut déjà `node_modules/` et `.env` — ne les commite jamais
(le `.env` contient des secrets une fois rempli).

## 2. Créer la base de données sur Neon

1. Va sur [neon.tech](https://neon.tech), crée un compte (gratuit, sans carte bancaire) et un
   nouveau projet.
2. Neon te donne directement une **chaîne de connexion** (bouton *Connect* sur le tableau de
   bord du projet), du type :
   `postgresql://user:password@ep-xxxx.aws.neon.tech/neondb?sslmode=require`
3. Garde cette chaîne de côté, c'est ta variable `DATABASE_URL`.

Le plan gratuit de Neon est permanent (pas un essai) : jusqu'à 100 projets, 0,5 Go de stockage
et 100 heures de calcul par mois, sans carte bancaire. Le calcul se met en pause après 5 minutes
d'inactivité (données conservées), avec une reprise quasi instantanée à la requête suivante —
sans commune mesure avec la mise en veille du service web décrite plus bas.

## 3. Déploiement sur Render

1. Va sur [render.com](https://render.com) → **New** → **Web Service** → connecte ton dépôt
   GitHub et sélectionne `police-suna`.
2. Configuration du service :
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
3. **Variables d'environnement** (onglet *Environment*) :
   - `DATABASE_URL` → la chaîne de connexion Neon récupérée à l'étape précédente.
   - `SESSION_SECRET` → génère une chaîne aléatoire longue (ex : `openssl rand -hex 32`).
   - `NODE_ENV` → `production`.
   - `PORT` → laissé vide, Render le fournit automatiquement.
   - `DISCORD_BOT_TOKEN` → optionnel, voir plus bas pour les notifications Discord.
4. Render détecte `package.json`, lance `npm install` puis `npm start`, et redéploie
   automatiquement à chaque `git push` sur `main`.
5. Au premier démarrage, le serveur crée les tables et les données de départ tout seul
   (`src/db/seed.js` est appelé automatiquement par `server.js`, et il est **idempotent** : le
   relancer à chaque redéploiement ne duplique rien et ne casse rien).
6. Une fois déployé, Render te donne une URL publique (`*.onrender.com`). Tu peux ensuite
   brancher un nom de domaine personnalisé dans l'onglet *Settings → Custom Domains*.

### Empêcher le service gratuit de s'endormir

Le plan gratuit de Render met le service en veille après 15 minutes sans requête entrante — ce
qui couperait le bot Discord et la synchronisation en direct entre utilisateurs à chaque fois.
Le dépôt inclut un contournement gratuit : `.github/workflows/keep-alive.yml`, une GitHub Action
qui ping `/api/health` toutes les 14 minutes.

Pour l'activer :
1. Sur GitHub, va dans **Settings → Secrets and variables → Actions → Variables**.
2. Crée une variable de dépôt `RENDER_URL` avec l'URL de ton service (ex :
   `https://police-suna.onrender.com`, sans `/` final).
3. Le workflow se lance automatiquement au push suivant. Tu peux aussi le déclencher
   manuellement depuis l'onglet **Actions** pour vérifier qu'il fonctionne.

⚠️ Ce contournement est toléré mais **non garanti** par Render (ce n'est pas une fonctionnalité
officiellement supportée) — largement suffisant pour une communauté RP, mais à garder en tête.
GitHub désactive aussi automatiquement les workflows programmés après 60 jours sans aucune
activité sur le dépôt ; un simple commit ou un déclenchement manuel suffit à le relancer.

### Vérifier que tout s'est bien passé

- `https://ton-site.onrender.com/api/health` doit renvoyer `{"status":"ok"}`.
- Connecte-toi avec `lexioui` / `roidudev`, va sur **Mon profil** et change le mot de passe
  immédiatement.

---

## 3. Reconstituer l'effectif actuel

Le site part avec une base vide (à part le compte `lexioui`). Pour retrouver l'organigramme
réel (Ryu, Kentaro Ayatsuri, etc.) :

1. Chaque membre va sur **Demander un accès** et crée son propre compte.
2. Un haut gradé (Dirigeant ou Gérant) va sur **Gestion des comptes**, valide chaque demande,
   choisit le **grade (poste)** correspondant (Dirigeant / Gérant / Inspecteur confirmé /
   Inspecteur en test) et le **rang ninja** (Genin, Chûnin, Kakunin, TKJ, Jônin).
3. Le champ "brigade" (ex : *Brigade de déminage*) peut être ajouté/modifié directement en base
   ou via une prochaine évolution de l'interface si besoin.

## 4. Modifier le code pénal, les grades, les protocoles

Tout est pensé pour ne jamais toucher au code :

- **Grades** (`/admin-grades.html`) : créer/modifier/supprimer un grade, définir son niveau
  hiérarchique, sa couleur, et cocher les permissions qu'il donne (valider les comptes, gérer
  les grades, gérer le code pénal, gérer les casiers, publier des communiqués, gérer les
  protocoles). Un grade peut être marqué "réservé" : il devient alors impossible à attribuer,
  modifier ou supprimer depuis l'interface (utilisé pour le compte `DEV`).
- **Rangs ninja** (`/admin-rangs.html`) : créer/modifier/supprimer les rangs (Genin, Chûnin,
  Kakunin, TKJ, Jônin…), totalement indépendants des grades/postes de police.
- **Code pénal** (`/code-penal.html`) : ajouter/modifier/supprimer un article (numéro, catégorie,
  amende en ryō, cellule/T.I.G), le système de blâmes et les paliers de récidive.
- **Protocoles** (`/protocoles.html`) : éditer chaque code d'alerte (Bleu à Noir) — situation de
  déclenchement, mobilisation, actions à mener. Seul "Bleu" est pré-rempli avec le contenu
  fourni ; les 4 autres sont à compléter via l'interface.
- **Casiers** (`/casiers.html`) : gestion complète des dossiers et de leurs infractions.
- **Communiqués** (`/admin-actus.html`) : publications visibles sur la page d'accueil.

## 5. Développement local

```bash
npm install
cp .env.example .env   # puis renseigne DATABASE_URL vers une base PostgreSQL locale ou distante
npm start
```

Le serveur tourne par défaut sur `http://localhost:3000`.

## 6. Notes sur la faible consommation

- Aucun framework front-end (pas de React/Vue/bundler) : pages HTML statiques + JS vanilla.
- Aucune image raster : le sceau du village et tous les visuels sont en CSS pur.
- Deux familles de police seulement, chargées une fois et mises en cache par le navigateur.
- Sessions stockées en base (pas de dépendance à un service externe type Redis).
- Pool de connexions PostgreSQL limité à 5 connexions simultanées.
- Fichiers statiques servis avec cache navigateur (1h).
