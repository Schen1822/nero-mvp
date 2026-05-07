import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

const EMOJIS = [
  "🎵","🎸","🥁","🎹","🎺","🎻","🎤","🎧",
  "🦁","🐺","🦊","🐻","🐼","🦋","🌈","⭐",
  "🔥","💎","👑","🚀","🌙","💀","👾","🎭",
];

type Mode = "home" | "create" | "join";

export default function Landing() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<Mode>("home");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Create form
  const [partyName, setPartyName] = useState("");
  const [hostName, setHostName] = useState(user?.username || "");
  const [hostEmoji, setHostEmoji] = useState("🔥");
  const [maxSongs, setMaxSongs] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");

  // Join form
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState(user?.username || "");
  const [joinEmoji, setJoinEmoji] = useState("🎵");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinNeedsPassword, setJoinNeedsPassword] = useState(false);

  // Create form — password
  const [partyPassword, setPartyPassword] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!partyName.trim() || !hostName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { party, participantId } = await api.createParty({
        name: partyName.trim(),
        hostName: hostName.trim(),
        hostEmoji,
        maxSongs: maxSongs ? Number(maxSongs) : undefined,
        maxMinutes: maxMinutes ? Number(maxMinutes) : undefined,
        password: partyPassword || undefined,
      });
      localStorage.setItem(`party:${party.code}:pid`, participantId);
      navigate(`/party/${party.code}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeChange(val: string) {
    const code = val.toUpperCase();
    setJoinCode(code);
    setJoinNeedsPassword(false);
    setJoinPassword("");
    if (code.length === 6) {
      try {
        const { party } = await api.getParty(code);
        setJoinNeedsPassword(party.hasPassword);
      } catch { /* party not found yet, ignore */ }
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code || !joinName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { participant } = await api.joinParty(code, {
        name: joinName.trim(),
        emoji: joinEmoji,
        password: joinPassword || undefined,
      });
      localStorage.setItem(`party:${code}:pid`, participant.id);
      navigate(`/party/${code}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="landing">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      <div className="landing-content">
        {mode === "home" && (
          <div className="home-view">
            <div className="logo-wrap">
              <h1 className="logo">NERO</h1>
              <p className="logo-sub">the listening party</p>
            </div>

            <div className="home-buttons">
              <button className="btn-primary btn-xl" onClick={() => setMode("create")}>
                Host a Party
              </button>
              <button className="btn-ghost btn-xl" onClick={() => setMode("join")}>
                Join a Party
              </button>
            </div>

            <p className="landing-hint">
              Add songs. Vote. Crown the winner. 🎶
            </p>

            {user && (
              <div className="user-badge">
                <span className="user-badge-name">Signed in as <strong>{user.username}</strong></span>
                <button className="btn-ghost logout-btn" onClick={logout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "create" && (
          <div className="form-view">
            <button className="back-btn" onClick={() => { setMode("home"); setError(""); }}>
              ← Back
            </button>
            <h2 className="form-title">Host a Party</h2>
            <form onSubmit={handleCreate} className="nero-form">
              <div className="form-group">
                <label>Your Name</label>
                <div className="input-with-emoji">
                  <span className="selected-emoji">{hostEmoji}</span>
                  <input
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="DJ Supreme"
                    maxLength={24}
                    required
                  />
                </div>
                <div className="emoji-grid">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={`emoji-btn ${hostEmoji === e ? "selected" : ""}`}
                      onClick={() => setHostEmoji(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Party Name</label>
                <input
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  placeholder="Friday Night Vibes"
                  maxLength={40}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Max Songs <span className="optional">(optional)</span></label>
                  <input
                    type="number"
                    value={maxSongs}
                    onChange={(e) => setMaxSongs(e.target.value)}
                    placeholder="∞"
                    min={1}
                    max={100}
                  />
                </div>
                <div className="form-group">
                  <label>Time Limit (min) <span className="optional">(optional)</span></label>
                  <input
                    type="number"
                    value={maxMinutes}
                    onChange={(e) => setMaxMinutes(e.target.value)}
                    placeholder="∞"
                    min={1}
                    max={180}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Room Password <span className="optional">(optional)</span></label>
                <input
                  type="password"
                  value={partyPassword}
                  onChange={(e) => setPartyPassword(e.target.value)}
                  placeholder="Leave blank for public room"
                />
              </div>

              {error && <p className="form-error">{error}</p>}

              <button
                className="btn-primary btn-full"
                type="submit"
                disabled={loading}
              >
                {loading ? "Creating…" : "Create Party →"}
              </button>
            </form>
          </div>
        )}

        {mode === "join" && (
          <div className="form-view">
            <button className="back-btn" onClick={() => { setMode("home"); setError(""); }}>
              ← Back
            </button>
            <h2 className="form-title">Join a Party</h2>
            <form onSubmit={handleJoin} className="nero-form">
              <div className="form-group">
                <label>Your Name</label>
                <div className="input-with-emoji">
                  <span className="selected-emoji">{joinEmoji}</span>
                  <input
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                    placeholder="Party Animal"
                    maxLength={24}
                    required
                  />
                </div>
                <div className="emoji-grid">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={`emoji-btn ${joinEmoji === e ? "selected" : ""}`}
                      onClick={() => setJoinEmoji(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Party Code</label>
                <input
                  value={joinCode}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  placeholder="ABCD12"
                  maxLength={6}
                  className="code-input"
                  required
                />
              </div>

              {joinNeedsPassword && (
                <div className="form-group">
                  <label>Room Password 🔒</label>
                  <input
                    type="password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    placeholder="Enter room password"
                    required
                    autoFocus
                  />
                </div>
              )}

              {error && <p className="form-error">{error}</p>}

              <button
                className="btn-primary btn-full"
                type="submit"
                disabled={loading}
              >
                {loading ? "Joining…" : "Join Party →"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
