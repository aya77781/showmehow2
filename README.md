# ShowMe AI

> **Tape un sujet, reçois une vidéo tutorielle narrée.**
> L'utilisateur écrit "comment créer un repo GitHub" → l'app génère un script étape-par-étape, récupère de vrais screenshots, les annote, les narre, et assemble le tout en une vidéo MP4.

---

## 💡 L'idée

Les tutoriels en ligne sont éparpillés sur YouTube, Medium, WikiHow. Chacun a son style, sa longueur, sa qualité. **ShowMe AI** répond à ce problème en générant **à la demande** des mini-tutoriels vidéo courts (30-60 secondes) pour n'importe quel sujet "how-to".

Le pipeline est 100% automatisé :

```
  Sujet utilisateur
        │
        ▼
 ┌─────────────────┐
 │  LLM (GPT-4o)   │  →  Script structuré (8-12 étapes + intro/outro)
 └────────┬────────┘
          │
          ▼
 ┌─────────────────┐
 │ Serper Images   │  →  Screenshots candidats (Google Images)
 └────────┬────────┘
          │
          ▼
 ┌─────────────────┐
 │ Vision (GPT-4o) │  →  Choisit la meilleure image par étape
 └────────┬────────┘
          │
          ▼
 ┌─────────────────┐
 │ Vision + Sharp  │  →  Annotation : cadre rouge + label sur l'élément
 └────────┬────────┘
          │
          ▼
 ┌─────────────────┐
 │  ElevenLabs TTS │  →  Voix off par étape
 └────────┬────────┘
          │
          ▼
 ┌─────────────────┐
 │     FFmpeg      │  →  Concatène image + audio → clip MP4 final
 └─────────────────┘
```

---

## 🗂️ Architecture du code

```
HackatonApp/
├── api/                  ← Backend Node.js (Express + Socket.IO)
│   ├── index.js          ← Entrypoint, middleware, routes
│   ├── routes/           ← REST endpoints
│   │   ├── auth.js       ← Login / register / Google OAuth
│   │   ├── tutorial.js   ← CRUD projets tutoriels
│   │   ├── explore.js    ← Feed public des tutoriels
│   │   ├── stripe.js     ← Checkout paiement
│   │   └── webhook.js    ← Webhook Stripe (events payment)
│   ├── services/
│   │   ├── tutorial.js   ← ⭐ Le cœur : pipeline complet génération
│   │   └── cache.js      ← Cache MongoDB (scripts, images, TTS, annotations)
│   ├── models/
│   │   ├── User.js       ← Compte utilisateur + plan (free/pro)
│   │   ├── Project.js    ← Un tutoriel généré
│   │   ├── Cache.js      ← TTL cache générique
│   │   └── ImageLibrary.js ← Bibliothèque d'images pré-validées
│   ├── sockets/
│   │   └── tutorial.js   ← Événements temps réel (progression)
│   └── output/sessions/  ← Dossier des fichiers générés (images + vidéos)
│
├── client/               ← Frontend Next.js 16 (App Router + Turbopack)
│   └── src/
│       ├── app/
│       │   ├── page.tsx          ← Home "What do you want to learn?"
│       │   ├── dashboard/        ← Mes tutoriels
│       │   ├── explore/          ← Tutoriels publics
│       │   ├── tutorial/[slug]/  ← Lecteur vidéo
│       │   ├── login/, auth/     ← Authentification
│       │   └── pricing/          ← Plans Stripe
│       └── lib/api.ts            ← Client axios → API
│
└── docs/                 ← Documentation technique interne
    ├── agenticflow.md
    ├── api-reference.md
    ├── bussinesmodel.md
    └── Roadmap.md
```

---

## ⚙️ Stack technique

