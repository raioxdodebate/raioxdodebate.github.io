// Share generators: PNG cards and a story-format video, all drawn on canvas from the debate data.
import { buildGraph, settle, draw, COLORS } from "./graph.js";

const FONT = "Archivo, sans-serif";
const VLABEL = { verdadeiro: "FATO", distorcido: "DISTORCIDO", falso: "FAKE", divergente: "AGÊNCIAS DIVERGEM", nao_verificado: "NÃO VERIFICADO" };
const TOPIC_LABEL = { economia: "Economia", seguranca: "Segurança", corrupcao: "Corrupção", politica_externa: "Política externa", costumes: "Família e costumes", saude: "Saúde", outro: "Outros" };

export const SITE = "https://raioxdodebate.github.io/";
export function siteUrl() { return SITE; }
export const shortUrl = () => siteUrl().replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---------- primitives ----------
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrap(ctx, text, x, y, maxW, lh, maxLines = 99) {
  const words = String(text).split(" "); let line = "", lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (lines === maxLines - 1) { while (ctx.measureText(line + "…").width > maxW) line = line.slice(0, -1); ctx.fillText(line + "…", x, y); return y + lh; }
      ctx.fillText(line, x, y); y += lh; lines++; line = words[i];
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}
function bgGrid(ctx, W, H) {
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W * 0.5, H * 0.35, 40, W * 0.5, H * 0.35, W * 0.9);
  grad.addColorStop(0, "rgba(139,124,255,0.14)"); grad.addColorStop(1, "rgba(9,12,20,0)");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
}
function brand(ctx, x, y, size = 34) {
  ctx.fillStyle = "#a4adc2"; ctx.font = `600 ${size}px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText("Raio-X do Debate", x, y);
}
function pill(ctx, x, y, text, color, size = 30) {
  ctx.font = `800 ${size}px ${FONT}`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const w = ctx.measureText(text).width + size * 1.6, h = size * 1.7;
  ctx.fillStyle = color; rr(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = "#090c14"; ctx.fillText(text, x + size * 0.8, y + h / 2 + 1);
  return w;
}
function footerUrl(ctx, W, H, pad) {
  ctx.fillStyle = "#2ee59d"; ctx.font = `800 34px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(shortUrl(), pad, H - pad);
}
function miniGraph(ctx, debate, x, y, w, h, { progress = 1, labels = false, alpha = 1, hover = null, zoom = 2.2 } = {}) {
  const g = buildGraph(debate, { width: w, height: h }); settle(g, 300);
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha;
  draw(ctx, g, { progress, labels, dpr: 1, glow: true, hover, zoom, clear: false, topicLabel: (t) => TOPIC_LABEL[t] || t });
  ctx.restore();
  return g;
}

