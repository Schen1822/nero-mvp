export interface Vote {
  id: string;
  songId: string;
  participantId: string;
  value: number;
  createdAt: string;
}

export interface Song {
  id: string;
  partyId: string;
  deezerId: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  addedById: string;
  position: number;
  status: "queued" | "playing" | "played";
  playedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  votes: Vote[];
}

export interface Participant {
  id: string;
  partyId: string;
  name: string;
  emoji: string;
  isHost: boolean;
  socketId: string | null;
  joinedAt: string;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  hasPassword: boolean;
  maxSongs: number | null;
  maxMinutes: number | null;
  status: "lobby" | "playing" | "ended";
  currentSongIndex: number;
  createdAt: string;
  participants: Participant[];
  songs: Song[];
}

export interface DeezerTrack {
  id: number;
  title: string;
  artist: { name: string };
  album: { title: string; cover_medium: string };
  preview: string;
  duration: number;
}
