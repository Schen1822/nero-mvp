import type { Party } from "../types";

function avg(votes: { value: number }[]) {
  if (!votes.length) return null;
  return votes.reduce((s, v) => s + v.value, 0) / votes.length;
}

function trunc(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function generateShareCard(party: Party): Promise<string> {
  const W = 640, H = 960;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);

  // ── Background ──────────────────────────────────────────────────
  ctx.fillStyle = "#07070f";
  ctx.fillRect(0, 0, W, H);

  const g1 = ctx.createRadialGradient(80, 80, 0, 80, 80, 300);
  g1.addColorStop(0, "rgba(168,85,247,0.28)");
  g1.addColorStop(1, "transparent");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(W - 80, H - 80, 0, W - 80, H - 80, 280);
  g2.addColorStop(0, "rgba(236,72,153,0.22)");
  g2.addColorStop(1, "transparent");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // ── Header ──────────────────────────────────────────────────────
  const logoGrad = ctx.createLinearGradient(32, 0, 115, 0);
  logoGrad.addColorStop(0, "#a855f7");
  logoGrad.addColorStop(1, "#ec4899");
  ctx.fillStyle = logoGrad;
  ctx.font = "900 20px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("NERO", 32, 46);

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(89, 39, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 14px -apple-system, system-ui, sans-serif";
  ctx.fillText(trunc(party.name, 28), 99, 46);

  const dateStr = new Date(party.createdAt).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  ctx.fillStyle = "#475569";
  ctx.font = "400 13px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(dateStr, W - 32, 46);
  ctx.textAlign = "left";

  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, 62);
  ctx.lineTo(W - 32, 62);
  ctx.stroke();

  // ── Compute stats ────────────────────────────────────────────────
  const played = party.songs.filter(
    (s) => s.status === "played" || s.status === "playing"
  );

  const ranked = played
    .map((s) => ({ ...s, avg: avg(s.votes) }))
    .sort((a, b) => {
      if (a.avg === null) return 1;
      if (b.avg === null) return -1;
      return b.avg - a.avg;
    });

  const winner = ranked[0];
  const runnerUps = ranked.slice(1, 3);

  const pStats = party.participants.map((p) => {
    const myVotes = played.flatMap((s) =>
      s.votes.filter((v) => v.participantId === p.id)
    );
    const ratingAvg = myVotes.length
      ? myVotes.reduce((s, v) => s + v.value, 0) / myVotes.length
      : null;
    const submitted = played.filter((s) => s.addedById === p.id).length;
    return { ...p, ratingAvg, submitted };
  });

  const voters = pStats.filter((p) => p.ratingAvg !== null);
  const biggestFan = voters.length
    ? [...voters].sort((a, b) => b.ratingAvg! - a.ratingAvg!)[0]
    : null;
  const harshest = voters.length
    ? [...voters].sort((a, b) => a.ratingAvg! - b.ratingAvg!)[0]
    : null;
  const mostSubmitted = [...pStats].sort((a, b) => b.submitted - a.submitted)[0];

  let hottestTake: { emoji: string; name: string; value: number; songTitle: string } | null = null;
  let maxDev = 0;
  for (const song of played) {
    const songAvg = avg(song.votes);
    if (songAvg === null || song.votes.length < 2) continue;
    for (const vote of song.votes) {
      const dev = Math.abs(vote.value - songAvg);
      if (dev > maxDev) {
        maxDev = dev;
        const p = party.participants.find((p) => p.id === vote.participantId);
        if (p) hottestTake = { emoji: p.emoji, name: p.name, value: vote.value, songTitle: song.title };
      }
    }
  }

  const host = party.participants.find((p) => p.isHost);
  const overallAvg = avg(played.flatMap((s) => s.votes));

  // ── Winner section ───────────────────────────────────────────────
  const [albumImg, ...runnerUpImgs] = await Promise.all([
    winner?.coverUrl
      ? loadImg(`http://localhost:3000/proxy-image?url=${encodeURIComponent(winner.coverUrl)}`)
      : Promise.resolve(null),
    ...runnerUps.map((s) =>
      s.coverUrl
        ? loadImg(`http://localhost:3000/proxy-image?url=${encodeURIComponent(s.coverUrl)}`)
        : Promise.resolve(null)
    ),
  ]);

  const ART = 152;
  const artX = (W - ART) / 2;
  const artY = 86;

  // Crown
  ctx.font = "30px serif";
  ctx.textAlign = "center";
  ctx.fillText("👑", W / 2, artY - 6);

  // Glow
  const glowG = ctx.createRadialGradient(W / 2, artY + ART / 2, 0, W / 2, artY + ART / 2, ART);
  glowG.addColorStop(0, "rgba(168,85,247,0.5)");
  glowG.addColorStop(1, "transparent");
  ctx.fillStyle = glowG;
  ctx.fillRect(artX - 50, artY - 50, ART + 100, ART + 100);

  // Album art clipped
  ctx.save();
  roundRect(ctx, artX, artY, ART, ART, 18);
  ctx.clip();
  if (albumImg) {
    ctx.drawImage(albumImg, artX, artY, ART, ART);
  } else {
    ctx.fillStyle = "rgba(168,85,247,0.3)";
    ctx.fill();
    ctx.font = "44px serif";
    ctx.textAlign = "center";
    ctx.fillText("🎵", W / 2, artY + ART / 2 + 14);
  }
  ctx.restore();

  // Song title
  ctx.textAlign = "center";
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "800 22px -apple-system, system-ui, sans-serif";
  ctx.fillText(trunc(winner?.title ?? "—", 34), W / 2, artY + ART + 30);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "400 15px -apple-system, system-ui, sans-serif";
  ctx.fillText(trunc(winner?.artist ?? "", 38), W / 2, artY + ART + 52);

  // Stars
  if (winner?.avg != null) {
    const filled = Math.round(winner.avg);
    ctx.font = "18px serif";
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i < filled ? "#facc15" : "rgba(255,255,255,0.15)";
      ctx.fillText("★", W / 2 - 48 + i * 22, artY + ART + 78);
    }
    ctx.fillStyle = "#facc15";
    ctx.font = "700 13px -apple-system, system-ui, sans-serif";
    ctx.fillText(
      `${winner.avg.toFixed(2)} avg · ${winner.votes.length} rating${winner.votes.length !== 1 ? "s" : ""}`,
      W / 2,
      artY + ART + 100
    );
  }

  // ── Runner-up podium ─────────────────────────────────────────────
  const PODIUM_Y = artY + ART + 124;
  const PODIUM_CARD_H = 86;
  const PODIUM_GAP = 10;
  const PODIUM_CARD_W = (W - 64 - PODIUM_GAP) / 2;
  const MEDALS = ["🥈", "🥉"];

  if (runnerUps.length > 0) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 9px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("RUNNER-UPS", 32, PODIUM_Y - 6);

    runnerUps.forEach((song, i) => {
      const x = 32 + i * (PODIUM_CARD_W + PODIUM_GAP);
      const y = PODIUM_Y;

      roundRect(ctx, x, y, PODIUM_CARD_W, PODIUM_CARD_H, 10);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      roundRect(ctx, x, y, PODIUM_CARD_W, PODIUM_CARD_H, 10);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Album art
      const ART_SZ = 54;
      ctx.save();
      roundRect(ctx, x + 12, y + 16, ART_SZ, ART_SZ, 8);
      ctx.clip();
      const img = runnerUpImgs[i];
      if (img) {
        ctx.drawImage(img, x + 12, y + 16, ART_SZ, ART_SZ);
      } else {
        ctx.fillStyle = "rgba(168,85,247,0.25)";
        ctx.fill();
        ctx.font = "20px serif";
        ctx.textAlign = "center";
        ctx.fillText("🎵", x + 12 + ART_SZ / 2, y + 16 + ART_SZ / 2 + 7);
      }
      ctx.restore();

      // Medal badge over art
      ctx.font = "13px serif";
      ctx.textAlign = "left";
      ctx.fillText(MEDALS[i], x + 10, y + 17);

      // Text
      const textX = x + 12 + ART_SZ + 10;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "700 13px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(trunc(song.title, 18), textX, y + 30);

      ctx.fillStyle = "#64748b";
      ctx.font = "400 11px -apple-system, system-ui, sans-serif";
      ctx.fillText(trunc(song.artist, 20), textX, y + 46);

      if (song.avg !== null) {
        const filled = Math.round(song.avg);
        ctx.font = "11px serif";
        for (let s = 0; s < 5; s++) {
          ctx.fillStyle = s < filled ? "#facc15" : "rgba(255,255,255,0.15)";
          ctx.fillText("★", textX + s * 13, y + 64);
        }
        ctx.fillStyle = "#facc15";
        ctx.font = "600 10px -apple-system, system-ui, sans-serif";
        ctx.fillText(`${song.avg.toFixed(2)}`, textX + 68, y + 64);
      } else {
        ctx.fillStyle = "#475569";
        ctx.font = "400 10px -apple-system, system-ui, sans-serif";
        ctx.fillText("no ratings", textX, y + 64);
      }
    });
  }

  // ── Stats grid ───────────────────────────────────────────────────
  const statsY = PODIUM_Y + (runnerUps.length > 0 ? PODIUM_CARD_H + 18 : 0);
  const COLS = 2, GAP = 10, CARD_H = 84;
  const CARD_W = (W - 64 - GAP) / COLS;

  const statItems = [
    {
      icon: "🎤",
      label: "Biggest Fan",
      val: biggestFan ? `${biggestFan.emoji} ${biggestFan.name}` : "—",
      sub: biggestFan?.ratingAvg != null ? `${biggestFan.ratingAvg.toFixed(1)} avg ★` : "",
    },
    {
      icon: "💀",
      label: "Harshest Critic",
      val: harshest ? `${harshest.emoji} ${harshest.name}` : "—",
      sub: harshest?.ratingAvg != null ? `${harshest.ratingAvg.toFixed(1)} avg ★` : "",
    },
    {
      icon: "📀",
      label: "Most Queued",
      val: mostSubmitted ? `${mostSubmitted.emoji} ${mostSubmitted.name}` : "—",
      sub: mostSubmitted ? `${mostSubmitted.submitted} song${mostSubmitted.submitted !== 1 ? "s" : ""}` : "",
    },
    {
      icon: "🌶️",
      label: "Hottest Take",
      val: hottestTake ? `${hottestTake.emoji} ${hottestTake.name}` : "—",
      sub: hottestTake
        ? `${hottestTake.value}★ on "${trunc(hottestTake.songTitle, 14)}"`
        : "not enough votes",
    },
    {
      icon: "🎵",
      label: "Songs Played",
      val: `${played.length}`,
      sub: `${party.participants.length} participant${party.participants.length !== 1 ? "s" : ""}`,
    },
    {
      icon: "⭐",
      label: "Party Average",
      val: overallAvg != null ? `${overallAvg.toFixed(2)} ★` : "—",
      sub: "",
    },
  ];

  statItems.forEach((stat, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = 32 + col * (CARD_W + GAP);
    const y = statsY + row * (CARD_H + GAP);

    roundRect(ctx, x, y, CARD_W, CARD_H, 10);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fill();
    roundRect(ctx, x, y, CARD_W, CARD_H, 10);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "15px serif";
    ctx.textAlign = "left";
    ctx.fillText(stat.icon, x + 12, y + 26);

    ctx.fillStyle = "#475569";
    ctx.font = "600 9px -apple-system, system-ui, sans-serif";
    ctx.fillText(stat.label.toUpperCase(), x + 36, y + 22);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "700 14px -apple-system, system-ui, sans-serif";
    ctx.fillText(trunc(stat.val, 20), x + 36, y + 42);

    if (stat.sub) {
      ctx.fillStyle = "#64748b";
      ctx.font = "400 11px -apple-system, system-ui, sans-serif";
      ctx.fillText(trunc(stat.sub, 28), x + 36, y + 60);
    }
  });

  // ── Footer ───────────────────────────────────────────────────────
  const footerY = statsY + Math.ceil(statItems.length / COLS) * (CARD_H + GAP) + 20;

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, footerY - 8);
  ctx.lineTo(W - 32, footerY - 8);
  ctx.stroke();

  if (host) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#475569";
    ctx.font = "400 12px -apple-system, system-ui, sans-serif";
    ctx.fillText(`hosted by ${host.emoji} ${host.name}`, W / 2, footerY + 10);
  }

  const footerGrad = ctx.createLinearGradient(W / 2 - 60, 0, W / 2 + 60, 0);
  footerGrad.addColorStop(0, "rgba(168,85,247,0.55)");
  footerGrad.addColorStop(1, "rgba(236,72,153,0.55)");
  ctx.fillStyle = footerGrad;
  ctx.font = "700 11px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("NERO · the listening party", W / 2, footerY + 30);

  return canvas.toDataURL("image/png");
}
