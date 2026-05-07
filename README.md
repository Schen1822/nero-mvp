# Nero Party

A dark rave-aesthetic listening party — create a room, add songs from Deezer, vote 🔥 or 💀, and crown a winner.

**No API keys required.** Song search and 30-second previews come from Deezer's free public API.

## Setup

### Prerequisites

- Node.js 18+
- npm

### Quick start

```bash
# 1. Install all dependencies (root + both workspaces)
npm install

# 2. Copy env file
cp .env.example .env

# 3. Set up the database (run from backend/ directory)
cd backend && npx prisma migrate dev --name init && cd ..

# 4. Start both servers
npm run dev
```

Open **http://localhost:5173** in your browser.

> The backend runs on `http://localhost:3000` and the frontend on `http://localhost:5173`.
> Both start automatically with `npm run dev` from the root.

### Running servers individually

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

## How it works

1. **Host** creates a party (optional: set max songs or time limit) and shares the 6-character code
2. **Guests** join by entering the code and picking a name + emoji avatar
3. Anyone can **search for songs** (powered by Deezer) and add them to the queue
4. **Host starts the party** — 30-second Deezer previews play in sync for all participants
5. During each song, everyone votes **🔥 Fire** or **💀 Skip**
6. Songs auto-advance when the preview ends; host can also skip manually
7. When the queue is empty (or host ends early), the **winner is revealed** with a full ranked leaderboard

**Scoring:** fire votes = +1, skull votes = −1. Ties broken by raw fire count.

## Project Structure

```
nero-party/
├── backend/
│   ├── prisma/         # SQLite schema & migrations
│   └── src/
│       ├── index.ts    # Express routes + Socket.IO handlers
│       └── env.ts      # Environment config
└── frontend/
    └── src/
        ├── pages/
        │   ├── Landing.tsx    # Create / join flows
        │   └── PartyRoom.tsx  # Lobby → playing → results
        ├── lib/
        │   ├── api.ts         # REST client
        │   └── socket.ts      # Socket.IO client
        ├── types/index.ts
        └── index.css          # All styles (dark neon theme)
```

## Tech Stack

- **Backend:** Express.js, Prisma ORM, Socket.IO, SQLite
- **Frontend:** React 18, Vite, TailwindCSS
- **Music:** Deezer public API (no key needed) — search + 30s previews
