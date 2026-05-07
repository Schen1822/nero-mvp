import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "./env.js";

const app = express();
const server = createServer(app);
const prisma = new PrismaClient();

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.use(cors({ origin: /^http:\/\/localhost:\d+$/ }));
app.use(express.json());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

async function getPartyWithData(code: string) {
  return prisma.party.findUnique({
    where: { code },
    include: {
      participants: { orderBy: { joinedAt: "asc" } },
      songs: {
        include: { votes: true },
        orderBy: { position: "asc" },
      },
    },
  });
}

function sanitizeParty(party: Awaited<ReturnType<typeof getPartyWithData>>) {
  if (!party) return party;
  const { passwordHash, ...rest } = party;
  return { ...rest, hasPassword: passwordHash !== null };
}

type PartyWithData = NonNullable<Awaited<ReturnType<typeof getPartyWithData>>>;

// Emit directly to every connected participant's socket ID — bypasses room membership.
function emitToParty(party: PartyWithData, event: string, data: unknown) {
  party.participants
    .filter((p) => p.socketId)
    .forEach((p) => io.to(p.socketId!).emit(event, data));
}

async function emitPartySync(partyCode: string) {
  const party = await getPartyWithData(partyCode);
  if (!party) return null;
  const sanitized = sanitizeParty(party);
  emitToParty(party, "party:sync", { party: sanitized });
  return { party, sanitized };
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  userId?: string;
  username?: string;
  params: Record<string, string>;
}

async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as {
      userId: string;
      username: string;
    };
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      res.status(401).json({ error: "Session expired, please log in again" });
      return;
    }
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function signToken(userId: string, username: string) {
  return jwt.sign({ userId, username }, env.JWT_SECRET, { expiresIn: "30d" });
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post("/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: "All fields required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] },
    });
    if (existing)
      return res.status(409).json({ error: "Username or email already taken" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username: username.trim(), email: email.toLowerCase().trim(), passwordHash },
    });

    const token = signToken(user.id, user.username);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken(user.id, user.username);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/auth/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ userId: req.userId, username: req.username });
});

// ─── REST Routes ──────────────────────────────────────────────────────────────

// Create party
app.post("/parties", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, hostName, hostEmoji, maxSongs, maxMinutes, password } = req.body;

    let code = generateCode();
    while (await prisma.party.findUnique({ where: { code } })) {
      code = generateCode();
    }

    const passwordHash = password ? await bcrypt.hash(password, 10) : null;

    const party = await prisma.party.create({
      data: {
        code,
        name,
        passwordHash,
        maxSongs: maxSongs || null,
        maxMinutes: maxMinutes || null,
        participants: {
          create: {
            name: hostName,
            emoji: hostEmoji,
            isHost: true,
            userId: req.userId,
          },
        },
      },
      include: {
        participants: true,
        songs: true,
      },
    });

    res.json({ party: sanitizeParty(party as Awaited<ReturnType<typeof getPartyWithData>>), participantId: party.participants[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create party" });
  }
});

// Get party
app.get("/parties/:code", async (req, res) => {
  try {
    const party = await getPartyWithData(req.params.code);
    if (!party) return res.status(404).json({ error: "Party not found" });
    res.json({ party: sanitizeParty(party) });
  } catch {
    res.status(500).json({ error: "Failed to get party" });
  }
});

// Join party
app.post("/parties/:code/join", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, emoji, password } = req.body;
    const party = await prisma.party.findUnique({
      where: { code: req.params.code },
    });

    if (!party) return res.status(404).json({ error: "Party not found" });
    if (party.status === "ended")
      return res.status(400).json({ error: "Party has ended" });

    if (party.passwordHash) {
      if (!password) return res.status(401).json({ error: "Password required" });
      const valid = await bcrypt.compare(password, party.passwordHash);
      if (!valid) return res.status(401).json({ error: "Wrong password" });
    }

    const participant = await prisma.participant.create({
      data: { partyId: party.id, name, emoji, isHost: false, userId: req.userId },
    });

    // Notify everyone already in the room that a new participant joined
    await emitPartySync(req.params.code);

    res.json({ participant });
  } catch {
    res.status(500).json({ error: "Failed to join party" });
  }
});

