# ShowMe AI — API Reference

## Architecture

```
Client (React)
  │
  ├── REST API (Express)     → CRUD projects
  │     POST /api/tutorials
  │     GET  /api/tutorials
  │     GET  /api/tutorials/:id
  │     PUT  /api/tutorials/:id/steps
  │     DELETE /api/tutorials/:id
  │
  └── Socket.IO              → Real-time pipeline
        emit  tutorial:research         → Phase 1
        emit  tutorial:generate-videos  → Phase 2
        on    research:*                ← Progress events
        on    video:*                   ← Video events
        on    tutorial:ready            ← Draft ready
        on    tutorial:complete         ← All done
```

## Project Structure

```
api/
├── index.js                    Express + Socket.IO server
├── .env                        Environment variables
├── models/
│   ├── User.js                 User schema (auth)
│   └── Project.js              Tutorial project schema
├── routes/
│   ├── auth.js                 Auth endpoints
│   └── tutorial.js             CRUD endpoints for projects
├── services/
│   └── tutorial.js             Pipeline logic (WikiHow + Claude + VEED)
├── sockets/
│   └── tutorial.js             Socket.IO event handlers
├── middleware/
│   └── auth.js                 JWT auth middleware
└── output/
    └── sessions/{sessionId}/
        ├── images/             WikiHow step images
        ├── videos/             VEED generated videos
        └── tutorial.json       Tutorial data
```

---

## Environment Variables

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/hackatonapp
ANTHROPIC_API_KEY=sk-ant-...
FAL_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:xxxxxxxxxxxxxxxx
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
```

---

## REST API

All tutorial endpoints require `Authorization: Bearer <jwt_token>`.

### Auth

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/auth/register` | `{ name, email, password }` | `{ token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | `{ token, user }` |
| POST | `/api/auth/google` | `{ credential }` | `{ token, user }` |
| GET | `/api/auth/me` | — | `{ _id, name, email }` |

### Tutorials (Projects)

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/tutorials` | `{ topic }` | Created project |
| GET | `/api/tutorials` | — | Array of projects |
| GET | `/api/tutorials/:id` | — | Single project |
| PUT | `/api/tutorials/:id/steps` | `{ steps }` | Updated project |
| DELETE | `/api/tutorials/:id` | — | `{ message }` |

#### POST /api/tutorials

```json
// Request
{ "topic": "How to create a GitHub repository" }

// Response 201
{
  "_id": "6834...",
  "user": "user_id",
  "topic": "How to create a GitHub repository",
  "status": "draft",
  "createdAt": "2026-03-21T..."
}
```

#### PUT /api/tutorials/:id/steps

```json
// Request
{
  "steps": [
    { "step": 1, "title": "Open App Store", "description": "First, open the App Store on your Mac." },
    { "step": 2, "title": "Search Xcode", "description": "Type Xcode in the search bar." }
  ]
}

// Response 200 — updated project
```

---

## Socket.IO

### Connection

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: { token: "jwt_token_here" }
});
```

---

### Phase 1: Research

Scrapes WikiHow for images + calls Claude API for narration.

**Emit:**
```javascript
socket.emit("tutorial:research", { projectId: "6834..." });
```

**Events received in order:**

| Event | Payload |
|-------|---------|
| `research:start` | `{ sessionId, topic }` |
| `research:wikihow:start` | `{}` |
| `research:wikihow:done` | `{ found, title, stepsCount, time }` |
| `research:claude:start` | `{}` |
| `research:claude:done` | `{ steps: [...], time }` |
| `research:images:done` | `{ count, time }` |
| `research:done` | `{ sessionId, tutorial, stats }` |
| `tutorial:ready` | `{ projectId, tutorial, stats }` |

#### `research:claude:done` — step data

```json
{
  "steps": [
    {
      "step": 1,
      "title": "Sign in to GitHub",
      "description": "Navigate to github.com and sign in with your credentials."
    }
  ],
  "time": 10800
}
```

#### `tutorial:ready` — full tutorial

```json
{
  "projectId": "6834...",
  "tutorial": {
    "title": "How to Create a GitHub Repository",
    "url": "https://github.com",
    "source": "WikiHow — Create a Repository on GitHub",
    "steps": [
      {
        "step": 1,
        "title": "Sign in to GitHub",
        "description": "Navigate to github.com...",
        "screenshot": "step-01.jpg",
        "imageUrl": "https://www.wikihow.com/images/..."
      }
    ]
  },
  "stats": { "phase1Time": 19700 }
}
```

---

### Phase 2: Video Generation

**Emit:**
```javascript
// With edited steps (optional)
socket.emit("tutorial:generate-videos", {
  projectId: "6834...",
  steps: [/* edited steps */]
});