**Backend**
- **Node.js + Express 5** — serveur HTTP
- **Socket.IO** — streaming des événements du pipeline au frontend
- **MongoDB + Mongoose** — users, projects, cache
- **OpenAI GPT-4o-mini** — génération de script + vision (choix + annotation d'images)
- **Serper API** — recherche Google Images
- **ElevenLabs** — synthèse vocale (TTS) multilingue
- **Sharp** — dessin des annotations (SVG overlay)
- **FFmpeg** — assemblage vidéo final
- **Stripe** — paiements (single / pro)
- **JWT + Google OAuth** — auth

**Frontend**
- **Next.js 16** (App Router, Turbopack) + **React 19**
- **TypeScript**
- **Tailwind CSS**
- Client Socket.IO pour suivre la progression en temps réel

---

## 🚀 Lancement en local

### Prérequis
- Node.js ≥ 20
- MongoDB qui tourne en local sur `localhost:27017`
- FFmpeg installé et accessible dans le `PATH`

### 1. Installation

```bash
cd code/HackatonApp
npm install
npm install --prefix api
npm install --prefix client
```

### 2. Configuration `.env`

Crée [api/.env](api/.env) :

```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/hackatonapp
OPENAI_API_KEY=sk-proj-...
ELEVENLABS_API_KEY=sk_...
SERPER_API_KEY=...
JWT_SECRET=un_secret_long_et_aleatoire
CLIENT_URL=http://localhost:3000

# OAuth Google (facultatif)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Stripe (facultatif)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_SINGLE=price_...
STRIPE_PRICE_PRO=price_...
```

Et [client/.env.local](client/.env.local) :

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 3. Démarrage

```bash
npm run dev
```

Cette commande lance l'API (port 5001) **et** le client (port 3000) en parallèle via `concurrently`.

Ouvre ensuite **http://localhost:3000**.

---

## 🧩 Comment fonctionne le pipeline ?

Tout se passe dans [api/services/tutorial.js](api/services/tutorial.js). Voici les deux phases :

### Phase 1 — Recherche (`runResearch`)

1. **Vérification cache** : si un projet identique existe déjà, on clone ses fichiers. ⚡ Instantané.
2. **`generateScript(topic)`** : GPT-4o-mini génère un JSON avec 8-12 étapes courtes + intro/outro. Chaque étape contient un `imageQuery` ultra-spécifique.
3. **`fetchAllImages`** (parallèle pour toutes les étapes) :
   - **Layer 0** : cherche dans la bibliothèque d'images pré-validées
   - **Layer 1-2** : Serper → télécharge 5 candidats
   - **Layer 3** : GPT-4o Vision choisit la meilleure image ("VALID: 1,3 / BEST: 3")
4. **`annotateScreenshot`** : Vision identifie la zone UI (`BOX: x1%,y1%,x2%,y2%`), Sharp dessine un cadre indigo + label.

### Phase 2 — Génération vidéo (`runVideoGeneration`)

1. **TTS ElevenLabs** : une piste audio par étape (+ intro/outro)
2. **FFmpeg** : pour chaque étape → `image annotée + audio = clip MP4 720p`
3. **Concaténation** : tous les clips → `final-video.mp4`
4. Tout est sauvegardé dans `api/output/sessions/<sessionId>/`

### Streaming temps réel

Chaque étape émet un événement Socket.IO (`research:claude:start`, `screenshot:done`, `tts:done`, `video:clip:done`, etc.) que le frontend affiche en live. Voir [api/sockets/tutorial.js](api/sockets/tutorial.js).

---

## 💾 Stratégie de cache

Pour éviter de re-générer / re-payer pour le même contenu, **tout est caché** dans MongoDB ([api/services/cache.js](api/services/cache.js)) :

| Cache | Clé | TTL |
|---|---|---|
| `script` | topic normalisé | 7j |
| `image_search` | query Serper normalisée | 3j |
| `image_pick` | hash(query + hashes des images) | 7j |
| `annotation` | hash(image + description) | 30j |
| `tts` | hash(texte normalisé) | 30j |

De plus, une **bibliothèque d'images** ([api/models/ImageLibrary.js](api/models/ImageLibrary.js)) stocke les screenshots déjà validés pour les réutiliser entre projets.

---

## 💰 Modèle économique (Stripe)

- **Single** — achat unitaire d'une vidéo
- **Pro** — abonnement mensuel (vidéos illimitées)

Les webhooks Stripe ([api/routes/webhook.js](api/routes/webhook.js)) mettent à jour `user.plan` + `user.videosRemaining` après paiement.

---

## 📡 API principale

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/auth/register` | Créer un compte |
| `POST` | `/api/auth/login` | Login → JWT |
| `GET`  | `/api/auth/google` | OAuth Google |
| `GET`  | `/api/tutorials` | Liste mes projets |
| `POST` | `/api/tutorials` | Créer un projet (topic) |
| `GET`  | `/api/tutorials/:id` | Détail |
| `GET`  | `/api/explore` | Feed public |
| `POST` | `/api/stripe/checkout` | Checkout session |
| `POST` | `/api/webhook` | Webhook Stripe |

Le pipeline de génération est déclenché via **Socket.IO** (`tutorial:research` → le client envoie `{ projectId }` et reçoit les événements en stream).

---

## 🔐 Sécurité — ⚠️ À NOTER

- Les clés API (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, Stripe, etc.) **ne doivent jamais être commitées** ni partagées en clair.
- OpenAI, Anthropic et GitHub scannent les clés exposées publiquement et les **révoquent automatiquement**.
- Vérifie que `.env` est bien dans `.gitignore`.

---

## 📜 Licence

ISC — projet hackathon.
