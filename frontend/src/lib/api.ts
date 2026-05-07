const BASE = "http://localhost:3000";

function authHeader(): Record<string, string> {
  const token = localStorage.getItem("nero:token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const api = {
  createParty: (body: {
    name: string;
    hostName: string;
    hostEmoji: string;
    maxSongs?: number;
    maxMinutes?: number;
    password?: string;
  }) => req<{ party: import("../types").Party; participantId: string }>("/parties", { method: "POST", body: JSON.stringify(body) }),

  getParty: (code: string) =>
    req<{ party: import("../types").Party }>(`/parties/${code}`),

  joinParty: (code: string, body: { name: string; emoji: string; password?: string }) =>
    req<{ participant: import("../types").Participant }>(`/parties/${code}/join`, { method: "POST", body: JSON.stringify(body) }),

  startParty: (code: string, participantId: string) =>
    req<{ party: import("../types").Party; startedAt: number }>(`/parties/${code}/start`, {
      method: "POST",
      body: JSON.stringify({ participantId }),
    }),

  addSong: (
    code: string,
    body: {
      participantId: string;
      deezerId: number;
      title: string;
      artist: string;
      album?: string;
      coverUrl?: string;
      previewUrl?: string;
    }
  ) => req<{ song: import("../types").Song }>(`/parties/${code}/songs`, { method: "POST", body: JSON.stringify(body) }),

  vote: (code: string, songId: string, participantId: string, value: 1 | 2 | 3 | 4 | 5) =>
    req<{ song: import("../types").Song }>(`/parties/${code}/songs/${songId}/vote`, {
      method: "POST",
      body: JSON.stringify({ participantId, value }),
    }),

  nextSong: (code: string, participantId: string) =>
    req<{ song?: import("../types").Song; ended?: boolean; party?: import("../types").Party; startedAt?: number }>(`/parties/${code}/next`, {
      method: "POST",
      body: JSON.stringify({ participantId }),
    }),

  endParty: (code: string, participantId: string) =>
    req<{ party: import("../types").Party }>(`/parties/${code}/end`, {
      method: "POST",
      body: JSON.stringify({ participantId }),
    }),

  moveSong: (code: string, songId: string, participantId: string, direction: "up" | "down") =>
    req<{ party: import("../types").Party }>(`/parties/${code}/songs/${songId}/position`, {
      method: "PUT",
      body: JSON.stringify({ participantId, direction }),
    }),

  searchDeezer: (q: string) =>
    req<{ data: import("../types").DeezerTrack[] }>(`/search?q=${encodeURIComponent(q)}`),
};
