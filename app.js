// Raio-X do Debate — app (no framework, hash routing)
import { mount as mountGraph, COLORS } from "./graph.js";
import { initAnalytics, track, pageview } from "./analytics.js";
import { drawResultCard, drawClaimCard, drawRaioxCard, drawTapeCard, recordRaioxVideo, recordClaimClip, deliver, toBlob, siteUrl, pickVideoMime } from "./share.js";

const VERDICT = {
  verdadeiro: { label: "Fato", key: "fato" },
  distorcido: { label: "Distorcido", key: "distorcido" },
  falso: { label: "Fake", key: "fake" },
  divergente: { label: "Agências divergem", key: null },
  nao_verificado: { label: "Não verificado", key: null },
};
const ORDER = ["verdadeiro", "distorcido", "falso", "divergente"];
const TOPIC = {
  economia: "Economia", seguranca: "Segurança", corrupcao: "Corrupção",
  politica_externa: "Política externa", costumes: "Família e costumes", saude: "Saúde", outro: "Outros",
};
const QUIZ_SIZE = 10;
const LENSES = [
  ["ficha", "Ficha"], ["malha", "Malha"], ["placar", "Placar"], ["temas", "Temas"], ["fluxo", "Fluxo"], ["agencias", "Agências"], ["lista", "Todas as falas"],
];

const state = {
  debate: null,
  quiz: null,
  lens: "malha",
  filters: { candidate: "all", verdict: "all", topic: "all" },
};
let liveGraph = null;
window.__rx = { state, graph: () => liveGraph };

const $app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const claimById = (id) => state.debate.claims.find((c) => c.id === id);
const cands = () => Object.keys(state.debate.candidates);
const topicsUsed = () => Object.keys(TOPIC).filter((tp) => state.debate.claims.some((c) => c.topic === tp));
function tally(claims) { const t = {}; for (const c of claims) t[c.verdict] = (t[c.verdict] || 0) + 1; return t; }

// ---------- data ----------
async function loadData() {
  const idx = await (await fetch("data/index.json")).json();
  const entry = idx.debates.find((d) => d.id === idx.default) || idx.debates[0];
  state.debate = await (await fetch("data/" + entry.file)).json();
  try { state.config = await (await fetch("data/config.json")).json(); } catch (_) { state.config = {}; }
  initAnalytics(state.config);
}