// ---------- cards ----------
export function drawResultCard(canvas, { score, total, title, marks, debate }) {
  const W = canvas.width = 1080, H = canvas.height = 1080; const ctx = canvas.getContext("2d"); const pad = 72;
  bgGrid(ctx, W, H);
  miniGraph(ctx, debate, 0, 0, W, H, { alpha: 0.28 });
  const gap = 14, w = (W - pad * 2 - gap * (marks.length - 1)) / marks.length;
  marks.forEach((hit, k) => { ctx.fillStyle = hit ? COLORS.verdadeiro : COLORS.falso; rr(ctx, pad + k * (w + gap), pad, w, 22, 8); ctx.fill(); });
  brand(ctx, pad, 130);
  ctx.fillStyle = "#fff"; ctx.font = `900 360px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.fillText(String(score), pad - 16, 200);
  const nw = ctx.measureText(String(score)).width;
  ctx.fillStyle = "#a4adc2"; ctx.font = `600 100px ${FONT}`; ctx.fillText(`de ${total}`, pad + nw + 6, 430);
  ctx.fillStyle = "#fff"; ctx.font = `800 84px ${FONT}`; wrap(ctx, title, pad, 610, W - pad * 2, 92);
  ctx.fillStyle = "#c9ccd6"; ctx.font = `500 42px ${FONT}`;
  wrap(ctx, `Acertei ${score} de ${total} falas checadas do ${debate.title}. Você consegue?`, pad, 820, W - pad * 2, 54);
  footerUrl(ctx, W, H, pad);
}

export function drawClaimCard(canvas, { claim, debate }) {
  const W = canvas.width = 1080, H = canvas.height = 1350; const ctx = canvas.getContext("2d"); const pad = 80;
  bgGrid(ctx, W, H);
  miniGraph(ctx, debate, 0, H * 0.5, W, H * 0.5 - 60, { alpha: 0.16, hover: claim.id });
  brand(ctx, pad, pad);
  const color = COLORS[claim.verdict];
  ctx.fillStyle = "#a4adc2"; ctx.font = `600 40px ${FONT}`; ctx.textBaseline = "top";
  ctx.fillText(`${debate.candidates[claim.candidate].name} no ${debate.title}, em resumo:`, pad, 190);
  ctx.fillStyle = "#fff"; ctx.font = `700 76px ${FONT}`;
  let y = wrap(ctx, claim.claim, pad, 260, W - pad * 2, 86, 6);
  y += 30;
  pill(ctx, pad, y, VLABEL[claim.verdict], color, 40);
  y += 40 * 1.7 + 40;
  ctx.fillStyle = "#dfe3ee"; ctx.font = `500 42px ${FONT}`; ctx.textBaseline = "top";
  y = wrap(ctx, claim.why, pad, y, W - pad * 2, 56, 6);
  y += 30;
  ctx.fillStyle = "#a4adc2"; ctx.font = `600 34px ${FONT}`;
  const srcText = "Fonte: " + claim.sources.map((s) => `${debate.agencies[s.agency].name} (${s.label})`).join(" · ");
  wrap(ctx, srcText, pad, y, W - pad * 2, 44, 3);
  footerUrl(ctx, W, H, pad);
}

export function drawRaioxCard(canvas, { debate }) {
  const W = canvas.width = 1080, H = canvas.height = 1350; const ctx = canvas.getContext("2d"); const pad = 72;
  bgGrid(ctx, W, H);
  brand(ctx, pad, pad);
  ctx.fillStyle = "#fff"; ctx.font = `900 92px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
  let y = wrap(ctx, `Raio-X do ${debate.title}`, pad, pad + 56, W - pad * 2, 96);
  ctx.fillStyle = "#a4adc2"; ctx.font = `500 36px ${FONT}`;
  ctx.fillText(`${debate.claims.length} falas checadas · ${Object.keys(debate.agencies).length} agências`, pad, y + 6);
  miniGraph(ctx, debate, pad, y + 60, W - pad * 2, 880 - y, { labels: true });
  drawScoreboard(ctx, debate, pad, 950, W - pad * 2, 1, 52);
  footerUrl(ctx, W, H, pad);
}

