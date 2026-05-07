import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { generateShareCard } from "../lib/shareCard";
import { socket } from "../lib/socket";
import { api } from "../lib/api";
import type { Party, Song, DeezerTrack } from "../types";

// ─── Sub-components ───────────────────────────────────────────────────────────

function Visualizer({ active }: { active: boolean }) {
  return (
    <div className={`visualizer ${active ? "playing" : ""}`}>
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={i} className="bar" style={{ animationDelay: `${i * 0.07}s` }} />
      ))}
    </div>
  );
}

function avgRating(votes: { value: number }[]) {
  if (votes.length === 0) return null;
  return votes.reduce((s, v) => s + v.value, 0) / votes.length;
}

function StarPicker({
  value,
  onChange,
  size = "sm",
}: {
  value: number | null;
  onChange: (v: 1 | 2 | 3 | 4 | 5) => void;
  size?: "sm" | "lg";
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value || 0;

  return (
    <div className={`star-picker star-picker-${size}`} onMouseLeave={() => setHover(0)}>
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button
          key={n}
          className={`star-pick-btn ${active >= n ? "filled" : ""} ${hover > 0 && hover >= n ? "hovered" : ""}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          title={`${n} star${n !== 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function StarDisplay({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="star-display">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < Math.round(value) ? "star filled" : "star"}>★</span>
      ))}
    </span>
  );
}

function ScoreBadge({ votes }: { votes: { value: number }[] }) {
  const avg = avgRating(votes);
  return (
    <div className="score-badge-stars">
      {avg !== null ? (
        <>
          <StarDisplay value={avg} />
          <span className="avg-number">{avg.toFixed(1)}</span>
          <span className="avg-count">({votes.length} rating{votes.length !== 1 ? "s" : ""})</span>
        </>
      ) : (
        <span className="avg-none">No ratings yet</span>
      )}
    </div>
  );
}

function FloatingReactions({ reactions }: { reactions: { id: string; emoji: string; x: number }[] }) {
  return (
    <div className="reactions-layer">
      {reactions.map((r) => (
        <span
          key={r.id}
          className="float-reaction"
          style={{ left: `${r.x}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}

const REVEAL_DURATION = 6000;

function VoteReveal({
  song,
  participants,
}: {
  song: Song;
  participants: import("../types").Participant[];
}) {
  const [visible, setVisible] = useState<number[]>([]);
  const avg = avgRating(song.votes);

  // Stagger each voter row appearing
  useEffect(() => {
    song.votes.forEach((_, i) => {
      setTimeout(() => setVisible((v) => [...v, i]), 300 + i * 180);
    });
  }, [song.votes]);

  const voters = song.votes
    .map((v) => ({
      ...v,
      participant: participants.find((p) => p.id === v.participantId),
    }))
    .filter((v) => v.participant);

  return (
    <div className="vote-reveal-overlay">
      <div className="vote-reveal-card">
        <p className="reveal-label">Votes are in</p>

        <div className="reveal-song-info">
          {song.coverUrl && (
            <img src={song.coverUrl} alt="" className="reveal-cover" />
          )}
          <div>
            <p className="reveal-song-title">{song.title}</p>
            <p className="reveal-song-artist">{song.artist}</p>
          </div>
        </div>

        <div className="reveal-voters">
          {voters.length === 0 && (
            <p className="reveal-no-votes">No one voted this round</p>
          )}
          {voters.map((v, i) => (
            <div
              key={v.id}
              className={`reveal-voter-row ${visible.includes(i) ? "reveal-voter-visible" : ""}`}
            >
              <span className="reveal-voter-avatar">{v.participant!.emoji}</span>
              <span className="reveal-voter-name">{v.participant!.name}</span>
              <span className="reveal-voter-stars">
                {Array.from({ length: 5 }, (_, s) => (
                  <span key={s} className={s < v.value ? "rv-star filled" : "rv-star"}>★</span>
                ))}
              </span>
              <span className="reveal-voter-num">{v.value}</span>
            </div>
          ))}
        </div>

        {avg !== null && (
          <div className="reveal-avg">
            <span className="reveal-avg-label">Average</span>
            <StarDisplay value={avg} />
            <span className="reveal-avg-num">{avg.toFixed(2)}</span>
          </div>
        )}

        <div className="reveal-countdown">
          <div className="reveal-countdown-bar" style={{ animationDuration: `${REVEAL_DURATION}ms` }} />
        </div>
      </div>
    </div>
  );
}

interface ChatMessage {
  id: string;
  participantId: string;
  name: string;
  emoji: string;
  text: string;
  sentAt: number;
}

const REACTION_EMOJIS = ["🔥", "💯", "😍", "🤯", "👏", "💀", "😭", "🥳", "🎵", "😤"];

function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  const [burst, setBurst] = useState<string | null>(null);

  function fire(emoji: string) {
    onReact(emoji);
    setBurst(emoji);
    setTimeout(() => setBurst(null), 300);
  }

  return (
    <div className="reaction-bar">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          className={`reaction-btn ${burst === emoji ? "reaction-burst" : ""}`}
          onClick={() => fire(emoji)}
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ChatDrawer({
  open,
  onClose,
  messages,
  participantId,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  participantId: string;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className={`chat-drawer ${open ? "chat-open" : ""}`}>
      <div className="chat-header">
        <span className="chat-title">Chat</span>
        <button className="chat-close" onClick={onClose}>✕</button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">No messages yet. Say something! 👋</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.participantId === participantId ? "chat-mine" : ""}`}>
            <span className="chat-msg-avatar">{msg.emoji}</span>
            <div className="chat-msg-body">
              <span className="chat-msg-name">{msg.name}</span>
              <span className="chat-msg-text">{msg.text}</span>
              <span className="chat-msg-time">{formatTime(msg.sentAt)}</span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          className="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something…"
          maxLength={300}
          autoComplete="off"
        />
        <button className="chat-send" type="submit" disabled={!text.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}

function AddSong({
  partyCode,
  participantId,
  onAdd,
  disabled,
}: {
  partyCode: string;
  participantId: string;
  onAdd: (song: Song) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DeezerTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  function handleSearch(q: string) {
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchDeezer(q);
        setResults(data.data || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  }

  async function handleAdd(track: DeezerTrack) {
    setAdding(track.id);
    try {
      const { song } = await api.addSong(partyCode, {
        participantId,
        deezerId: track.id,
        title: track.title,
        artist: track.artist.name,
        album: track.album.title,
        coverUrl: track.album.cover_medium,
        previewUrl: track.preview,
      });
      onAdd(song);
      setQuery("");
      setResults([]);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to add song");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className={`add-song ${disabled ? "add-song-disabled" : ""}`}>
      <div className="search-box">
        <span className="search-icon">🔍</span>
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={disabled ? "Queue is full" : "Search for a song…"}
          disabled={disabled}
        />
        {searching && <span className="spinner" />}
      </div>

      {results.length > 0 && (
        <div className="search-results">
          {results.map((track) => (
            <button
              key={track.id}
              className="search-result-item"
              onClick={() => handleAdd(track)}
              disabled={adding === track.id}
            >
              <img src={track.album.cover_medium} alt="" className="result-cover" />
              <div className="result-info">
                <span className="result-title">{track.title}</span>
                <span className="result-artist">{track.artist.name}</span>
              </div>
              <span className="result-add">
                {adding === track.id ? "…" : "+"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SongRow({
  song,
  isCurrent,
  myVote,
  onVote,
  participants,
  isHost = false,
  isFirst = false,
  isLast = false,
  onMove,
}: {
  song: Song;
  isCurrent: boolean;
  myVote: number | null;
  onVote: (songId: string, value: 1 | 2 | 3 | 4 | 5) => void;
  participants: import("../types").Participant[];
  isHost?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onMove?: (songId: string, direction: "up" | "down") => void;
}) {
  const avg = avgRating(song.votes);
  const isPast = song.status === "played";
  const isQueued = song.status === "queued";
  const isRatable = isCurrent || isPast;
  const adder = participants.find((p) => p.id === song.addedById);

  return (
    <div className={`song-row ${isCurrent ? "song-row-current" : ""} ${isPast ? "song-row-past" : ""}`}>
      {isCurrent && <div className="current-indicator" />}
      {isHost && isQueued && onMove && (
        <div className="queue-move-btns">
          <button
            className="queue-move-btn"
            onClick={() => onMove(song.id, "up")}
            disabled={isFirst}
            title="Move up"
          >▲</button>
          <button
            className="queue-move-btn"
            onClick={() => onMove(song.id, "down")}
            disabled={isLast}
            title="Move down"
          >▼</button>
        </div>
      )}
      <img
        src={song.coverUrl || `https://picsum.photos/seed/${song.id}/48/48`}
        alt=""
        className="song-cover-sm"
      />
      <div className="song-info">
        <span className="song-title-sm">{song.title}</span>
        <span className="song-artist-sm">{song.artist}</span>
        {adder && (
          <span className="song-adder">
            {adder.emoji} {adder.name}
          </span>
        )}
      </div>
      <div className="song-rating-col">
        {isRatable ? (
          <StarPicker value={myVote} onChange={(v) => onVote(song.id, v)} size="sm" />
        ) : (
          avg !== null && <span className="queue-avg">★ {avg.toFixed(1)}</span>
        )}
        {avg !== null && (
          <span className="queue-avg-count">({song.votes.length})</span>
        )}
      </div>
    </div>
  );
}

function Results({ party, onGoHome }: { party: Party; onGoHome: () => void }) {
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const played = party.songs
    .map((s) => {
      const avg = avgRating(s.votes);
      return { ...s, avg, ratingCount: s.votes.length };
    })
    .sort((a, b) => {
      if (a.avg === null && b.avg === null) return 0;
      if (a.avg === null) return 1;
      if (b.avg === null) return -1;
      return b.avg - a.avg || b.ratingCount - a.ratingCount;
    });

  const winner = played[0];
  const runnerUps = played.slice(1, 3);

  function submitterOf(song: typeof played[0]) {
    const p = party.participants.find((p) => p.id === song.addedById);
    return p ? `${p.emoji} ${p.name}` : null;
  }

  async function handleCopyLink() {
    setCopying(true);
    await navigator.clipboard.writeText(window.location.href);
    setTimeout(() => setCopying(false), 2000);
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const dataUrl = await generateShareCard(party);
      const link = document.createElement("a");
      link.download = `nero-${party.name.replace(/\s+/g, "-").toLowerCase()}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="results-view">
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="results-card">
        <div className="card-header">
          <span className="card-nero">NERO</span>
          <span className="card-party-name">{party.name}</span>
          <span className="card-date">{new Date(party.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
        </div>

        {winner && (
          <div className="card-winner">
            <div className="crown">👑</div>
            <div className="winner-art-wrap">
              <img
                src={winner.coverUrl || `https://picsum.photos/seed/${winner.id}/280/280`}
                alt=""
                className="winner-art"
              />
              <div className="winner-glow" />
            </div>
            <h2 className="winner-title">{winner.title}</h2>
            <p className="winner-artist">{winner.artist}</p>
            {submitterOf(winner) && (
              <p className="winner-submitter">queued by {submitterOf(winner)}</p>
            )}
            <div className="winner-stars">
              {winner.avg !== null ? (
                <>
                  <StarDisplay value={winner.avg} />
                  <span className="winner-avg">{winner.avg.toFixed(2)}</span>
                  <span className="winner-avg-sub">avg · {winner.ratingCount} rating{winner.ratingCount !== 1 ? "s" : ""}</span>
                </>
              ) : (
                <span className="avg-none">No ratings</span>
              )}
            </div>
          </div>
        )}

        {runnerUps.length > 0 && (
          <div className="podium-row">
            {runnerUps.map((song, i) => (
              <div key={song.id} className="podium-card">
                <span className="podium-medal">{i === 0 ? "🥈" : "🥉"}</span>
                <img
                  src={song.coverUrl || `https://picsum.photos/seed/${song.id}/80/80`}
                  alt=""
                  className="podium-art"
                />
                <p className="podium-title">{song.title}</p>
                <p className="podium-artist">{song.artist}</p>
                <div className="podium-rating">
                  {song.avg !== null ? (
                    <>
                      <StarDisplay value={song.avg} />
                      <span className="podium-avg">{song.avg.toFixed(2)}</span>
                    </>
                  ) : (
                    <span className="podium-no-rating">No ratings</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="leaderboard">
          <h3 className="leaderboard-title">Full Rankings</h3>
          {played.map((song, i) => (
            <div key={song.id} className={`lb-row ${i === 0 ? "lb-winner" : ""}`}>
              <span className="lb-rank">
                {i === 0 ? "👑" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
              </span>
              <img
                src={song.coverUrl || `https://picsum.photos/seed/${song.id}/40/40`}
                alt=""
                className="lb-cover"
              />
              <div className="lb-info">
                <span className="lb-song">{song.title}</span>
                <span className="lb-artist">{song.artist}</span>
                {submitterOf(song) && (
                  <span className="lb-submitter">{submitterOf(song)}</span>
                )}
              </div>
              <div className="lb-scores">
                {song.avg !== null ? (
                  <>
                    <StarDisplay value={song.avg} />
                    <span className="lb-avg">{song.avg.toFixed(2)}</span>
                    <span className="lb-count">({song.ratingCount})</span>
                  </>
                ) : (
                  <span className="lb-count">—</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card-footer">nero party · {window.location.href}</div>
      </div>

      {/* Action buttons — outside the card so they don't appear in the PNG */}
      <div className="results-actions">
        <button className="btn-share" onClick={handleCopyLink}>
          {copying ? "✓ Link copied!" : "🔗 Copy link"}
        </button>
        <button className="btn-share btn-download" onClick={handleDownload} disabled={downloading}>
          {downloading ? "Exporting…" : "⬇ Download card"}
        </button>
        <button className="btn-ghost home-btn" onClick={onGoHome}>
          ← Back to Home
        </button>
      </div>
    </div>
  );
}

// ─── Main PartyRoom ───────────────────────────────────────────────────────────

export default function PartyRoom() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;
  const [reveal, setReveal] = useState<{ song: Song; participants: import("../types").Participant[] } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval>>();
  const isHostRef = useRef(false);
  const currentSongIdRef = useRef<string | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const participantId = localStorage.getItem(`party:${code}:pid`) || "";

  const isHost = party?.participants.find((p) => p.id === participantId)?.isHost ?? false;
  const currentSong = party?.songs.find((s) => s.status === "playing") ?? null;

  // Keep ref in sync so stale closures (onended) always see current value
  isHostRef.current = isHost;

  const myVoteFor = useCallback(
    (songId: string) => {
      if (!party) return null;
      const song = party.songs.find((s) => s.id === songId);
      const vote = song?.votes.find((v) => v.participantId === participantId);
      return vote?.value ?? null;
    },
    [party, participantId]
  );

  // Play audio
  function playSong(song: Song, offsetMs = 0) {
    if (!song.previewUrl) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    currentSongIdRef.current = song.id;
    const audio = new Audio(song.previewUrl);
    audio.currentTime = Math.min(offsetMs / 1000, 28);
    audioRef.current = audio;

    audio.play().catch(() => {});

    clearInterval(progressRef.current);
    progressRef.current = setInterval(() => {
      if (audio.duration) {
        setProgress(audio.currentTime / audio.duration);
      }
    }, 200);

    audio.onended = () => {
      clearInterval(progressRef.current);
      setProgress(1);
      if (isHostRef.current) {
        socket.emit("song:reveal-request", { partyCode: code });
        setTimeout(() => {
          api.nextSong(code!, participantId).catch(console.error);
        }, REVEAL_DURATION);
      }
    };
  }

  // Socket setup
  useEffect(() => {
    if (!code) {
      navigate("/");
      return;
    }

    // Non-participants (shared link viewers) just load the party data without joining socket
    if (!participantId) {
      api.getParty(code)
        .then(({ party: p }) => setParty(p))
        .catch(() => setError("Party not found"))
        .finally(() => setLoading(false));
      return;
    }

    function emitJoin() {
      socket.emit("party:join", { partyCode: code, participantId });
    }

    socket.on("connect", emitJoin);
    socket.connect();

    socket.on("party:sync", ({ party: p }: { party: Party }) => {
      setParty(p);
      if (p.status === "playing") {
        const playing = p.songs.find((s) => s.status === "playing");
        // Only restart audio if the playing song actually changed
        if (playing?.startedAt && playing.id !== currentSongIdRef.current) {
          const offset = Date.now() - new Date(playing.startedAt).getTime();
          playSong(playing, offset);
        }
      }
    });

    socket.on("party:started", ({ party: p, startedAt: sa }: { party: Party; startedAt: number }) => {
      setParty(p);
      const playing = p.songs.find((s) => s.status === "playing");
      if (playing) {
        const offset = Date.now() - sa;
        playSong(playing, offset);
      }
    });

    socket.on("song:changed", ({ song, party: p, startedAt: sa }: { song: Song; party: Party; startedAt: number }) => {
      setReveal(null);
      setParty(p);
      setProgress(0);
      const offset = Date.now() - sa;
      playSong(song, offset);
    });

    socket.on("song:voted", ({ song }: { song: Song }) => {
      setParty((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          songs: prev.songs.map((s) => (s.id === song.id ? song : s)),
        };
      });
    });

    socket.on("queue:empty", ({ party: p }: { party: Party }) => {
      setReveal(null);
      setParty(p);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      clearInterval(progressRef.current);
      setProgress(0);
    });

    socket.on("party:ended", ({ party: p }: { party: Party }) => {
      setParty(p);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      clearInterval(progressRef.current);
    });

    socket.on("song:reveal", ({ song, participants }: { song: Song; participants: import("../types").Participant[] }) => {
      setReveal({ song, participants });
      clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = setTimeout(() => setReveal(null), REVEAL_DURATION + 500);
    });

    socket.on("chat:message", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      if (!chatOpenRef.current) setUnread((n) => n + 1);
    });

    socket.on("reaction:float", ({ emoji, id: rid }: { emoji: string; id: string }) => {
      const key = `${rid}-${Date.now()}`;
      const x = 10 + Math.random() * 80;
      setReactions((prev) => [...prev, { id: key, emoji, x }]);
      setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== key)), 2000);
    });

    // Initial load
    api.getParty(code).then(({ party: p }) => {
      setParty(p);
      if (p.status === "playing") {
        const playing = p.songs.find((s) => s.status === "playing");
        if (playing?.startedAt) {
          const offset = Date.now() - new Date(playing.startedAt).getTime();
          playSong(playing, offset);
        }
      }
    }).catch(() => setError("Party not found"))
      .finally(() => setLoading(false));

    return () => {
      socket.off("connect", emitJoin);
      socket.off("party:sync");
      socket.off("party:started");
      socket.off("song:changed");
      socket.off("song:voted");
      socket.off("queue:empty");
      socket.off("party:ended");
      socket.off("song:reveal");
      socket.off("chat:message");
      socket.off("reaction:float");
      socket.disconnect();
      audioRef.current?.pause();
      clearInterval(progressRef.current);
      clearTimeout(revealTimeoutRef.current);
    };
  }, [code]); // eslint-disable-line

  function sendReaction(emoji: string) {
    socket.emit("reaction", { partyCode: code, emoji });
  }

  function sendChat(text: string) {
    socket.emit("chat:send", { partyCode: code, participantId, text });
  }

  function openChat() {
    setChatOpen(true);
    setUnread(0);
  }

  async function handleVote(songId: string, value: 1 | 2 | 3 | 4 | 5) {
    try {
      await api.vote(code!, songId, participantId, value);
      const stars = ["⭐", "⭐⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"][value - 1];
      socket.emit("reaction", { partyCode: code, emoji: stars });
    } catch (err: unknown) {
      console.error(err);
    }
  }

  async function handleStart() {
    try {
      await api.startParty(code!, participantId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to start");
    }
  }

  async function handleNext() {
    try {
      await api.nextSong(code!, participantId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to skip");
    }
  }

  async function handleEnd() {
    if (!confirm("End the party? This will reveal the winner!")) return;
    try {
      await api.endParty(code!, participantId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to end");
    }
  }

  async function handleMove(songId: string, direction: "up" | "down") {
    try {
      await api.moveSong(code!, songId, participantId, direction);
    } catch (err: unknown) {
      console.error(err);
    }
  }

  function copyCode() {
    navigator.clipboard.writeText(code || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="orb orb-1" />
        <div className="spinner-lg" />
        <p>Tuning in…</p>
      </div>
    );
  }

  if (error || !party) {
    return (
      <div className="loading-screen">
        <p className="error-msg">{error || "Something went wrong"}</p>
        <button className="btn-primary" onClick={() => navigate("/")}>
          Go Home
        </button>
      </div>
    );
  }

  if (party.status === "ended") {
    return (
      <div className="party-room">
        <header className="party-header">
          <div className="header-left">
            <span className="nero-wordmark">NERO</span>
            <span className="party-name">{party.name}</span>
          </div>
          <div className="participants-bar">
            {party.participants.map((p) => (
              <span key={p.id} className="participant-pip" title={p.name}>
                {p.emoji}
              </span>
            ))}
          </div>
        </header>
        <Results party={party} onGoHome={() => navigate("/")} />
      </div>
    );
  }

  const queued = party.songs.filter((s) => s.status === "queued");
  const played = party.songs.filter((s) => s.status === "played");
  const atLimit = party.maxSongs != null && party.songs.length >= party.maxSongs;

  return (
    <div className="party-room">
      <header className="party-header">
        <div className="header-left">
          <span className="nero-wordmark">NERO</span>
          <span className="party-name">{party.name}</span>
          {party.status === "lobby" && (
            <span className="status-badge lobby">LOBBY</span>
          )}
          {party.status === "playing" && (
            <span className="status-badge live">● LIVE</span>
          )}
        </div>

        <div className="header-center">
          <button className="code-chip" onClick={copyCode} title="Copy code">
            {copied ? "✓ Copied!" : code}
          </button>
          <button className="share-btn" onClick={copyLink} title="Copy invite link">
            🔗
          </button>
        </div>

        <div className="header-right participants-bar">
          {party.participants.map((p) => (
            <span
              key={p.id}
              className={`participant-pip ${p.socketId ? "online" : "offline"}`}
              title={`${p.name}${p.isHost ? " (host)" : ""}`}
            >
              {p.emoji}
            </span>
          ))}
          {participantId && (
            <button className="chat-toggle" onClick={openChat} title="Open chat">
              💬
              {unread > 0 && <span className="chat-badge">{unread > 9 ? "9+" : unread}</span>}
            </button>
          )}
        </div>
      </header>

      {participantId && (
        <ChatDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          messages={messages}
          participantId={participantId}
          onSend={sendChat}
        />
      )}

      <div className="party-body">
        {/* ── Left panel: Now Playing ── */}
        <div className="left-panel">
          {party.status === "lobby" && (
            <div className="lobby-panel">
              <div className="lobby-art">
                <div className="lobby-pulse">
                  <span className="lobby-icon">🎵</span>
                </div>
              </div>
              <h2 className="lobby-title">Waiting for host to start</h2>
              <p className="lobby-sub">
                {party.songs.length === 0
                  ? "Add some songs to the queue first →"
                  : `${party.songs.length} song${party.songs.length !== 1 ? "s" : ""} ready to play`}
              </p>

              <div className="lobby-code-display">
                <p className="invite-label">Invite friends with code:</p>
                <button className="invite-code" onClick={copyCode}>
                  {code}
                  <span className="copy-hint">{copied ? " ✓" : " copy"}</span>
                </button>
              </div>

              {isHost && (
                <button
                  className="btn-primary btn-start"
                  onClick={handleStart}
                  disabled={party.songs.length === 0}
                >
                  Start the Party 🔥
                </button>
              )}

              <ReactionBar onReact={sendReaction} />
            </div>
          )}

          {party.status === "playing" && !currentSong && (
            <div className="lobby-panel">
              <div className="lobby-art">
                <div className="lobby-pulse">
                  <span className="lobby-icon">🎵</span>
                </div>
              </div>
              <h2 className="lobby-title">Queue is empty</h2>
              <p className="lobby-sub">Add more songs to keep the party going →</p>
              <ReactionBar onReact={sendReaction} />
              {isHost && (
                <button className="btn-end" style={{ marginTop: "1rem" }} onClick={handleEnd}>
                  End Party
                </button>
              )}
            </div>
          )}

          {party.status === "playing" && currentSong && (
            <div className="now-playing">
              {reveal && (
                <VoteReveal song={reveal.song} participants={reveal.participants} />
              )}
              <FloatingReactions reactions={reactions} />

              <div className="now-playing-art-wrap">
                <img
                  src={currentSong.coverUrl || `https://picsum.photos/seed/${currentSong.id}/300/300`}
                  alt={currentSong.title}
                  className="now-playing-art"
                />
                <div className="art-glow" />
              </div>

              <div className="now-playing-info">
                <h2 className="np-title">{currentSong.title}</h2>
                <p className="np-artist">{currentSong.artist}</p>
                {currentSong.album && (
                  <p className="np-album">{currentSong.album}</p>
                )}
              </div>

              <Visualizer active />

              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
              </div>

              <ScoreBadge votes={currentSong.votes} />

              <div className="vote-area-stars">
                <p className="rate-label">Your rating</p>
                <StarPicker
                  value={myVoteFor(currentSong.id)}
                  onChange={(v) => handleVote(currentSong.id, v)}
                  size="lg"
                />
                {myVoteFor(currentSong.id) && (
                  <p className="your-rating-label">
                    You rated this {myVoteFor(currentSong.id)} star{myVoteFor(currentSong.id) !== 1 ? "s" : ""}
                  </p>
                )}
              </div>

              <ReactionBar onReact={sendReaction} />

              {isHost && (
                <div className="host-controls">
                  <button className="btn-skip" onClick={handleNext}>
                    ⏭ Next
                  </button>
                  <button className="btn-end" onClick={handleEnd}>
                    End Party
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel: Participants + Queue ── */}
        <div className="right-panel">
          {/* Participants */}
          <div className="participants-panel">
            <div className="participants-panel-header">
              <h3 className="queue-title">Participants</h3>
              <span className="queue-count">
                {party.participants.filter((p) => p.socketId).length} online
                {" · "}
                {party.participants.length} total
              </span>
            </div>
            <div className="participants-list">
              {party.participants.map((p) => (
                <div key={p.id} className={`participant-row ${p.socketId ? "p-online" : "p-offline"}`}>
                  <span className="p-emoji">{p.emoji}</span>
                  <span className="p-name">{p.name}</span>
                  {p.isHost && <span className="p-host-badge">host</span>}
                  <span className={`p-status-dot ${p.socketId ? "online" : ""}`} />
                </div>
              ))}
            </div>
          </div>

          {/* Queue */}
          <div className="queue-header">
            <h3 className="queue-title">Queue</h3>
            {party.maxSongs && (
              <span className="queue-count">
                {party.songs.length} / {party.maxSongs}
              </span>
            )}
          </div>

          <div className="queue-list">
            {played.map((song) => (
              <SongRow
                key={song.id}
                song={song}
                isCurrent={false}
                myVote={myVoteFor(song.id)}
                onVote={handleVote}
                participants={party.participants}
              />
            ))}
            {currentSong && (
              <SongRow
                key={currentSong.id}
                song={currentSong}
                isCurrent
                myVote={myVoteFor(currentSong.id)}
                onVote={handleVote}
                participants={party.participants}
              />
            )}
            {queued.map((song, idx) => (
              <SongRow
                key={song.id}
                song={song}
                isCurrent={false}
                myVote={myVoteFor(song.id)}
                onVote={handleVote}
                participants={party.participants}
                isHost={isHost}
                isFirst={idx === 0}
                isLast={idx === queued.length - 1}
                onMove={handleMove}
              />
            ))}
            {party.songs.length === 0 && (
              <p className="queue-empty">No songs yet. Search below to add one!</p>
            )}
          </div>

          <AddSong
            partyCode={code!}
            participantId={participantId}
            onAdd={(song) => {
              setParty((prev) => {
                if (!prev) return prev;
                const exists = prev.songs.find((s) => s.id === song.id);
                if (exists) return prev;
                return { ...prev, songs: [...prev.songs, song] };
              });
            }}
            disabled={atLimit}
          />
        </div>
      </div>
    </div>
  );
}