// ---------- seeded random ----------
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function todaySeed() { const d = new Date(); return `${state.debate.id}|${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

function pickQuiz(seedStr) {
  const rnd = mulberry32(hashStr(seedStr));
  const pool = state.debate.claims.filter((c) => c.quiz && VERDICT[c.verdict].key);
  const per = Math.floor(QUIZ_SIZE / cands().length);
  let picked = [];
  for (const cid of cands()) {
    const mine = shuffle(pool.filter((c) => c.candidate === cid), rnd);
    const chosen = [];
    for (const v of ["verdadeiro", "distorcido", "falso"]) { const hit = mine.find((c) => c.verdict === v && !chosen.includes(c)); if (hit) chosen.push(hit); }
    for (const c of mine) { if (chosen.length >= per) break; if (!chosen.includes(c)) chosen.push(c); }
    picked = picked.concat(chosen.slice(0, per));
  }
  while (picked.length < QUIZ_SIZE) { const rest = shuffle(pool.filter((c) => !picked.includes(c)), rnd); if (!rest.length) break; picked.push(rest[0]); }
  return shuffle(picked, rnd).map((c) => c.id);
}
function startQuiz(seedStr) { state.quiz = { seed: seedStr, ids: pickQuiz(seedStr), i: 0, answers: {} }; track("quiz_start", { seed: seedStr.split("|")[1] }); }

// ---------- router ----------
const routes = { "/": renderHome, "/quiz": renderQuiz, "/resultado": renderResult, "/raiox": renderRaiox, "/metodologia": renderMethod };
function route() {
  if (liveGraph) { liveGraph.destroy(); liveGraph = null; }
  const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  const fn = routes[path] || renderHome;
  document.querySelectorAll(".nav a").forEach((a) => {
    const target = a.getAttribute("href").replace(/^#/, "");
    const current = target === path || (target === "/quiz" && path === "/resultado");
    if (current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  $app.innerHTML = fn();
  afterRender(path);
  pageview(path, path === "/raiox" ? { lens: state.lens } : {});
}

// ---------- shared bits ----------
function cand(cid) { return state.debate.candidates[cid]; }
function chip(cid) { const c = cand(cid); return `<span class="chip party" style="--c:${c.color}">${esc(c.name)}</span>`; }
function mmss(t) { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(s).padStart(2, "0"); }
function ytUrl(claim) { const v = state.debate.video; if (!v || claim.t == null) return null; return `https://www.youtube.com/watch?v=${v.youtubeId}&t=${Math.max(0, claim.t - 3)}s`; }
function videoActions(claim, { clip = true } = {}) {
  const url = ytUrl(claim); const v = state.debate.video;
  const blogo = v && v.broadcaster_logo ? `<img src="${esc(v.broadcaster_logo)}" alt="Band">` : "";
  return `<div class="actions">
    ${url ? `<button class="ytbtn" data-act="watch" data-id="${claim.id}">${blogo}Ver no debate · ${mmss(claim.t)}</button>` : `<span class="ytbtn ghost" title="Ainda sem o minuto exato">${blogo}Minuto em breve</span>`}
    ${claim.clip ? `<button class="iconbtn" data-act="realclip" data-id="${claim.id}">Baixar corte do vídeo</button>` : (clip ? `<button class="iconbtn" data-act="clip" data-id="${claim.id}">Gerar corte</button>` : "")}
    <button class="iconbtn" data-act="claimcard" data-id="${claim.id}">Card</button>
  </div>`;
}
async function realClip(btn, id) {
  track("clip", { what: "real", claim: id });
  const claim = claimById(id);
  try {
    const r = await fetch(claim.clip); if (!r.ok) throw new Error(String(r.status));
    const blob = await r.blob();
    showMedia({ blob, kind: "video", filename: `corte-${id}.mp4`, text: `${cand(claim.candidate).name} no ${state.debate.title}, em resumo: ${claim.claim} — ${VERDICT[claim.verdict].label}, segundo ${claim.sources.map((s) => state.debate.agencies[s.agency].name).join(" e ")}. Imagens: Band. ${siteUrl()}` });
  } catch (_) {
    // clip not hosted here (preview host): fall back to the rendered clip
    makeClip(btn, id);
  }
}
function sources(claim) {
  return `<div class="sources">${claim.sources.map((s) => { const ag = state.debate.agencies[s.agency]; return `<a class="src" href="${esc(s.url || ag.url)}" target="_blank" rel="noopener">${ag.logo ? `<img src="${esc(ag.logo)}" alt="">` : ""}<b>${esc(ag.name)}</b><span>${esc(s.label)}</span></a>`; }).join("")}</div>`;
}
function verdictPill(v) { return `<span class="verdict ${v}">${esc(VERDICT[v].label)}</span>`; }
function legend() { return `<div class="legend">${ORDER.map((v) => `<span><i class="${v}"></i>${esc(VERDICT[v].label)}</span>`).join("")}</div>`; }
function peekHtml(claim) {
  if (!claim) return `<div class="who">Toque em um ponto da malha</div><div class="q empty">Cada ponto é uma fala checada. A cor é o veredito, a linha liga ao candidato e ao tema.</div>`;
  return `<div class="who">${chip(claim.candidate)} <span>${esc(TOPIC[claim.topic])}</span> ${verdictPill(claim.verdict)}</div><div class="q">${esc(claim.claim)}</div>`;
}
function dateBR(d) { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long" }); }

// ---------- home ----------
function tile(cid) {
  const c = cand(cid); const cl = state.debate.claims.filter((x) => x.candidate === cid); const t = tally(cl);
  const prob = (t.distorcido || 0) + (t.falso || 0); const pct = cl.length ? Math.round(100 * prob / cl.length) : 0;
  const seg = ORDER.map((v) => t[v] ? `<i class="${v}" style="flex:${t[v]}"></i>` : "").join("");
  return `<a class="tile" href="#/raiox" style="--c:${c.color}" data-cand="${cid}" aria-label="${esc(c.name)}: ${pct}% das falas checadas com problema">
    ${c.photo ? `<div class="photo" style="background-image:url('${esc(c.photo)}')"></div><div class="tint"></div>` : `<div class="initials">${esc(c.name[0])}</div>`}
    ${c.party_logo ? `<span class="plogo" style="background-image:url('${esc(c.party_logo)}')" title="${esc(c.party)}"></span>` : ""}
    <div class="meta">
      <div class="pct-big">${pct}<small>%</small></div>
      <span class="what">das falas checadas com problema</span>
      <div class="bar mini">${seg}</div>
      <b>${esc(c.name)}</b><span>${esc(c.party)} · ${cl.length} falas checadas</span>
    </div>
  </a>`;
}
function tapeStats(cid) {
  const cl = state.debate.claims.filter((x) => x.candidate === cid); const t = tally(cl);
  const prob = (t.distorcido || 0) + (t.falso || 0);
  return { checked: cl.length, fato: t.verdadeiro || 0, distorcido: t.distorcido || 0, fake: t.falso || 0, pct: cl.length ? Math.round(100 * prob / cl.length) : 0 };
}
function tapeHtml() {
  const [a, b] = cands(); const A = tapeStats(a), B = tapeStats(b); const ca = cand(a), cb = cand(b);
  const rows = [
    ["Falas checadas", A.checked, B.checked, null],
    ["Fato", A.fato, B.fato, "verdadeiro"],
    ["Distorcido", A.distorcido, B.distorcido, "distorcido"],
    ["Fake", A.fake, B.fake, "falso"],
    ["Com problema", A.pct + "%", B.pct + "%", null],
  ];
  return `<div class="tape" style="--ca:${ca.color};--cb:${cb.color}">
    <div class="tape-head"><span class="corner red">${ca.party_logo ? `<img src="${esc(ca.party_logo)}" alt="">` : ""}${esc(ca.party)}</span><span class="corner blue">${esc(cb.party)}${cb.party_logo ? `<img src="${esc(cb.party_logo)}" alt="">` : ""}</span></div>
    <div class="tape-names"><b>${esc(ca.name)}</b><span>Ficha técnica</span><b>${esc(cb.name)}</b></div>
    ${rows.map(([label, va, vb, v]) => `<div class="tape-row ${v || ""}"><b>${va}</b><span>${esc(label)}</span><b>${vb}</b></div>`).join("")}
    <div class="tape-foot">Vereditos de Lupa e Aos Fatos · ${state.debate.claims.length} falas</div>
  </div>`;
}
function dailyHook() {
  const d = state.debate; const day = Math.floor(Date.now() / 86400000);
  const cid = cands()[day % cands().length];
  const pool = d.claims.filter((c) => c.candidate === cid && c.clip && VERDICT[c.verdict].key);
  const rnd = mulberry32(hashStr(d.id + "|hook|" + day));
  return pool.length ? pool[Math.floor(rnd() * pool.length)] : d.claims[0];
}
function renderHome() {
  const d = state.debate; const ids = cands();
  const hook = dailyHook();
  return `
  <section class="hero">
    <div class="hero-copy">
      <div class="kicker">${esc(d.title)} · ${esc(dateBR(d.date))} · ${d.claims.length} falas checadas por ${Object.keys(d.agencies).length} agências</div>
      <h1 class="display">Quem passou no teste da verdade?</h1>
      <p class="lede">Cada fala do debate que as agências de checagem verificaram, com veredito, fonte e o corte do vídeo oficial no momento exato.</p>
    </div>
    <div class="hero-vs"><div class="vs">${tile(ids[0])}<div class="x">VS</div>${tile(ids[1])}</div></div>
    <div class="hero-tape">${tapeHtml()}<div class="export"><button class="btn sm ghost" data-act="tapecard">Gerar ficha pra compartilhar</button></div></div>
    <div class="hero-cta">
      <a class="btn big accent" href="#/quiz">Você acerta? Jogar o quiz</a>
      <a class="btn big ghost" href="#/raiox">Explorar o raio-X</a>
      <p class="small muted">Conta só o que as agências escolheram verificar. Toque num candidato pra ver fala por fala.</p>
    </div>
    <article class="item ${hook.verdict} teaser-item hero-teaser">
      <div class="top-line"><span>${chip(hook.candidate)} <span class="muted">disse, em resumo:</span></span><span class="vt ${hook.verdict}">${esc(VERDICT[hook.verdict].label)}</span></div>
      <p class="q">${esc(hook.claim)}</p>
      <p class="w">${esc(hook.why)}</p>
      ${sources(hook)}
      ${videoActions(hook)}
    </article>
    <div class="facts hero-facts">
      <div class="fact"><b>${d.claims.length}</b><span>falas checadas</span></div>
      <div class="fact"><b>${Object.keys(d.agencies).length}</b><span>agências como fonte</span></div>
      <div class="fact"><b>${d.claims.filter((c) => c.clip).length}</b><span>cortes do vídeo oficial</span></div>
    </div>
  </section>`;
}
function lensFicha() { return `<div class="panel">${tapeHtml()}<div class="export"><button class="btn sm" data-act="tapecard">Gerar ficha pra compartilhar</button></div></div>`; }

// ---------- quiz ----------
function renderQuiz() {
  if (!state.quiz) startQuiz(todaySeed());
  const q = state.quiz;
  if (q.i >= q.ids.length) { location.hash = "#/resultado"; return ""; }
  const claim = claimById(q.ids[q.i]); const ans = q.answers[claim.id]; const revealed = !!ans;
  const progress = q.ids.map((id, k) => { const a = q.answers[id]; const cls = a ? (a.hit ? "hit" : "miss") : (k === q.i ? "now" : ""); return `<i class="${cls}"></i>`; }).join("");
  const streak = currentStreak();
  return `
  <section class="quiz">
    <div class="progress" aria-label="Progresso">${progress}</div>
    <div class="qmeta"><span>Fala ${q.i + 1} de ${q.ids.length}</span><span>${streak >= 2 ? `${streak} seguidas` : ""}</span></div>
    <article class="card ${revealed ? "revealed v-" + claim.verdict : ""}">
      <div class="who">${chip(claim.candidate)} <span>disse, em resumo:</span></div>
      <p class="claim">${esc(claim.claim)}</p>
      ${revealed ? `
        <div class="outcome ${ans.hit ? "hit" : "miss"}">${ans.hit ? "Acertou." : `Errou. Você marcou ${esc(VERDICT[ans.picked].label)}.`}</div>
        ${verdictPill(claim.verdict)}
        <p class="why">${esc(claim.why)}</p>
        ${sources(claim)}
        ${videoActions(claim)}
      ` : ""}
    </article>
    ${revealed ? `<div class="next"><button class="btn big" data-act="next">${q.i + 1 === q.ids.length ? "Ver meu resultado" : "Próxima fala"}</button></div>` : `
      <div class="keypad" role="group" aria-label="Sua resposta">
        <button class="key fato" data-act="answer" data-v="verdadeiro"><span class="glyph" aria-hidden="true">✓</span>FATO<small>é verdade</small></button>
        <button class="key distorcido" data-act="answer" data-v="distorcido"><span class="glyph" aria-hidden="true">~</span>DISTORCIDO<small>meia verdade</small></button>
        <button class="key fake" data-act="answer" data-v="falso"><span class="glyph" aria-hidden="true">✕</span>FAKE<small>é falso</small></button>
      </div>`}
  </section>`;
}
function currentStreak() { const q = state.quiz; let s = 0; for (let k = q.i - 1; k >= 0; k--) { const a = q.answers[q.ids[k]]; if (a && a.hit) s++; else break; } if (q.answers[q.ids[q.i]]?.hit) s++; return s; }
function answer(v) { const q = state.quiz; const id = q.ids[q.i]; if (q.answers[id]) return; const hit = claimById(id).verdict === v; q.answers[id] = { picked: v, hit }; track("quiz_answer", { claim: id, picked: v, hit, n: q.i + 1 }); route(); }
function next() { state.quiz.i++; if (state.quiz.i >= state.quiz.ids.length) { saveResult(); location.hash = "#/resultado"; } else { route(); window.scrollTo({ top: 0 }); } }

// ---------- result ----------
function score() { const q = state.quiz; return q.ids.reduce((n, id) => n + (q.answers[id]?.hit ? 1 : 0), 0); }
function title(n, total) {
  const r = n / total;
  if (r >= 0.9) return ["Checador profissional", "Pode mandar o resultado pro grupo sem medo."];
  if (r >= 0.7) return ["Detector de fake", "Poucas passam por você. Veja quais escaparam."];
  if (r >= 0.4) return ["Olho meio treinado", "Metade do caminho. O raio-X mostra o resto."];
  return ["Caiu em quase tudo", "Normal: as falas são feitas pra convencer. Veja a resposta de cada uma."];
}
function saveResult() { track("quiz_finish", { score: score(), total: state.quiz.ids.length }); try { localStorage.setItem("raiox:last", JSON.stringify({ seed: state.quiz.seed, score: score(), total: state.quiz.ids.length, at: Date.now() })); } catch (_) {} }
function renderResult() {
  if (!state.quiz || state.quiz.i < state.quiz.ids.length) { location.hash = "#/quiz"; return ""; }
  const n = score(); const total = state.quiz.ids.length; const [t, sub] = title(n, total);
  const review = state.quiz.ids.map((id) => { const c = claimById(id); const a = state.quiz.answers[id]; return `<div class="review-item"><div class="mark ${a.hit ? "hit" : "miss"}">${a.hit ? "✓" : "✕"}</div><div><div class="t">${esc(state.debate.candidates[c.candidate].name)}, em resumo: ${esc(c.claim)}</div><div class="m">${esc(VERDICT[c.verdict].label)}${a.hit ? "" : ` · você marcou ${esc(VERDICT[a.picked].label)}`}</div></div><button class="iconbtn" data-act="claimcard" data-id="${c.id}">Card</button></div>`; }).join("");
  return `
  <section class="result">
    <div class="score-card"><div class="n">${n}<small> de ${total}</small></div><div class="title">${esc(t)}</div><div class="sub">${esc(sub)}</div></div>
    <canvas id="share-canvas" class="share-preview" width="1080" height="1080" aria-label="Imagem para compartilhar"></canvas>
    <div class="row"><button class="btn big accent" data-act="share">Compartilhar resultado</button></div>
    <div class="row"><a class="btn ghost" href="#/raiox">Explorar o raio-X</a><button class="btn ghost" data-act="again">Jogar outras 10</button></div>
    <div id="share-status" class="status" role="status"></div>
    <h2 class="h2">Suas respostas</h2>
    <div class="review">${review}</div>
  </section>`;
}

// ---------- raio-x portal ----------
function renderRaiox() {
  const d = state.debate;
  const tabs = LENSES.map(([k, label]) => `<button class="lens" role="tab" aria-selected="${state.lens === k}" data-act="lens" data-lens="${k}">${esc(label)}</button>`).join("");
  const body = { ficha: lensFicha, malha: lensMalha, placar: lensPlacar, temas: lensTemas, fluxo: lensFluxo, agencias: lensAgencias, lista: lensLista }[state.lens]();
  return `
  <section class="rx">
    <div class="section-head"><h1 class="h2">Raio-X do ${esc(d.title)}</h1><p class="muted small">${esc(d.subtitle)} · ${esc(d.broadcaster)} · ${d.claims.length} falas checadas. Escolha uma lente.</p></div>
    <div class="lenses" role="tablist">${tabs}</div>
    ${body}
    <div class="panel">
      <div class="panel-head"><h2 class="h3">Levar os dados pro grupo</h2><p>Imagem e vídeo gerados aqui, no seu navegador, direto dos dados.</p></div>
      <div class="export">
        <button class="btn sm" data-act="raioxcard">Gerar imagem do raio-X</button>
        <button class="btn sm ghost" data-act="video" ${pickVideoMime() ? "" : "disabled title='Navegador sem gravação de vídeo'"}>Gerar vídeo (story, 8s)</button>
      </div>
      <div id="export-status" class="status" role="status"></div>
    </div>
  </section>`;
}

function lensMalha() {
  const f = state.graphFilter || {};
  const vlegend = ORDER.map((v) => `<button class="legend-btn ${v}" data-act="gverdict" data-v="${v}" aria-pressed="${f.verdict === v}"><i class="${v}"></i>${esc(VERDICT[v].label)}</button>`).join("");
  return `<div class="panel malha">
    <div class="panel-head"><p>Cada ponto é uma fala. Toque num ponto pra abrir, num candidato pra filtrar, num tema pra isolar.</p>
      <button class="iconbtn" data-act="gclear" ${(f.candidate || f.topic || f.verdict) ? "" : "hidden"}>Limpar filtros</button></div>
    <div class="malha-grid">
      <div class="graph-wrap"><canvas id="rx-canvas" aria-label="Malha das falas; toque nos pontos"></canvas></div>
      <div class="peek sticky" id="rx-peek">${peekHtml(null)}</div>
    </div>
    <div class="legend legend-filters">${vlegend}</div>
    <div class="export"><button class="btn sm ghost" data-act="graphpng">Baixar a malha como imagem</button></div>
  </div>`;
}
function selectedHtml(claim) {
  if (!claim) return peekHtml(null);
  return `<article class="item ${claim.verdict} in-peek">
    <div class="top-line"><span>${chip(claim.candidate)} <span class="muted">${esc(TOPIC[claim.topic])}</span></span><span class="vt ${claim.verdict}">${esc(VERDICT[claim.verdict].label)}</span></div>
    <p class="q">${esc(claim.claim)}</p>
    <p class="w">${esc(claim.why)}</p>
    ${sources(claim)}
    ${videoActions(claim)}
  </article>`;
}

function lensPlacar() {
  const d = state.debate;
  const rows = cands().map((cid) => {
    const cl = d.claims.filter((c) => c.candidate === cid); const t = tally(cl);
    const seg = ORDER.map((v) => t[v] ? `<i class="${v}" style="flex:${t[v]}" title="${esc(VERDICT[v].label)}: ${t[v]}">${t[v]}</i>` : "").join("");
    const prob = (t.distorcido || 0) + (t.falso || 0); const pct = cl.length ? Math.round(100 * prob / cl.length) : 0;
    return `<div class="cand-row" style="--c:${d.candidates[cid].color}"><div class="name"><b>${esc(d.candidates[cid].name)}</b><span>${cl.length} falas checadas</span></div><div class="bar">${seg}</div>
      <div class="pct"><div class="k"><b>${pct}%</b><span>das falas checadas com problema (distorcido ou fake)</span></div><div class="k"><b>${t.falso || 0}</b><span>classificadas como fake</span></div></div></div>`;
  }).join("");
  return `<div class="panel two">${rows}${legend()}<p class="small muted">Conta só as falas que alguma agência escolheu checar. Não é uma amostra de tudo que foi dito.</p></div>`;
}

function lensTemas() {
  const d = state.debate;
  const head = `<div></div>${cands().map((c) => `<div class="hd">${esc(d.candidates[c].name)}</div>`).join("")}`;
  const rows = topicsUsed().map((tp) => {
    const cells = cands().map((cid) => {
      const cl = d.claims.filter((c) => c.topic === tp && c.candidate === cid); const t = tally(cl);
      const prob = (t.distorcido || 0) + (t.falso || 0);
      const dots = ORDER.flatMap((v) => Array(t[v] || 0).fill(`<i class="${v}"></i>`)).join("");
      return `<button class="cell ${cl.length ? "" : "empty"}" data-act="gofilter" data-topic="${tp}" data-cand="${cid}" title="Ver falas"><div class="n">${cl.length}<small>${cl.length ? `${prob} c/ problema` : "sem checagem"}</small></div><div class="dots">${dots}</div></button>`;
    }).join("");
    return `<div class="rl">${esc(TOPIC[tp])}</div>${cells}`;
  }).join("");
  return `<div class="panel"><div class="panel-head"><p>Quantas falas de cada tema foram checadas, e quantas tinham problema. Toque numa célula para ver as falas.</p></div><div class="heat">${head}${rows}</div>${legend()}</div>`;
}

function lensFluxo() {
  const d = state.debate; const narrow = window.innerWidth < 600; const W = narrow ? 360 : 640, H = narrow ? 600 : 460, colW = 12, padY = narrow ? 12 : 10, fs = narrow ? 13 : 13;
  const left = cands().map((cid) => ({ id: cid, label: d.candidates[cid].name, n: d.claims.filter((c) => c.candidate === cid).length }));
  const mid = ORDER.map((v) => ({ id: v, label: VERDICT[v].label, n: d.claims.filter((c) => c.verdict === v).length })).filter((x) => x.n);
  const right = topicsUsed().map((tp) => ({ id: tp, label: TOPIC[tp], n: d.claims.filter((c) => c.topic === tp).length }));
  const layout = (col, x) => { const total = col.reduce((s, x) => s + x.n, 0); const avail = H - padY * (col.length - 1) - 20; let y = 10; for (const n of col) { n.h = (n.n / total) * avail; n.y = y; n.x = x; n.cur = 0; n.cur2 = 0; y += n.h + padY; } };
  layout(left, 20); layout(mid, W / 2 - colW / 2); layout(right, W - 20 - colW);
  const byId = (col) => Object.fromEntries(col.map((n) => [n.id, n]));
  const L = byId(left), M = byId(mid), R = byId(right);
  const scale = (H - padY * (mid.length - 1) - 20) / d.claims.length;
  const ribbons = [];
  const ribbon = (a, b, n, color, aKey, bKey) => { const h = n * scale; const y0 = a.y + a[aKey], y1 = b.y + b[bKey]; a[aKey] += h; b[bKey] += h; const x0 = a.x + colW, x1 = b.x, cx = (x0 + x1) / 2; return `<path d="M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} L${x1},${y1 + h} C${cx},${y1 + h} ${cx},${y0 + h} ${x0},${y0 + h} Z" fill="${color}" opacity=".45"/>`; };
  for (const c of cands()) for (const v of ORDER) { const n = d.claims.filter((x) => x.candidate === c && x.verdict === v).length; if (n) ribbons.push(ribbon(L[c], M[v], n, COLORS[v], "cur", "cur")); }
  for (const v of ORDER) for (const tp of topicsUsed()) { const n = d.claims.filter((x) => x.verdict === v && x.topic === tp).length; if (n) ribbons.push(ribbon(M[v], R[tp], n, COLORS[v], "cur2", "cur")); }
  const node = (n, color, anchor, tx) => `<rect x="${n.x}" y="${n.y}" width="${colW}" height="${Math.max(2, n.h)}" rx="4" fill="${color}"/><text x="${tx}" y="${n.y + n.h / 2 + 4}" font-size="${fs}" text-anchor="${anchor}">${esc(n.label)} <tspan fill="#a4adc2" font-weight="500">${n.n}</tspan></text>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fluxo candidato, veredito, tema">${ribbons.join("")}
    ${left.map((n) => node(n, "#eef1f8", "start", n.x + colW + 6)).join("")}
    ${mid.map((n) => node(n, COLORS[n.id], "middle", n.x + colW / 2).replace("<text ", '<text dy="-12" ')).join("")}
    ${right.map((n) => node(n, "#a4adc2", "end", n.x - 6)).join("")}
  </svg>`;
  return `<div class="panel flow"><div class="panel-head"><p>De quem saiu, no que deu, sobre o quê. A largura de cada fita é o número de falas.</p></div>${svg}</div>`;
}

function lensAgencias() {
  const d = state.debate; const ag = d.agency_totals;
  const maxProb = Math.max(1, ...Object.keys(d.agencies).flatMap((a) => cands().map((c) => ag[a]?.[c]?.problematic || 0)));
  const rows = Object.keys(d.agencies).map((a) => {
    const info = d.agencies[a]; const tot = ag[a]; if (!tot) return "";
    const lines = cands().map((cid) => { const p = tot[cid]?.problematic ?? 0; const chk = tot[cid]?.checked; return `<div class="mini"><span class="who">${esc(d.candidates[cid].name)}</span><div class="track"><i style="width:${Math.round(100 * p / maxProb)}%"></i></div><b>${p}${chk ? `<span class="muted">/${chk}</span>` : ""}</b></div>`; }).join("");
    return `<div class="agency"><div class="name"><a href="${esc(info.url)}" target="_blank" rel="noopener">${esc(info.name)}</a><span>falas com problema</span></div>${lines}</div>`;
  }).join("");
  return `<div class="panel"><div class="panel-head"><p>Quatro equipes, quatro critérios, mesma direção. Aos Fatos mostra também o total checado.</p></div><div class="agencies two-col">${rows}</div><p class="small muted">${esc(ag.note)}</p></div>`;
}

function lensLista() {
  const d = state.debate; const f = state.filters;
  const fb = (group, val, label, extra = "") => `<button class="fbtn ${extra}" data-act="filter" data-g="${group}" data-v="${val}" aria-pressed="${f[group] === val}">${esc(label)}</button>`;
  const filters = `
    <div class="filters">${fb("candidate", "all", "Todos")}${cands().map((c) => fb("candidate", c, d.candidates[c].name)).join("")}</div>
    <div class="filters">${fb("verdict", "all", "Qualquer veredito")}${ORDER.map((v) => fb("verdict", v, VERDICT[v].label, "vt " + v)).join("")}</div>
    <div class="filters">${fb("topic", "all", "Todos os temas")}${topicsUsed().map((tp) => fb("topic", tp, TOPIC[tp])).join("")}</div>`;
  const list = d.claims.filter((c) => (f.candidate === "all" || c.candidate === f.candidate) && (f.verdict === "all" || c.verdict === f.verdict) && (f.topic === "all" || c.topic === f.topic));
  const items = list.length ? list.map((c) => `
    <article class="item ${c.verdict}">
      <div class="top-line"><span>${esc(d.candidates[c.candidate].name)} · ${esc(TOPIC[c.topic])}</span><span class="vt ${c.verdict}">${esc(VERDICT[c.verdict].label)}</span></div>
      <p class="q">${esc(c.claim)}</p>
      <p class="w">${esc(c.why)}</p>
      ${sources(c)}
      ${videoActions(c)}
    </article>`).join("") : `<div class="empty">Nenhuma fala com esse filtro.</div>`;
  return `<div class="panel">${filters}<div class="count">${list.length} de ${d.claims.length} falas</div><div class="list">${items}</div></div>`;
}

// ---------- methodology ----------
function renderMethod() {
  const d = state.debate;
  return `
  <section class="prose">
    <h1 class="h2">Como funciona</h1>
    <p>Este site não checa nada por conta própria. Ele organiza, numa tela só, as checagens que agências profissionais publicaram sobre o debate. Nenhum veredito é gerado por inteligência artificial.</p>
    <h2 class="h3">De onde vêm os vereditos</h2>
    <div class="aglogos">${Object.values(d.agencies).map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${a.logo ? `<img src="${esc(a.logo)}" alt="">` : ""}${esc(a.name)}</a>`).join("")}</div>
    <p>Para o placar e para cada fala, usamos as checagens com rótulo publicado da Lupa e do Aos Fatos. Para UOL Confere e Estadão Verifica usamos só os totais divulgados, porque não tivemos acesso à lista fala a fala. Cada card leva ao texto original da agência.</p>
    <h2 class="h3">Como os rótulos foram unificados</h2>
    <p>Cada agência tem a própria escala. Para o jogo caber em três botões, agrupamos assim:</p>
    <div class="maptable">
      <div>${verdictPill("verdadeiro")}<span>Verdadeiro, Acerta, Correto</span></div>
      <div>${verdictPill("distorcido")}<span>Exagerado, Subestimado, Falta contexto, Impreciso, Enganoso, Não é bem assim</span></div>
      <div>${verdictPill("falso")}<span>Falso, Não é correto, Contrariado pelos dados, e Insustentável (afirmação feita como fato sem nenhuma evidência que a sustente)</span></div>
      <div>${verdictPill("divergente")}<span>Quando duas agências chegaram a conclusões opostas sobre a mesma fala. Fica fora do quiz.</span></div>
    </div>
    <p>Quando duas agências checaram a mesma fala e concordaram, ela aparece uma vez, com as duas fontes. Para o Aos Fatos, que publica as checagens como manchetes em tempo real, o rótulo exibido é o da manchete.</p>
    <h2 class="h3">O que isso não é</h2>
    <ul>
      <li>Não é uma amostra de tudo que foi dito. As agências escolhem o que checar, e cada uma escolhe diferente.</li>
      <li>Não é um placar de quem "venceu". É um mapa de quais falas sobreviveram à checagem.</li>
      <li>Os totais das agências não devem ser somados entre si: a mesma fala pode aparecer em várias.</li>
    </ul>
    <h2 class="h3">O quiz</h2>
    <p>São 10 falas por dia, 5 de cada candidato, sorteadas entre as que têm veredito claro. Todo mundo que joga no mesmo dia recebe as mesmas 10, então dá pra comparar resultado. "Jogar outras 10" sorteia um conjunto novo.</p>
    <h2 class="h3">Imagens, cortes e vídeo</h2>
    <p>Tudo que você gera aqui é desenhado no seu navegador a partir dos mesmos dados, com a fonte escrita no próprio arquivo. Nada é enviado a servidor nenhum.</p>
    <p>Os "cortes" não usam imagem da transmissão: são peças próprias com a fala, o veredito, a fonte e o link para o minuto exato no vídeo oficial da Band no YouTube. O botão "Ver no debate" abre esse vídeo no momento da fala, pelo player do próprio YouTube.</p>
    <h2 class="h3">Fotos e marcas</h2>
    <ul>${Object.values(d.candidates).filter((c) => c.photo_credit).map((c) => `<li>${esc(c.full)}: ${esc(c.photo_credit)}</li>`).join("")}
    <li>Logos de partidos, emissora e agências são marcas dos respectivos donos, usadas só para identificar quem é quem. Nenhum deles endossa este site.</li></ul>
    ${d.video ? `<p class="small muted">Vídeo do debate: "${esc(d.video.title || "")}", canal ${esc(d.video.channel)} no YouTube.</p>` : ""}
    <h2 class="h3">Estatísticas de uso</h2>
    <p>Quando ativadas, coletamos estatísticas anônimas de uso (páginas vistas, origem do acesso, dispositivo, país, cliques no quiz, nos cortes e nos compartilhamentos) com a ferramenta PostHog, sem guardar IP nem qualquer dado que identifique você. Isso serve só para saber o que funciona e corrigir o que não funciona. Navegadores com "Não rastrear" ativado ficam de fora.</p>
    <h2 class="h3">Quem fez</h2>
    <p>Projeto independente de <a href="https://www.linkedin.com/in/deniciosantos/" target="_blank" rel="noopener">Denicio Santos</a>. Sem vínculo com candidatos, partidos, emissoras ou agências de checagem.</p>
    <h2 class="h3">Achou um erro?</h2>
    <p>Se um veredito está diferente do que a agência publicou, ou uma fala foi resumida de forma injusta, o problema é nosso, não da agência. Abra o link da fonte, compare e avise pelo <a href="https://www.linkedin.com/in/deniciosantos/" target="_blank" rel="noopener">LinkedIn</a>.</p>
    <p class="small muted">Site independente, sem vínculo com candidatos, partidos, emissoras ou agências de checagem. Dados do ${esc(d.title)} de ${esc(new Date(d.date + "T12:00:00").toLocaleDateString("pt-BR"))}.</p>
  </section>`;
}

// ---------- modal helper ----------
function openModal(el, onClose) {
  const opener = document.activeElement;
  el.setAttribute("aria-modal", "true");
  const close = () => { document.removeEventListener("keydown", onKey); el.remove(); onClose && onClose(); if (opener && opener.focus) opener.focus(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {
      const f = [...el.querySelectorAll("a[href],button:not([disabled]),video,iframe,[tabindex]:not([tabindex='-1'])")];
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(el);
  const first = el.querySelector("[data-m='close']") || el.querySelector("button,a[href]"); first && first.focus();
  return close;
}

// ---------- media modal ----------
async function hasClip(claim) {
  if (!claim.clip) return false;
  try { const r = await fetch(claim.clip, { method: "HEAD" }); return r.ok; } catch (_) { return false; }
}
async function showEmbed(claim) {
  track("watch", { claim: claim.id, t: claim.t });
  const v = state.debate.video; const start = Math.max(0, (claim.t || 0) - 3);
  const real = await hasClip(claim);
  const el = document.createElement("div"); el.className = "modal"; el.setAttribute("role", "dialog");
  const player = real
    ? `<video class="clipv" src="${esc(claim.clip)}" controls playsinline preload="metadata"></video><p class="small muted">Trecho do debate (imagens: Band), com legenda e veredito. Abaixo, o vídeo completo no momento da fala.</p>`
    : `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(v.youtubeId)}?start=${start}&rel=0" title="Debate no YouTube" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  el.innerHTML = `<div class="box">
    ${player}
    <div class="who">${chip(claim.candidate)} <span class="muted small">aos ${mmss(claim.t)} · ${esc(v.channel)}</span></div>
    <p class="q">${esc(claim.claim)}</p>
    <div class="row"><a class="btn sm ghost" href="${esc(ytUrl(claim))}" target="_blank" rel="noopener">Abrir no YouTube</a><button class="btn sm ghost" data-m="copy">Copiar link do minuto</button><button class="btn sm" data-m="close">Fechar</button></div>
    <div class="status" data-m="status"></div></div>`;
  let close;
  el.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m;
    if (m === "close" || e.target === el) { close(); return; }
    if (m === "copy") { try { await navigator.clipboard.writeText(ytUrl(claim)); el.querySelector('[data-m="status"]').textContent = "Link copiado."; } catch (_) {} }
  });
  close = openModal(el);
}
function showMedia({ blob, kind, filename, text }) {
  const url = URL.createObjectURL(blob);
  const el = document.createElement("div"); el.className = "modal"; el.setAttribute("role", "dialog");
  el.innerHTML = `<div class="box">${kind === "video" ? `<video src="${url}" controls autoplay muted playsinline loop></video>` : `<img src="${url}" alt="Pré-visualização">`}
    <div class="row"><button class="btn accent" data-m="share">Compartilhar</button><a class="btn ghost" href="${url}" download="${esc(filename)}">Baixar</a><button class="btn ghost" data-m="close">Fechar</button></div>
    <div class="status" data-m="status"></div></div>`;
  let close;
  el.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m;
    if (m === "close" || e.target === el) { close(); return; }
    if (m === "share") { track("share", { what: kind, file: filename }); await deliver(blob, filename, text, el.querySelector('[data-m="status"]')); }
  });
  close = openModal(el, () => URL.revokeObjectURL(url));
}
async function makeClaimCard(id) {
  track("card", { what: "claim", claim: id });
  const claim = claimById(id); const c = document.createElement("canvas");
  await document.fonts.ready; drawClaimCard(c, { claim, debate: state.debate });
  const blob = await toBlob(c);
  showMedia({ blob, kind: "image", filename: `raio-x-${id}.png`, text: `${state.debate.candidates[claim.candidate].name} disse, em resumo: ${claim.claim} — ${VERDICT[claim.verdict].label}, segundo ${claim.sources.map((s) => state.debate.agencies[s.agency].name).join(" e ")}. ${siteUrl()}` });
}
async function makeTapeCard() {
  track("card", { what: "tape" });
  const c = document.createElement("canvas"); await document.fonts.ready; await drawTapeCard(c, { debate: state.debate });
  const [a, b] = cands(); const A = tapeStats(a), B = tapeStats(b);
  showMedia({ blob: await toBlob(c), kind: "image", filename: "ficha-do-debate.png", text: `Ficha técnica do ${state.debate.title}: ${cand(a).name} ${A.pct}% x ${cand(b).name} ${B.pct}% das falas checadas com problema. ${siteUrl()}` });
}
async function makeRaioxCard() {
  track("card", { what: "raiox" });
  const c = document.createElement("canvas"); await document.fonts.ready; drawRaioxCard(c, { debate: state.debate });
  showMedia({ blob: await toBlob(c), kind: "image", filename: "raio-x-do-debate.png", text: `Raio-X do ${state.debate.title}: ${state.debate.claims.length} falas checadas, numa imagem. ${siteUrl()}` });
}
async function makeClip(btn, id) {
  track("clip", { what: "rendered", claim: id });
  const claim = claimById(id); const old = btn.textContent; btn.disabled = true;
  try {
    await document.fonts.ready;
    const { blob, ext } = await recordClaimClip(state.debate, claim, { onProgress: (p) => { btn.textContent = `Gravando ${Math.round(p * 100)}%`; } });
    showMedia({ blob, kind: "video", filename: `corte-${id}.${ext}`, text: `${cand(claim.candidate).name} disse, em resumo: ${claim.claim} — ${VERDICT[claim.verdict].label}, segundo ${claim.sources.map((s) => state.debate.agencies[s.agency].name).join(" e ")}.${ytUrl(claim) ? " Veja o momento: " + ytUrl(claim) : ""} ${siteUrl()}` });
  } catch (e) { alert("Não deu pra gravar: " + e.message); }
  btn.disabled = false; btn.textContent = old;
}
async function makeVideo(btn) {
  const status = document.getElementById("export-status"); btn.disabled = true;
  try {
    await document.fonts.ready;
    const { blob, ext } = await recordRaioxVideo(state.debate, { onProgress: (p) => { status.textContent = `Gravando… ${Math.round(p * 100)}%`; } });
    status.textContent = ""; showMedia({ blob, kind: "video", filename: `raio-x-do-debate.${ext}`, text: `Raio-X do ${state.debate.title} em 8 segundos. ${siteUrl()}` });
  } catch (e) { status.textContent = "Não deu pra gravar: " + e.message; }
  btn.disabled = false;
}
async function shareResult() {
  track("share", { what: "result", score: score() });
  const canvas = document.getElementById("share-canvas"); const status = document.getElementById("share-status");
  const n = score(), total = state.quiz.ids.length;
  await deliver(await toBlob(canvas), "raio-x-do-debate.png", `Acertei ${n} de ${total} no Raio-X do Debate. Você reconhece uma fake num debate? ${siteUrl()}`, status);
}

// ---------- after render / events ----------
function afterRender(path) {
  const tl = (t) => TOPIC[t] || t;
  if (path === "/raiox" && state.lens === "malha") {
    const c = document.getElementById("rx-canvas"); const peek = document.getElementById("rx-peek");
    if (c) liveGraph = mountGraph(c, state.debate, {
      topicLabel: tl, filter: state.graphFilter || {},
      onHover: (cl) => { if (!state.graphSelected) peek.innerHTML = peekHtml(cl); },
      onSelect: (cl) => { if (cl) track("graph_select", { claim: cl.id }); state.graphSelected = cl ? cl.id : null; peek.innerHTML = selectedHtml(cl); if (cl && window.innerWidth < 900) peek.scrollIntoView({ behavior: "smooth", block: "nearest" }); },
      onFilter: (f) => { state.graphFilter = f; const btn = document.querySelector('[data-act="gclear"]'); if (btn) btn.hidden = !(f.candidate || f.topic || f.verdict); },
    });
    if (state.graphSelected) { liveGraph.select(state.graphSelected); peek.innerHTML = selectedHtml(claimById(state.graphSelected)); }
  }
  if (path === "/resultado") { const c = document.getElementById("share-canvas"); if (c) document.fonts.ready.then(() => drawResultCard(c, { score: score(), total: state.quiz.ids.length, title: title(score(), state.quiz.ids.length)[0], marks: state.quiz.ids.map((id) => state.quiz.answers[id].hit), debate: state.debate })); }
}

$app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]"); if (!btn) return;
  const act = btn.dataset.act;
  if (act === "answer") { btn.classList.add("pressed"); btn.closest(".keypad").querySelectorAll(".key").forEach((k) => (k.disabled = true)); setTimeout(() => answer(btn.dataset.v), 110); }
  else if (act === "next") next();
  else if (act === "again") { startQuiz(`${state.debate.id}|${Date.now()}|${Math.random()}`); location.hash = "#/quiz"; }
  else if (act === "share") shareResult();
  else if (act === "lens") { state.lens = btn.dataset.lens; track("lens", { lens: state.lens }); const y = window.scrollY; route(); window.scrollTo({ top: y }); }
  else if (act === "filter") { state.filters[btn.dataset.g] = btn.dataset.v; track("filter", { group: btn.dataset.g, value: btn.dataset.v }); const y = window.scrollY; route(); window.scrollTo({ top: y }); }
  else if (act === "gofilter") { state.filters = { candidate: btn.dataset.cand, verdict: "all", topic: btn.dataset.topic }; state.lens = "lista"; route(); }
  else if (act === "claimcard") makeClaimCard(btn.dataset.id);
  else if (act === "watch") showEmbed(claimById(btn.dataset.id));
  else if (act === "gverdict") { const f = state.graphFilter || {}; f.verdict = f.verdict === btn.dataset.v ? null : btn.dataset.v; state.graphFilter = f; liveGraph && liveGraph.setFilter(f); document.querySelectorAll('[data-act="gverdict"]').forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === f.verdict)); const cl = document.querySelector('[data-act="gclear"]'); if (cl) cl.hidden = !(f.candidate || f.topic || f.verdict); }
  else if (act === "gclear") { state.graphFilter = {}; state.graphSelected = null; const y = window.scrollY; route(); window.scrollTo({ top: y }); }
  else if (act === "clip") makeClip(btn, btn.dataset.id);
  else if (act === "realclip") realClip(btn, btn.dataset.id);
  else if (act === "raioxcard") makeRaioxCard();
  else if (act === "tapecard") makeTapeCard();
  else if (act === "video") { track("video_summary"); makeVideo(btn); }
  else if (act === "graphpng") { const c = document.getElementById("rx-canvas"); if (c) toBlob(c).then((blob) => showMedia({ blob, kind: "image", filename: "malha-do-debate.png", text: `A malha do ${state.debate.title}: cada ponto é uma fala checada. ${siteUrl()}` })); }
});
document.addEventListener("keydown", (e) => {
  if (!location.hash.startsWith("#/quiz") || !state.quiz) return;
  const map = { "1": "verdadeiro", "2": "distorcido", "3": "falso" };
  if (map[e.key]) { const b = document.querySelector(`.key[data-v="${map[e.key]}"]`); if (b && !b.disabled) b.click(); }
  if (e.key === "Enter") { const n = document.querySelector('[data-act="next"]'); if (n) n.click(); }
});
window.addEventListener("hashchange", () => { route(); window.scrollTo({ top: 0 }); });

loadData().then(route).catch((err) => { $app.innerHTML = `<section class="prose"><h1 class="h2">Não deu pra carregar os dados</h1><p>Abra o site por um servidor (não por file://). Detalhe: ${esc(err.message)}</p></section>`; });