// Without edits (uses existing steps)
socket.emit("tutorial:generate-videos", { projectId: "6834..." });
```

**Events received in order:**

| Event | Payload |
|-------|---------|
| `video:start` | `{ total }` |
| `video:step:start` | `{ step, title }` |
| `video:step:progress` | `{ step, status, position }` |
| `video:step:done` | `{ step, file, size }` |
| `video:step:error` | `{ step, error }` |
| `video:done` | `{ videos, total, time }` |
| `tutorial:complete` | `{ projectId, tutorial, stats }` |

#### `video:step:done`
```json
{ "step": 1, "file": "step-01.mp4", "size": 2456789 }
```

#### `tutorial:complete`
```json
{
  "projectId": "6834...",
  "tutorial": {
    "title": "How to Create a GitHub Repository",
    "steps": [
      {
        "step": 1,
        "title": "Sign in to GitHub",
        "description": "Navigate to github.com...",
        "screenshot": "step-01.jpg",
        "video": "step-01.mp4",
        "videoSize": 2456789
      }
    ]
  },
  "stats": { "phase1Time": 19700, "phase2Time": 45000, "totalTime": 64700 }
}
```

---

## Static Files

```
GET /output/sessions/{sessionId}/images/step-01.jpg
GET /output/sessions/{sessionId}/videos/step-01.mp4
```

---

## Project Status Flow

```
draft → generating → ready → video_generating → complete
                       │
                       └──── error
```

| Status | Description |
|--------|-------------|
| `draft` | Created, no research yet |
| `generating` | Phase 1 running (WikiHow + Claude) |
| `ready` | Steps available, user can edit |
| `video_generating` | Phase 2 running (VEED) |
| `complete` | All videos generated |
| `error` | Pipeline failed |

---

## Pipeline

### Phase 1: Research (~15-20s)

```
Topic
  ├── WikiHow HTML scrape (cheerio) → images
  └── Parallel:
        ├── Claude API + web_search → narration
        └── Download images → sessions/{id}/images/
```

### Phase 2: Video Generation (VEED Fabric 1.0)

```
Per step:
  ├── Upload image → fal.ai storage
  ├── veed/fabric-1.0/text (image + narration) → MP4
  └── Download → sessions/{id}/videos/step-XX.mp4

Concurrency: 2 | Resolution: 480p ($0.08/sec)
```

---

## Frontend Example

```javascript
const API = "http://localhost:5000";
const token = localStorage.getItem("token");

// 1. Create project
const res = await fetch(`${API}/api/tutorials`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
  body: JSON.stringify({ topic: "How to deploy on Vercel" })
});
const project = await res.json();

// 2. Connect socket
const socket = io(API, { auth: { token } });

// 3. Listen
socket.on("research:claude:done", (data) => setSteps(data.steps));
socket.on("tutorial:ready", (data) => { setTutorial(data.tutorial); setEditing(true); });
socket.on("video:step:done", (data) => {
  const url = `${API}/output/sessions/${sessionId}/videos/${data.file}`;
  addVideoToStep(data.step, url);
});
socket.on("tutorial:complete", (data) => setDone(true));

// 4. Start
socket.emit("tutorial:research", { projectId: project._id });

// 5. After edits → generate videos
socket.emit("tutorial:generate-videos", { projectId: project._id, steps: editedSteps });
```

---

## Pricing

| Component | Cost |
|-----------|------|
| WikiHow | Free |
| Claude API | ~$0.02-0.05/tutorial |
| VEED 480p | $0.08/sec (~$0.40-0.80/step) |
| VEED 720p | $0.15/sec (~$0.75-1.50/step) |
| **8 steps 480p** | **~$3-6** |
| **8 steps 720p** | **~$6-12** |