// Start party
app.post("/parties/:code/start", async (req, res) => {
  try {
    const { participantId } = req.body;
    const party = await getPartyWithData(req.params.code);

    if (!party) return res.status(404).json({ error: "Party not found" });

    const me = party.participants.find((p) => p.id === participantId);
    if (!me?.isHost)
      return res.status(403).json({ error: "Only host can start" });
    const firstSong = party.songs.find((s) => s.status === "queued");
    if (!firstSong)
      return res.status(400).json({ error: "Add songs first" });
    const now = new Date();

    await prisma.$transaction([
      prisma.party.update({
        where: { id: party.id },
        data: { status: "playing", currentSongIndex: 0 },
      }),
      prisma.song.update({
        where: { id: firstSong.id },
        data: { status: "playing", playedAt: now, startedAt: now },
      }),
    ]);

    const fullParty = await getPartyWithData(req.params.code);
    if (fullParty) {
      emitToParty(fullParty, "party:started", {
        party: sanitizeParty(fullParty),
        startedAt: now.getTime(),
      });
    }
    res.json({ party: sanitizeParty(fullParty), startedAt: now.getTime() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start party" });
  }
});

// Add song
app.post("/parties/:code/songs", async (req, res) => {
  try {
    const {
      participantId,
      deezerId,
      title,
      artist,
      album,
      coverUrl,
      previewUrl,
    } = req.body;
    const party = await getPartyWithData(req.params.code);

    if (!party) return res.status(404).json({ error: "Party not found" });
    if (party.status === "ended")
      return res.status(400).json({ error: "Party has ended" });
    if (party.maxSongs && party.songs.length >= party.maxSongs)
      return res.status(400).json({ error: "Song limit reached" });
    if (party.songs.find((s) => s.deezerId === String(deezerId)))
      return res.status(400).json({ error: "Song already in queue" });

    const song = await prisma.song.create({
      data: {
        partyId: party.id,
        deezerId: String(deezerId),
        title,
        artist,
        album: album || null,
        coverUrl: coverUrl || null,
        previewUrl: previewUrl || null,
        addedById: participantId,
        position: party.songs.length,
        status: "queued",
      },
      include: { votes: true },
    });

    await emitPartySync(req.params.code);
    res.json({ song });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add song" });
  }
});

// Vote on song
app.post("/parties/:code/songs/:songId/vote", async (req, res) => {
  try {
    const { participantId, value } = req.body;

    if (!Number.isInteger(value) || value < 1 || value > 5)
      return res.status(400).json({ error: "Rating must be 1–5" });

    const party = await prisma.party.findUnique({
      where: { code: req.params.code },
    });
    if (!party) return res.status(404).json({ error: "Party not found" });

    await prisma.vote.upsert({
      where: {
        songId_participantId: {
          songId: req.params.songId,
          participantId,
        },
      },
      update: { value },
      create: { songId: req.params.songId, participantId, value },
    });

    const song = await prisma.song.findUnique({
      where: { id: req.params.songId },
      include: { votes: true },
    });

    await emitPartySync(req.params.code);
    res.json({ song });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to vote" });
  }
});

// Advance to next song
app.post("/parties/:code/next", async (req, res) => {
  try {
    const { participantId } = req.body;
    const party = await getPartyWithData(req.params.code);

    if (!party) return res.status(404).json({ error: "Party not found" });

    const me = party.participants.find((p) => p.id === participantId);
    if (!me?.isHost)
      return res.status(403).json({ error: "Only host can advance" });

    const currentSong = party.songs.find((s) => s.status === "playing");
    if (currentSong) {
      await prisma.song.update({
        where: { id: currentSong.id },
        data: { status: "played" },
      });
    }

    const nextSong = party.songs
      .filter((s) => s.status === "queued")
      .sort((a, b) => a.position - b.position)[0];

    if (!nextSong) {
      const idleParty = await getPartyWithData(req.params.code);
      if (idleParty) emitToParty(idleParty, "queue:empty", { party: sanitizeParty(idleParty) });
      return res.json({ empty: true, party: sanitizeParty(idleParty) });
    }

    const now = new Date();
    await prisma.song.update({
      where: { id: nextSong.id },
      data: { status: "playing", playedAt: now, startedAt: now },
    });
    await prisma.party.update({
      where: { id: party.id },
      data: { currentSongIndex: { increment: 1 } },
    });

    const fullParty = await getPartyWithData(req.params.code);
    if (fullParty) {
      emitToParty(fullParty, "song:changed", {
        song: { ...nextSong, status: "playing" },
        party: sanitizeParty(fullParty),
        startedAt: now.getTime(),
      });
    }

    res.json({ song: nextSong, startedAt: now.getTime() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to advance" });
  }
});

// End party early
app.post("/parties/:code/end", async (req, res) => {
  try {
    const { participantId } = req.body;
    const party = await getPartyWithData(req.params.code);

    if (!party) return res.status(404).json({ error: "Party not found" });

    const me = party.participants.find((p) => p.id === participantId);
    if (!me?.isHost)
      return res.status(403).json({ error: "Only host can end" });

    await prisma.song.updateMany({
      where: { partyId: party.id, status: { in: ["playing", "queued"] } },
      data: { status: "played" },
    });
    await prisma.party.update({
      where: { id: party.id },
      data: { status: "ended" },
    });

    const finalParty = await getPartyWithData(req.params.code);
    if (finalParty) emitToParty(finalParty, "party:ended", { party: sanitizeParty(finalParty) });
    res.json({ party: sanitizeParty(finalParty) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to end party" });
  }
});

// Reorder queued songs (host only)
app.put("/parties/:code/songs/:songId/position", async (req, res) => {
  try {
    const { participantId, direction } = req.body as {
      participantId: string;
      direction: "up" | "down";
    };
    const party = await getPartyWithData(req.params.code);
    if (!party) return res.status(404).json({ error: "Party not found" });

    const me = party.participants.find((p) => p.id === participantId);
    if (!me?.isHost) return res.status(403).json({ error: "Only host can reorder" });

    const queued = party.songs
      .filter((s) => s.status === "queued")
      .sort((a, b) => a.position - b.position);

    const idx = queued.findIndex((s) => s.id === req.params.songId);
    if (idx === -1) return res.status(400).json({ error: "Song not in queue" });

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= queued.length)
      return res.status(400).json({ error: "Cannot move further" });

    const songA = queued[idx];
    const songB = queued[swapIdx];

    await prisma.$transaction([
      prisma.song.update({ where: { id: songA.id }, data: { position: songB.position } }),
      prisma.song.update({ where: { id: songB.id }, data: { position: songA.position } }),
    ]);

    const updated = await getPartyWithData(req.params.code);
    if (updated) emitToParty(updated, "party:sync", { party: sanitizeParty(updated) });
    res.json({ party: sanitizeParty(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reorder" });
  }
});

// Deezer search proxy (avoids CORS from browser)
app.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Query required" });

    const response = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(q as string)}&limit=12`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

// Image proxy (for html2canvas CORS workaround)
app.get("/proxy-image", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== "string") return res.status(400).send("url required");
    const response = await fetch(url);
    if (!response.ok) return res.status(502).send("upstream error");
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(buffer));
  } catch {
    res.status(500).send("Failed to proxy image");
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Socket.IO ────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("party:join", async ({ partyCode, participantId }) => {
    socket.join(partyCode);

    await prisma.participant
      .update({ where: { id: participantId }, data: { socketId: socket.id } })
      .catch(() => {});

    await emitPartySync(partyCode);
  });

  socket.on("reaction", async ({ partyCode, emoji }) => {
    const party = await getPartyWithData(partyCode);
    if (party) emitToParty(party, "reaction:float", { emoji, id: socket.id });
  });

  socket.on("song:reveal-request", async ({ partyCode }: { partyCode: string }) => {
    const party = await getPartyWithData(partyCode);
    if (!party) return;
    const current = party.songs.find((s) => s.status === "playing");
    if (!current) return;
    emitToParty(party, "song:reveal", {
      song: current,
      participants: party.participants,
    });
  });

  socket.on("chat:send", async ({ partyCode, participantId, text }: { partyCode: string; participantId: string; text: string }) => {
    if (!text?.trim()) return;
    const participant = await prisma.participant.findUnique({ where: { id: participantId } }).catch(() => null);
    if (!participant) return;
    const party = await getPartyWithData(partyCode);
    if (!party) return;
    emitToParty(party, "chat:message", {
      id: `${socket.id}-${Date.now()}`,
      participantId,
      name: participant.name,
      emoji: participant.emoji,
      text: text.trim().slice(0, 300),
      sentAt: Date.now(),
    });
  });

  socket.on("disconnect", async () => {
    console.log("Client disconnected:", socket.id);

    const participant = await prisma.participant
      .findFirst({ where: { socketId: socket.id } })
      .catch(() => null);

    if (participant) {
      await prisma.participant
        .update({ where: { id: participant.id }, data: { socketId: null } })
        .catch(() => {});

      const fullParty = await prisma.party.findUnique({ where: { id: participant.partyId } })
        .catch(() => null);
      if (fullParty) {
        const partyWithData = await getPartyWithData(fullParty.code);
        if (partyWithData) {
          emitToParty(partyWithData, "party:sync", { party: sanitizeParty(partyWithData) });
        }
      }
    }
  });
});

server.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