// Tale of the tape (1080x1350): candidate vs candidate, stats in the middle
export async function drawTapeCard(canvas, { debate }) {
  const W = canvas.width = 1080, H = canvas.height = 1350; const ctx = canvas.getContext("2d"); const pad = 64;
  const [a, b] = Object.keys(debate.candidates); const ca = debate.candidates[a], cb = debate.candidates[b];
  const stats = (cid) => { const cl = debate.claims.filter((c) => c.candidate === cid); const t = {}; for (const c of cl) t[c.verdict] = (t[c.verdict] || 0) + 1; const prob = (t.distorcido || 0) + (t.falso || 0); return { checked: cl.length, fato: t.verdadeiro || 0, dist: t.distorcido || 0, fake: t.falso || 0, pct: cl.length ? Math.round(100 * prob / cl.length) : 0 }; };
  const A = stats(a), B = stats(b);
  const [pa, pb] = await Promise.all([loadPhoto(ca.photo), loadPhoto(cb.photo)]);
  // split background
  ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.56, 0); ctx.lineTo(W * 0.44, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip();
  ctx.fillStyle = hexA(ca.color, 0.28); ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.moveTo(W * 0.56, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * 0.44, H); ctx.closePath(); ctx.clip();
  ctx.fillStyle = hexA(cb.color, 0.28); ctx.fillRect(0, 0, W, H); ctx.restore();
  // photos in the top band
  const band = 560;
  const drawP = (img, x0, x1, color) => {
    if (!img) return;
    const bw = x1 - x0, s = Math.max(bw / img.width, band / img.height); const w = img.width * s, h = img.height * s;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, bw, band); ctx.clip(); ctx.filter = "grayscale(1) contrast(1.15)"; ctx.globalAlpha = 0.85;
    ctx.drawImage(img, x0 + (bw - w) / 2, 0, w, h); ctx.filter = "none"; ctx.globalAlpha = 1;
    ctx.fillStyle = hexA(color, 0.35); ctx.fillRect(x0, 0, bw, band);
    const fade = ctx.createLinearGradient(0, band - 260, 0, band); fade.addColorStop(0, "rgba(9,12,20,0)"); fade.addColorStop(1, COLORS.bg); ctx.fillStyle = fade; ctx.fillRect(x0, 0, bw, band);
    ctx.restore();
  };
  drawP(pa, 0, W / 2, ca.color); drawP(pb, W / 2, W, cb.color);
  ctx.fillStyle = "rgba(9,12,20,.55)"; rr(ctx, pad - 14, pad - 10, 300, 52, 10); ctx.fill(); rr(ctx, W - pad - 236, pad - 10, 250, 52, 10); ctx.fill();
  brand(ctx, pad, pad, 32);
  ctx.fillStyle = "#e6e9f2"; ctx.font = `700 26px ${FONT}`; ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillText("FICHA TÉCNICA", W - pad, pad + 2);
  // corner tags + names
  const tag = (x, align, text, color) => { ctx.font = `800 22px ${FONT}`; ctx.textAlign = align; const tw = ctx.measureText(text).width + 28; const tx = align === "left" ? x : x - tw; ctx.fillStyle = hexA(color, 0.9); rr(ctx, tx, 400, tw, 40, 6); ctx.fill(); ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text, align === "left" ? x + 14 : x - 14, 421); };
  tag(pad, "left", ca.party, ca.color); tag(W - pad, "right", cb.party, cb.color);
  ctx.fillStyle = "#fff"; ctx.font = `900 92px ${FONT}`; ctx.textBaseline = "top";
  ctx.textAlign = "left"; ctx.fillText(ca.name.toUpperCase(), pad - 4, 450);
  ctx.textAlign = "right"; ctx.fillText(cb.name.toUpperCase(), W - pad + 4, 450);
  ctx.textAlign = "center"; ctx.fillStyle = "#6b748c"; ctx.font = `900 60px ${FONT}`; ctx.fillText("VS", W / 2, 468);
  // big pct
  ctx.font = `900 150px ${FONT}`; ctx.textBaseline = "top";
  ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.fillText(`${A.pct}%`, pad - 6, 560);
  ctx.textAlign = "right"; ctx.fillText(`${B.pct}%`, W - pad + 6, 560);
  ctx.fillStyle = "#c9ccd6"; ctx.font = `700 22px ${FONT}`; ctx.textAlign = "center"; ctx.fillText("FALAS CHECADAS", W / 2, 720); ctx.fillText("COM PROBLEMA", W / 2, 746);
  // rows
  const rows = [["FALAS CHECADAS", A.checked, B.checked, "#a4adc2"], ["FATO", A.fato, B.fato, COLORS.verdadeiro], ["DISTORCIDO", A.dist, B.dist, COLORS.distorcido], ["FAKE", A.fake, B.fake, COLORS.falso]];
  let y = 780;
  for (const [label, va, vb, color] of rows) {
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad, y - 18); ctx.lineTo(W - pad, y - 18); ctx.stroke();
    ctx.fillStyle = color; ctx.font = `800 28px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(label, W / 2, y + 18);
    ctx.fillStyle = "#fff"; ctx.font = `900 72px ${FONT}`;
    ctx.textAlign = "left"; ctx.fillText(String(va), pad, y); ctx.textAlign = "right"; ctx.fillText(String(vb), W - pad, y);
    y += 112;
  }
  ctx.fillStyle = "#b9c1d6"; ctx.font = `500 26px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(`${debate.title} · vereditos de 6 agências · só o que elas checaram`, pad, H - pad - 44);
  footerUrl(ctx, W, H, pad);
}

// ---------- link previews (1200x630, used as og:image) ----------
async function ogBase(ctx, W, H) {
  bgGrid(ctx, W, H);
  const g = ctx.createLinearGradient(0, H - 8, W, H); g.addColorStop(0, COLORS.verdadeiro); g.addColorStop(0.5, COLORS.distorcido); g.addColorStop(1, COLORS.falso);
  ctx.fillStyle = g; ctx.fillRect(0, H - 10, W, 10);
}
function ogPills(ctx, x, y, size = 26) {
  let px = x;
  for (const [label, color] of [["FATO", COLORS.verdadeiro], ["DISTORCIDO", COLORS.distorcido], ["FAKE", COLORS.falso]]) px += pill(ctx, px, y, label, color, size) + 14;
}
async function ogLogos(ctx, debate, x, y, h = 40) {
  const ags = Object.entries(debate.agencies);
  const imgs = await Promise.all(ags.map(([k, a]) => (k === "aosfatos" ? null : loadPhoto(a.logo))));
  let px = x;
  for (let i = 0; i < ags.length; i++) {
    const im = imgs[i];
    if (!im) { // logos that do not read at this size become a text chip
      ctx.font = `800 20px ${FONT}`; const w = ctx.measureText(ags[i][1].name).width + 24;
      ctx.fillStyle = "#ffffff"; rr(ctx, px, y, w, h, 9); ctx.fill();
      ctx.fillStyle = "#090c14"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(ags[i][1].name, px + 12, y + h / 2 + 1);
      px += w + 10; continue;
    }
    const w = Math.min(130, (im.width / im.height) * (h - 12)) + 16;
    ctx.fillStyle = "#ffffff"; rr(ctx, px, y, w, h, 9); ctx.fill();
    const iw = w - 16, ih = Math.min(h - 12, iw * im.height / im.width);
    ctx.drawImage(im, px + 8, y + (h - ih) / 2, iw, ih);
    px += w + 10;
  }
}
export async function drawOgCard(canvas, { debate }) {
  const W = canvas.width = 1200, H = canvas.height = 630; const ctx = canvas.getContext("2d"); const pad = 64;
  await ogBase(ctx, W, H);
  miniGraph(ctx, debate, 640, 40, 540, 520, { alpha: 0.95, zoom: 1.6, labels: false });
  brand(ctx, pad, 52, 30);
  ctx.fillStyle = "#fff"; ctx.font = `900 92px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.fillText("Fato, distorcido", pad - 4, 104); ctx.fillText("ou fake?", pad - 4, 200);
  ctx.fillStyle = "#dfe3ee"; ctx.font = `600 31px ${FONT}`;
  wrap(ctx, `O debate presidencial checado por ${Object.keys(debate.agencies).length} agências, com o corte do vídeo oficial de cada fala.`, pad, 316, 560, 40, 3);
  await ogLogos(ctx, debate, pad, 452, 42);
  ctx.fillStyle = "#2ee59d"; ctx.font = `800 34px ${FONT}`; ctx.textBaseline = "alphabetic"; ctx.fillText(shortUrl(), pad, H - 44);
}
export async function drawQuizOg(canvas, { debate }) {
  const W = canvas.width = 1200, H = canvas.height = 630; const ctx = canvas.getContext("2d"); const pad = 64;
  await ogBase(ctx, W, H);
  brand(ctx, pad, 52, 30);
  ctx.fillStyle = "#fff"; ctx.font = `900 120px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText("Você acerta?", pad - 6, 100);
  ctx.fillStyle = "#dfe3ee"; ctx.font = `600 34px ${FONT}`;
  ctx.fillText("10 falas reais do debate presidencial. Três botões.", pad, 250);
  ctx.fillText(`Veredito de ${Object.keys(debate.agencies).length} agências de checagem.`, pad, 296);
  const keys = [["✓  FATO", COLORS.verdadeiro], ["~  DISTORCIDO", COLORS.distorcido], ["✕  FAKE", COLORS.falso]];
  const kw = (W - pad * 2 - 40) / 3;
  keys.forEach(([label, color], i) => {
    const x = pad + i * (kw + 20), y = 380;
    ctx.fillStyle = color; rr(ctx, x, y + 10, kw, 110, 22); ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = color; rr(ctx, x, y, kw, 110, 22); ctx.fill();
    ctx.fillStyle = "#090c14"; ctx.font = `900 40px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + kw / 2, y + 57);
  });
  ctx.textAlign = "left"; ctx.fillStyle = "#2ee59d"; ctx.font = `800 34px ${FONT}`; ctx.textBaseline = "alphabetic"; ctx.fillText(shortUrl(), pad, H - 44);
}
export async function drawClaimOg(canvas, { debate, claim }) {
  const W = canvas.width = 1200, H = canvas.height = 630; const ctx = canvas.getContext("2d"); const pad = 60;
  const cand = debate.candidates[claim.candidate]; const color = cand.color || "#ffffff"; const vcolor = COLORS[claim.verdict];
  await ogBase(ctx, W, H);
  const photo = await loadPhoto(cand.photo);
  if (photo) { // photo on the right, duotone in party colour, fading into the background
    const pw = 380, ph = H - 10, s = Math.max(pw / photo.width, ph / photo.height);
    ctx.save(); ctx.beginPath(); ctx.rect(W - pw, 0, pw, ph); ctx.clip();
    ctx.filter = "grayscale(1) contrast(1.1)"; ctx.globalAlpha = 0.9; ctx.drawImage(photo, W - pw + (pw - photo.width * s) / 2, 0, photo.width * s, photo.height * s);
    ctx.filter = "none"; ctx.globalAlpha = 1; ctx.fillStyle = hexA(color, 0.45); ctx.fillRect(W - pw, 0, pw, ph);
    const fade = ctx.createLinearGradient(W - pw, 0, W - pw + 200, 0); fade.addColorStop(0, COLORS.bg); fade.addColorStop(1, "rgba(9,12,20,0)"); ctx.fillStyle = fade; ctx.fillRect(W - pw, 0, 200, ph);
    ctx.restore();
  }
  ctx.font = `900 30px ${FONT}`; const nw = ctx.measureText(cand.name.toUpperCase()).width + 40;
  ctx.fillStyle = color; rr(ctx, pad, 46, nw, 50, 10); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(cand.name.toUpperCase(), pad + 20, 72);
  ctx.fillStyle = "#b9c1d6"; ctx.font = `600 26px ${FONT}`; ctx.fillText(`${cand.party} · ${debate.title}, em resumo:`, pad + nw + 16, 72);
  ctx.fillStyle = "#fff"; ctx.font = `800 50px ${FONT}`; ctx.textBaseline = "top";
  let y = wrap(ctx, claim.claim, pad, 128, 760, 60, 4);
  y = Math.max(y + 18, 330);
  const label = VLABEL[claim.verdict];
  ctx.font = `900 40px ${FONT}`; const lw = ctx.measureText(label).width + 56;
  ctx.fillStyle = vcolor; rr(ctx, pad, y, lw, 70, 14); ctx.fill();
  ctx.fillStyle = "#090c14"; ctx.textBaseline = "middle"; ctx.fillText(label, pad + 28, y + 37);
  ctx.fillStyle = "#dfe3ee"; ctx.font = `600 26px ${FONT}`; ctx.textBaseline = "top";
  const agencies = claim.sources.map((s) => debate.agencies[s.agency].name).join(", ");
  wrap(ctx, `Segundo ${agencies}.`, pad, y + 90, 760, 34, 2);
  ctx.fillStyle = "#2ee59d"; ctx.font = `800 32px ${FONT}`; ctx.textBaseline = "alphabetic"; ctx.fillText(shortUrl(), pad, H - 40);
}

export function drawScoreboard(ctx, debate, x, y, w, t = 1, barH = 56) {
  const order = ["verdadeiro", "distorcido", "falso", "divergente"];
  const cands = Object.keys(debate.candidates);
  cands.forEach((cid, i) => {
    const cl = debate.claims.filter((c) => c.candidate === cid);
    const tally = {}; for (const c of cl) tally[c.verdict] = (tally[c.verdict] || 0) + 1;
    const yy = y + i * (barH + 70);
    ctx.fillStyle = "#fff"; ctx.font = `800 40px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillText(debate.candidates[cid].name, x, yy);
    ctx.fillStyle = "#a4adc2"; ctx.font = `500 30px ${FONT}`; ctx.textAlign = "right";
    ctx.fillText(`${cl.length} falas checadas`, x + w, yy + 8);
    ctx.textAlign = "left";
    let bx = x; const total = cl.length || 1;
    ctx.fillStyle = "#1a2236"; rr(ctx, x, yy + 54, w, barH, 12); ctx.fill();
    ctx.save(); rr(ctx, x, yy + 54, w, barH, 12); ctx.clip();
    for (const v of order) {
      const n = tally[v] || 0; if (!n) continue;
      const bw = (n / total) * w * t;
      ctx.fillStyle = COLORS[v]; ctx.fillRect(bx, yy + 54, bw, barH);
      if (bw > 44) { ctx.fillStyle = "#090c14"; ctx.font = `800 30px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(Math.round(n * t)), bx + bw / 2, yy + 54 + barH / 2 + 1); }
      bx += bw;
    }
    ctx.restore();
  });
  // legend
  const ly = y + cands.length * (barH + 70) - 4; let lx = x;
  for (const v of order) { ctx.fillStyle = COLORS[v]; rr(ctx, lx, ly + 6, 18, 18, 5); ctx.fill(); ctx.fillStyle = "#a4adc2"; ctx.font = `600 26px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "top"; const lab = VLABEL[v]; ctx.fillText(lab, lx + 28, ly); lx += ctx.measureText(lab).width + 70; }
}

// ---------- video (story 1080x1920) ----------
export function pickVideoMime() {
  const c = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

export async function recordRaioxVideo(debate, { duration = 8000, fps = 30, onProgress } = {}) {
  const W = 1080, H = 1920; const pad = 80;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const g = buildGraph(debate, { width: W - pad * 2, height: 960 }); settle(g, 320);
  const mime = pickVideoMime(); if (!mime) throw new Error("Este navegador não grava vídeo do canvas.");
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => (rec.onstop = () => res(new Blob(chunks, { type: mime.split(";")[0] }))));
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  function frame(t) { // t in ms
    bgGrid(ctx, W, H);
    brand(ctx, pad, pad, 40);
    // phase 1: network forms (0 - 3.2s)
    const p1 = Math.min(1, t / 3200);
    ctx.fillStyle = "#fff"; ctx.font = `900 96px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
    wrap(ctx, `Raio-X do ${debate.title}`, pad, pad + 64, W - pad * 2, 100);
    ctx.fillStyle = "#a4adc2"; ctx.font = `500 38px ${FONT}`;
    const shown = Math.floor(ease(p1) * debate.claims.length);
    ctx.fillText(`${shown} falas checadas por ${Object.keys(debate.agencies).length} agências`, pad, pad + 280);
    ctx.save(); ctx.translate(pad, 420); draw(ctx, g, { progress: ease(p1), labels: t > 2600, dpr: 1, zoom: 2.1, clear: false, topicLabel: (x) => TOPIC_LABEL[x] || x }); ctx.restore();
    // phase 2: scoreboard grows (3.4s - 5.6s)
    if (t > 3400) { const p2 = ease(Math.min(1, (t - 3400) / 2200)); drawScoreboard(ctx, debate, pad, 1440, W - pad * 2, p2, 60); }
    // phase 3: CTA (6s+)
    if (t > 6000) {
      const p3 = ease(Math.min(1, (t - 6000) / 600));
      ctx.globalAlpha = p3; ctx.fillStyle = "#fff"; ctx.font = `800 52px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText("Você reconhece uma fake? Jogue o quiz.", pad, H - pad - 56); ctx.globalAlpha = 1;
    }
    footerUrl(ctx, W, H, pad);
  }

  rec.start(200);
  const t0 = performance.now();
  await new Promise((res) => {
    function loop(now) { const t = now - t0; frame(Math.min(t, duration)); onProgress && onProgress(Math.min(1, t / duration)); if (t < duration) requestAnimationFrame(loop); else res(); }
    requestAnimationFrame(loop);
  });
  rec.stop();
  const blob = await done;
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
  return { blob, ext };
}

// ---------- claim clip (vertical 1080x1920, our own render: text, verdict, source, link to the moment) ----------
const photoCache = new Map();
function loadPhoto(src) {
  if (!src) return Promise.resolve(null);
  if (photoCache.has(src)) return photoCache.get(src);
  const p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  photoCache.set(src, p); return p;
}
function mmss(t) { t = Math.max(0, Math.round(t || 0)); const m = Math.floor(t / 60), s = t % 60; return `${m}:${String(s).padStart(2, "0")}`; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

export async function recordClaimClip(debate, claim, { duration = 9000, fps = 30, onProgress } = {}) {
  const W = 1080, H = 1920, pad = 84;
  const cand = debate.candidates[claim.candidate]; const color = cand.color || "#ffffff"; const vcolor = COLORS[claim.verdict];
  const photo = await loadPhoto(cand.photo);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; const ctx = canvas.getContext("2d");
  const mime = pickVideoMime(); if (!mime) throw new Error("Este navegador não grava vídeo do canvas.");
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => (rec.onstop = () => res(new Blob(chunks, { type: mime.split(";")[0] }))));
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const text = claim.claim;
  const ytId = debate.video && debate.video.youtubeId; const hasT = claim.t != null && ytId;
  const link = hasT ? `youtu.be/${ytId}?t=${Math.max(0, claim.t - 3)}` : shortUrl();

  function frame(t) {
    // background: dark + party colour wash sweeping in
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);
    const sweep = ease(Math.min(1, t / 700));
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, hexA(color, 0.55 * sweep)); grad.addColorStop(0.55, hexA(color, 0.08 * sweep)); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    // photo (top area), duotone-ish
    if (photo) {
      const ph = 760, scale = Math.max(W / photo.width, ph / photo.height); const pw = photo.width * scale, phh = photo.height * scale;
      ctx.save(); ctx.globalAlpha = 0.9 * sweep; ctx.filter = "grayscale(1) contrast(1.1)";
      ctx.drawImage(photo, (W - pw) / 2, 0, pw, phh); ctx.restore();
      const fade = ctx.createLinearGradient(0, 300, 0, ph + 40); fade.addColorStop(0, "rgba(9,12,20,0)"); fade.addColorStop(1, COLORS.bg);
      ctx.fillStyle = hexA(color, 0.35 * sweep); ctx.fillRect(0, 0, W, ph); ctx.fillStyle = fade; ctx.fillRect(0, 0, W, ph + 40);
    }
    brand(ctx, pad, pad, 36);
    // name + party
    ctx.fillStyle = "#fff"; ctx.font = `900 112px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.globalAlpha = sweep; ctx.fillText(cand.name.toUpperCase(), pad, photo ? 560 : 200);
    ctx.fillStyle = "#dfe3ee"; ctx.font = `600 40px ${FONT}`; ctx.fillText(`${cand.party} · no ${debate.title}, em resumo:`, pad, photo ? 690 : 330); ctx.globalAlpha = 1;
    // claim types in
    const p2 = Math.min(1, Math.max(0, (t - 900) / 2600));
    const shown = text.slice(0, Math.floor(text.length * p2));
    ctx.fillStyle = "#fff"; ctx.font = `700 70px ${FONT}`;
    let y = wrap(ctx, shown, pad, photo ? 800 : 440, W - pad * 2, 82, 7);
    // verdict stamp
    if (t > 3900) {
      const p3 = ease(Math.min(1, (t - 3900) / 350)); const s = 1.6 - 0.6 * p3;
      const label = VLABEL[claim.verdict]; ctx.font = `900 64px ${FONT}`; const tw = ctx.measureText(label).width + 90, th = 110;
      const cx = pad + tw / 2, cy = Math.max(y + 60, 1250) + th / 2;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.rotate((-3 * Math.PI) / 180); ctx.globalAlpha = p3;
      ctx.fillStyle = vcolor; rr(ctx, -tw / 2, -th / 2, tw, th, 22); ctx.fill();
      ctx.fillStyle = COLORS.bg; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, 0, 4); ctx.restore();
      // why + source
      if (t > 4500) {
        const p4 = ease(Math.min(1, (t - 4500) / 500)); ctx.globalAlpha = p4;
        ctx.fillStyle = "#dfe3ee"; ctx.font = `500 40px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
        let yy = wrap(ctx, claim.why, pad, cy + th / 2 + 40, W - pad * 2, 52, 5);
        ctx.fillStyle = "#a4adc2"; ctx.font = `600 32px ${FONT}`;
        wrap(ctx, "Fonte: " + claim.sources.map((s) => `${debate.agencies[s.agency].name} (${s.label})`).join(" · "), pad, yy + 16, W - pad * 2, 42, 2);
        ctx.globalAlpha = 1;
      }
    }
    // CTA: link to the exact moment
    if (t > 6200) {
      const p5 = ease(Math.min(1, (t - 6200) / 500)); ctx.globalAlpha = p5;
      ctx.fillStyle = "#fff"; ctx.font = `800 44px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText("Todas as falas checadas do debate:", pad, H - pad - 150);
      ctx.fillStyle = "#2ee59d"; ctx.font = `800 56px ${FONT}`; ctx.fillText(shortUrl(), pad, H - pad - 80);
      ctx.fillStyle = "#8d96ad"; ctx.font = `500 28px ${FONT}`; ctx.fillText(hasT ? `Momento no vídeo: ${link}` : "", pad, H - pad - 16);
      ctx.globalAlpha = 1;
    }
  }

  rec.start(200);
  const t0 = performance.now();
  await new Promise((res) => { function loop(now) { const t = now - t0; frame(Math.min(t, duration)); onProgress && onProgress(Math.min(1, t / duration)); if (t < duration) requestAnimationFrame(loop); else res(); } requestAnimationFrame(loop); });
  rec.stop();
  const blob = await done;
  return { blob, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
}

// ---------- delivery ----------
export async function deliver(blob, filename, text, statusEl) {
  const file = new File([blob], filename, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return "shared"; }
  } catch (e) { if (e && e.name === "AbortError") return "aborted"; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  try { await navigator.clipboard.writeText(text); if (statusEl) statusEl.textContent = "Arquivo salvo e texto copiado. Cole no grupo."; }
  catch (_) { if (statusEl) statusEl.textContent = "Arquivo salvo. Link: " + siteUrl(); }
  return "downloaded";
}
export function toBlob(canvas, type = "image/png") { return new Promise((res) => canvas.toBlob(res, type)); }
