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


const state = {
  debate: null,
  quiz: null,
  lens: "malha",
  filters: { candidate: "all", verdict: "all", topic: "all" },
};
let liveGraph = null;
window.__rx = { state, graph: () => liveGraph, pickQuiz: (s, t) => pickQuiz(s, t) };

const $app = document.getElementById("app");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const claimById = (id) => state.debate.claims.find((c) => c.id === id);
const cands = () => Object.keys(state.debate.candidates);
const topicsUsed = () => Object.keys(TOPIC).filter((tp) => state.debate.claims.some((c) => c.topic === tp));
function tally(claims) { const t = {}; for (const c of claims) t[c.verdict] = (t[c.verdict] || 0) + 1; return t; }

// ---------- data ----------
async function loadData() {
  const idx = await (await fetch("data/index.json")).json();
  state.index = idx; state.debates = {};
  const all = await Promise.all(idx.debates.map(async (e) => {
    const d = await (await fetch("data/" + e.file)).json();
    d.key = e.key; d.label = e.label || d.broadcaster; d.claims.forEach((c) => (c.debate = d.id)); return d;
  }));
  all.forEach((d) => (state.debates[d.id] = d));
  if (all.length > 1) state.debates.ambos = combineDebates(all);
  state.debate = state.debates[pickDebateId()];
  try { state.config = await (await fetch("data/config.json")).json(); } catch (_) { state.config = {}; }
  initAnalytics(state.config);
}

// ---------- several debates ----------
function combineDebates(list) {
  return {
    id: "ambos", key: "ambos", parts: list.map((d) => d.id),
    title: "Debates " + list.map((d) => "da " + d.label).join(" e "), label: "Os dois",
    short: "Os dois", subtitle: list[0].subtitle, broadcaster: list.map((d) => d.broadcaster).join(" e "),
    date: list[0].date, dateLabel: list.map((d) => dateBR(d.date)).join(" e "),
    candidates: list[0].candidates, agencies: Object.assign({}, ...list.map((d) => d.agencies)),
    claims: list.flatMap((d) => d.claims), video: null,
  };
}
function debateKeys() { return [...state.index.debates.map((e) => e.key), ...(state.debates.ambos ? ["ambos"] : [])]; }
function idForKey(k) { if (k === "ambos" && state.debates.ambos) return "ambos"; const e = state.index.debates.find((x) => x.key === k || x.id === k); return e ? e.id : null; }
function pickDebateId() {
  const fromUrl = new URLSearchParams(location.search).get("d") || new URLSearchParams(location.hash.split("?")[1] || "").get("d");
  let saved = null; try { saved = localStorage.getItem("raiox:debate"); } catch (_) {}
  return idForKey(fromUrl) || idForKey(saved) || state.index.default;
}
function setDebate(id, { silent = false } = {}) {
  if (!state.debates[id] || state.debate.id === id) return;
  state.debate = state.debates[id]; state.quiz = null; state.graphSelected = null;
  try { localStorage.setItem("raiox:debate", state.debate.key); } catch (_) {}
  if (!silent) track("debate", { debate: state.debate.key });
}
function debOf(claim) { return state.debates[claim.debate] || state.debate; }
function vidOf(claim) { return debOf(claim).video; }
function agencyCount() { return Object.keys(state.debate.agencies).length; }
function debateSwitch() {
  const el = document.getElementById("dswitch"); if (!el || !state.debates.ambos) { if (el) el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span class="dlabel">Debate</span>` + debateKeys().map((k) => {
    const d = state.debates[idForKey(k)]; const on = d.id === state.debate.id;
    const label = k === "ambos" ? "Os dois" : `${esc(d.label)} <small>${d.date.slice(8, 10)}/${d.date.slice(5, 7)}</small>`;
    return `<button class="dbtn ${on ? "on" : ""}" data-act="debate" data-d="${k}" aria-pressed="${on}">${label}</button>`;
  }).join("");
}

// ---------- seeded random ----------
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function todaySeed() { const d = new Date(); return `${state.debate.id}|${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

const MINOR_TOPICS = ["outro", "politica_externa", "costumes"];
const QUIZ_THEMES = ["economia", "seguranca", "corrupcao", "saude"];
function quizPool(topic) { return state.debate.claims.filter((c) => c.quiz && VERDICT[c.verdict].key && (!topic || c.topic === topic)); }
function pickQuiz(seedStr, topic = null) {
  const rnd = mulberry32(hashStr(seedStr + "|" + (topic || "")));
  const pool = shuffle(quizPool(topic), rnd);
  const size = Math.min(QUIZ_SIZE, pool.length);
  const perCand = Math.ceil(size / cands().length);
  const quota = { verdadeiro: Math.round(size * 0.3), falso: Math.round(size * 0.3) };
  quota.distorcido = size - quota.verdadeiro - quota.falso; // 3 / 4 / 3 on a 10-question quiz
  const picked = [];
  const count = (k, v) => picked.filter((c) => c[k] === v).length;
  const ok = (c, strict) => !picked.includes(c) && count("candidate", c.candidate) < perCand && (!strict || count("verdict", c.verdict) < quota[c.verdict]);
  if (!topic) { // every daily quiz: one health claim and one from a small topic
    for (const want of [(c) => c.topic === "saude", (c) => MINOR_TOPICS.includes(c.topic)]) {
      const c = pool.find((x) => want(x) && ok(x, true)); if (c) picked.push(c);
    }
  }
  for (const strict of [true, false]) for (const c of pool) { if (picked.length >= size) break; if (ok(c, strict)) picked.push(c); }
  for (const c of pool) { if (picked.length >= size) break; if (!picked.includes(c)) picked.push(c); }
  return shuffle(picked, rnd).map((c) => c.id);
}
function quizTopicFromHash() { const t = new URLSearchParams(location.hash.split("?")[1] || "").get("tema"); return t && QUIZ_THEMES.includes(t) ? t : null; }
function startQuiz(seedStr, topic = null) { state.quiz = { seed: seedStr, topic, ids: pickQuiz(seedStr, topic), i: 0, answers: {} }; track("quiz_start", { seed: seedStr.split("|")[1], topic }); }

// ---------- router ----------
const routes = { "/": renderHome, "/quiz": renderQuiz, "/resultado": renderResult, "/raiox": renderRaiox, "/metodologia": renderMethod };
function route() {
  document.body.classList.remove("drawer-open"); state.fsheetOpen = false;
  const fid = new URLSearchParams(location.hash.split("?")[1] || "").get("f");
  if (fid && !claimById(fid)) { const owner = Object.values(state.debates).find((d) => d.id !== "ambos" && d.claims.some((c) => c.id === fid)); if (owner) setDebate(owner.id, { silent: true }); }
  const dk = new URLSearchParams(location.hash.split("?")[1] || "").get("d"); if (dk && idForKey(dk)) setDebate(idForKey(dk), { silent: true });
  debateSwitch();
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
  quizBar(path);
  pageview(path, path === "/raiox" ? { ...dash() } : {});
}

// ---------- funnel: sticky quiz bar on phones ----------
function quizBar(path) {
  let el = document.getElementById("quizbar");
  const show = path === "/" || path === "/raiox" || path === "/metodologia";
  if (!show) { if (el) el.remove(); document.body.classList.remove("has-quizbar"); return; }
  if (!el) {
    el = document.createElement("a"); el.id = "quizbar"; el.className = "quizbar"; el.href = "#/quiz";
    el.innerHTML = `<span><b>Você acerta?</b> Quiz de 10 falas</span><span class="qb-go">Jogar</span>`;
    el.addEventListener("click", () => track("quiz_cta", { via: "sticky", from: location.hash }));
    document.body.appendChild(el);
  }
  document.body.classList.add("has-quizbar");
}

document.addEventListener("click", (e) => { const a = e.target.closest("[data-quizcta]"); if (a) track("quiz_cta", { via: a.dataset.quizcta, from: location.hash }); });

// ---------- shared bits ----------
function cand(cid) { return state.debate.candidates[cid]; }
function chip(cid) { const c = cand(cid); return `<span class="chip party" style="--c:${c.color}">${esc(c.name)}</span>`; }
function mmss(t) { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(s).padStart(2, "0"); }
// a debate published as several official segments: claim.yt is the segment, claim.yt_t the second inside it
function ytId(claim) { const v = vidOf(claim); return claim.yt || (v && v.youtubeId); }
function ytT(claim) { return claim.yt ? claim.yt_t : claim.t; }
function ytUrl(claim) { const v = vidOf(claim); if (!v || claim.t == null || !ytId(claim)) return null; return `https://www.youtube.com/watch?v=${ytId(claim)}&t=${Math.max(0, ytT(claim) - 3)}s`; }
function claimLink(id) { return siteUrl() + "f/" + id + "/"; }
function waHref(text) { return "https://wa.me/?text=" + encodeURIComponent(text); }
function xHref(text) { return "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text); }
function shareRow(text, link) {
  return `<div class="sharebar"><a class="btn sm wa" href="${esc(waHref(text))}" target="_blank" rel="noopener">WhatsApp</a><a class="btn sm ghost" href="${esc(xHref(text))}" target="_blank" rel="noopener">X</a><button class="btn sm ghost" data-m="copylink">Copiar link</button></div>`;
}
const SITE_TEXT = () => `Fato, distorcido ou fake? Todas as falas checadas dos debates presidenciais, com veredito de ${agencyCount()} agências e o corte do vídeo oficial: ` + siteUrl();
function shareSite(link = siteUrl(), text = SITE_TEXT()) {
  track("share", { what: "site", link });
  const el = document.createElement("div"); el.className = "modal"; el.setAttribute("role", "dialog");
  el.innerHTML = `<div class="box"><h2 class="h3">Compartilhar o Raio-X do Debate</h2><p class="small muted">${esc(link)}</p>
    ${navigator.share ? `<button class="btn accent" data-m="native">Compartilhar</button>` : ""}
    ${shareRow(text, link)}<div class="row"><button class="btn sm ghost" data-m="close">Fechar</button></div><div class="status" data-m="status"></div></div>`;
  let close;
  el.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m;
    if (m === "close" || e.target === el) { close(); return; }
    if (m === "native") { try { await navigator.share({ text, url: link }); } catch (_) {} }
    if (m === "copylink") { try { await navigator.clipboard.writeText(link); el.querySelector('[data-m="status"]').textContent = "Link copiado."; } catch (_) {} }
  });
  close = openModal(el);
}
function videoActions(claim, { clip = true } = {}) {
  const url = ytUrl(claim); const v = vidOf(claim);
  const blogo = v && v.broadcaster_logo ? `<img src="${esc(v.broadcaster_logo)}" alt="${esc(debOf(claim).broadcaster)}">` : "";
  return `<div class="actions">
    ${url ? `<button class="ytbtn" data-act="watch" data-id="${claim.id}">${blogo}Ver no debate · ${mmss(ytT(claim))}</button>` : `<span class="ytbtn ghost" title="Ainda sem o minuto exato">${blogo}Minuto em breve</span>`}
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
    showMedia({ blob, kind: "video", filename: `corte-${id}.mp4`, text: `${cand(claim.candidate).name} no ${debOf(claim).title}, em resumo: ${claim.claim} — ${VERDICT[claim.verdict].label}, segundo ${claim.sources.map((s) => state.debate.agencies[s.agency].name).join(" e ")}. Veja a checagem e o vídeo: ${claimLink(id)}`, link: claimLink(id) });
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
  return `<a class="tile" href="#/raiox?c=${cid}" style="--c:${c.color}" data-cand="${cid}" aria-label="${esc(c.name)}: ${pct}% das falas checadas com problema">
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
    <div class="tape-foot">Vereditos de ${Object.keys(state.debate.agencies).length} agências · ${state.debate.claims.length} falas</div>
  </div>`;
}
function dailyExamples() {
  const d = state.debate; const day = Math.floor(Date.now() / 86400000);
  const verdicts = ["verdadeiro", "distorcido", "falso"];
  const v = verdicts[day % verdicts.length]; // both examples share today's verdict
  return cands().map((cid, k) => {
    const rnd = mulberry32(hashStr(d.id + "|ex|" + day + "|" + cid));
    let pool = d.claims.filter((c) => c.candidate === cid && c.clip && c.verdict === v);
    if (!pool.length) pool = d.claims.filter((c) => c.candidate === cid && c.clip && VERDICT[c.verdict].key);
    return pool[Math.floor(rnd() * pool.length)];
  }).filter(Boolean);
}
function renderHome() {
  const d = state.debate; const ids = cands();
  const examples = dailyExamples();
  return `
  <section class="hero">
    <div class="hero-copy">
      <div class="kicker">${esc(d.title)} · ${esc(d.dateLabel || dateBR(d.date))} · ${d.claims.length} falas checadas por ${Object.keys(d.agencies).length} agências</div>
      <h1 class="display">Fato, distorcido ou fake? O debate checado por ${Object.keys(d.agencies).length} agências.</h1>
      <p class="lede">Cada fala do debate que as agências de checagem verificaram, com veredito, fonte e o corte do vídeo oficial no momento exato.</p>
    </div>
    <div class="hero-vs"><p class="vs-note">O que as agências encontraram nas falas que escolheram checar</p><div class="vs">${tile(ids[0])}<div class="x">VS</div>${tile(ids[1])}</div></div>
    <div class="hero-tape">${tapeHtml()}<div class="export"><button class="btn sm ghost" data-act="tapecard">Gerar ficha pra compartilhar</button></div></div>
    <div class="hero-cta">
      <a class="btn big accent" href="#/quiz">Você acerta? Jogar o quiz</a>
      <a class="btn big ghost" href="#/raiox">Explorar o raio-X</a>
      <div class="themes"><span class="muted small">Quiz por tema:</span>${QUIZ_THEMES.map((t) => `<a class="fbtn" href="#/quiz?tema=${t}">${esc(TOPIC[t])}</a>`).join("")}</div>
      <button class="btn sm wa" data-act="shareSite">Mandar o site no WhatsApp ou copiar o link</button>
      <p class="small muted">Conta só o que as agências escolheram verificar. Toque num candidato pra ver fala por fala.</p>
    </div>
    <section class="hero-teaser examples" aria-labelledby="ex-h">
      <div class="ex-head"><h2 class="h3" id="ex-h">Exemplos do dia: uma fala de cada candidato</h2><a class="btn sm ghost" href="#/raiox">Ver as ${d.claims.length} falas no raio-X</a></div>
      <p class="small muted">Sorteadas todo dia, com o mesmo veredito para os dois.</p>
      <div class="ex-grid">${examples.map((c) => `
        <article class="item ${c.verdict}">
          <div class="top-line"><span>${chip(c.candidate)} <span class="party-tag">${esc(cand(c.candidate).party)}</span></span><span class="vt ${c.verdict}">${esc(VERDICT[c.verdict].label)}</span></div>
          <p class="q">${esc(c.claim)}</p>
          <p class="w">${esc(c.why)}</p>
          ${sources(c)}
          ${videoActions(c)}
        </article>`).join("")}</div>
    </section>
    <div class="facts hero-facts">
      <div class="fact"><b>${d.claims.length}</b><span>falas checadas</span></div>
      <div class="fact"><b>${Object.keys(d.agencies).length}</b><span>agências como fonte</span></div>
      <div class="fact"><b>${d.claims.filter((c) => c.clip).length}</b><span>cortes do vídeo oficial</span></div>
    </div>
  </section>`;
}
function lensFicha_unused() { return `<div class="panel">${tapeHtml()}<div class="export"><button class="btn sm" data-act="tapecard">Gerar ficha pra compartilhar</button></div></div>`; }

// ---------- quiz ----------
function renderQuiz() {
  const topic = quizTopicFromHash();
  if (!state.quiz || state.quiz.topic !== topic) startQuiz(todaySeed(), topic);
  const q = state.quiz;
  if (q.i >= q.ids.length) { location.hash = "#/resultado"; return ""; }
  const claim = claimById(q.ids[q.i]); const ans = q.answers[claim.id]; const revealed = !!ans;
  const progress = q.ids.map((id, k) => { const a = q.answers[id]; const cls = a ? (a.hit ? "hit" : "miss") : (k === q.i ? "now" : ""); return `<i class="${cls}"></i>`; }).join("");
  const streak = currentStreak();
  return `
  <section class="quiz">
    <div class="progress" aria-label="Progresso">${progress}</div>
    <div class="qmeta"><span>${q.topic ? `Quiz de ${esc(TOPIC[q.topic])} · ` : ""}Fala ${q.i + 1} de ${q.ids.length}</span><span>${streak >= 2 ? `${streak} seguidas` : ""}</span></div>
    <article class="card ${revealed ? "revealed v-" + claim.verdict : ""}">
      <div class="who">${chip(claim.candidate)} <span class="party-tag">${esc(cand(claim.candidate).party)}</span></div>
      <p class="claim">${esc(claim.claim)}</p>
      ${revealed ? `
        <div class="compare ${ans.hit ? "hit" : "miss"}">
          <div class="cmp you"><span class="cmp-l">Sua resposta</span>${verdictPill(ans.picked)}</div>
          <div class="cmp them"><span class="cmp-l">As agências</span>${verdictPill(claim.verdict)}</div>
        </div>
        <p class="cmp-msg">${ans.hit ? `${esc(praise(q))} Você e as agências chegaram ao mesmo veredito.` : `As agências classificaram essa fala como <b>${esc(VERDICT[claim.verdict].label)}</b>. Veja por quê:`}</p>
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
function praise(q) {
  const s = currentStreak();
  if (s >= 3) return `${s} seguidas!`;
  return ["Isso!", "Boa!", "Mandou bem!", "Exato!"][q.i % 4];
}
function currentStreak() { const q = state.quiz; let s = 0; for (let k = q.i - 1; k >= 0; k--) { const a = q.answers[q.ids[k]]; if (a && a.hit) s++; else break; } if (q.answers[q.ids[q.i]]?.hit) s++; return s; }
function answer(v) { const q = state.quiz; const id = q.ids[q.i]; if (q.answers[id]) return; const hit = claimById(id).verdict === v; q.answers[id] = { picked: v, hit }; track("quiz_answer", { claim: id, picked: v, hit, n: q.i + 1 }); route(); }
function next() { state.quiz.i++; if (state.quiz.i >= state.quiz.ids.length) { saveResult(); location.hash = "#/resultado"; } else { route(); window.scrollTo({ top: 0 }); } }

// ---------- result ----------
function score() { const q = state.quiz; return q.ids.reduce((n, id) => n + (q.answers[id]?.hit ? 1 : 0), 0); }
function title(n, total) {
  const r = n / total;
  if (r >= 0.9) return ["Olho de checador", "Você e as agências concordaram em quase tudo. Desafie o grupo."];
  if (r >= 0.7) return ["Ótimo faro", "Você reconhece a maior parte das distorções. Veja as que passaram."];
  if (r >= 0.4) return ["Bom começo", "Falas de debate são feitas pra convencer. Veja o que as agências encontraram."];
  return ["Primeira rodada", "Falas de debate são feitas pra convencer. Veja o que as agências encontraram e jogue de novo."];
}
function saveResult() { track("quiz_finish", { score: score(), total: state.quiz.ids.length }); try { localStorage.setItem("raiox:last", JSON.stringify({ seed: state.quiz.seed, score: score(), total: state.quiz.ids.length, at: Date.now() })); } catch (_) {} }
function renderResult() {
  if (!state.quiz || state.quiz.i < state.quiz.ids.length) { location.hash = "#/quiz"; return ""; }
  const n = score(); const total = state.quiz.ids.length; const [t, sub] = title(n, total);
  const review = state.quiz.ids.map((id) => { const c = claimById(id); const a = state.quiz.answers[id]; return `<div class="review-item"><div class="mark ${a.hit ? "hit" : "miss"}">${a.hit ? "✓" : "•"}</div><div><div class="t">${esc(state.debate.candidates[c.candidate].name)}: ${esc(c.claim)}</div><div class="m">Agências: ${esc(VERDICT[c.verdict].label)}${a.hit ? " · você também" : ` · você: ${esc(VERDICT[a.picked].label)}`}</div></div><button class="iconbtn" data-act="claimcard" data-id="${c.id}">Card</button></div>`; }).join("");
  return `
  <section class="result">
    <div class="score-card"><div class="n">${n}<small> de ${total}</small></div><div class="title">${esc(t)}</div><div class="sub">${esc(sub)}</div></div>
    <canvas id="share-canvas" class="share-preview" width="1080" height="1080" aria-label="Imagem para compartilhar"></canvas>
    <div class="row"><button class="btn big accent" data-act="share">Compartilhar resultado</button></div>
    ${shareRow(resultText(), quizLink()).replace('data-m="copylink"', 'data-act="copyres"')}
    <div class="row"><a class="btn ghost" href="#/raiox">Explorar o raio-X</a><button class="btn ghost" data-act="again">Jogar de novo</button></div>
    <div class="themes"><span class="muted small">Jogar por tema:</span>${QUIZ_THEMES.map((t) => `<a class="fbtn" href="#/quiz?tema=${t}">${esc(TOPIC[t])}</a>`).join("")}</div>
    <div id="share-status" class="status" role="status"></div>
    <h2 class="h2">Suas respostas</h2>
    <div class="review">${review}</div>
  </section>`;
}

// ---------- raio-x dashboard (one screen, every visual filters the others) ----------
const LABEL_CLASS = {
  "Verdadeiro": "V", "#FATO": "V", "Acerta": "V",
  "Exagerado": "D", "Subestimado": "D", "Falta contexto": "D", "Impreciso": "D", "Enganoso": "D",
  "Não é bem assim": "D", "#NÃOÉBEMASSIM": "D", "#FATO / #FAKE (parcial)": "D", "Acerta, mas impreciso": "D",
  "Falso": "F", "#FAKE": "F", "Insustentável": "F", "Erra": "F",
};
const DKEYS = ["c", "v", "tp", "ag", "gv"]; // candidate, verdict, topic, agency, government period
const DUR = 6855; // debate upload length, seconds
function dash() { return state.dash || (state.dash = {}); }
function readDashFromHash() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  state.dash = {}; for (const k of DKEYS) if (q.get(k)) state.dash[k] = q.get(k);
  state.graphSelected = q.get("f") || null;
}
function writeDashToHash() {
  const q = new URLSearchParams(); const f = dash();
  for (const k of DKEYS) if (f[k]) q.set(k, f[k]);
  if (state.graphSelected) q.set("f", state.graphSelected);
  const s = q.toString(); history.replaceState(null, "", location.pathname + location.search + "#/raiox" + (s ? "?" + s : ""));
}
function fits(c, f, skip = []) {
  return (skip.includes("c") || !f.c || c.candidate === f.c) && (skip.includes("v") || !f.v || c.verdict === f.v)
    && (skip.includes("tp") || !f.tp || c.topic === f.tp) && (skip.includes("ag") || !f.ag || c.sources.some((s) => s.agency === f.ag))
    && (skip.includes("gv") || !f.gv || (c.eras || []).includes(f.gv));
}
function setBtn(pairs, label, cls = "", active = false) {
  return `<button class="${cls}" data-act="dset" data-set="${esc(pairs)}" aria-pressed="${active}">${label}</button>`;
}
function isActive(pairs) { const f = dash(); return pairs.split(",").every((p) => { const [k, v] = p.split(":"); return f[k] === v; }); }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

function renderRaiox() {
  readDashFromHash();
  const d = state.debate;
  return `
  <section class="rx dash">
    <div class="section-head"><div class="sh-row"><h1 class="h2">Raio-X ${d.parts ? "dos" : "do"} ${esc(d.title)}</h1><a class="btn sm accent" href="#/quiz" data-quizcta="dash">Você acerta? Jogar o quiz</a></div>
      <p class="muted small">${esc(d.subtitle)} · ${d.claims.length} falas checadas por ${Object.keys(d.agencies).length} agências. Toque em qualquer gráfico pra filtrar todos.</p></div>
    <div class="dash-bar" id="dash-bar"></div>
    <div class="dash-grid">
      <div class="panel d-graph"><div class="panel-head"><h2 class="h3">Malha</h2><p>Ponto é fala. Toque num ponto, num candidato ou num tema.</p></div>
        <p class="graph-hint-m">Cor do ponto = veredito. Contorno = candidato: <b style="color:#ff6b72">vermelho, Lula</b>; <b style="color:#7aa2ff">azul, Flávio</b>.</p>
        <div class="graph-wrap"><canvas id="rx-canvas" aria-label="Malha das falas; a lista abaixo traz o mesmo conteúdo"></canvas></div></div>
      <div class="panel d-score" id="d-score"></div>
      <div class="panel d-time" id="d-time"></div>
      <div class="panel d-gov" id="d-gov"></div>
      <div class="panel d-topics" id="d-topics"></div>
      <div class="panel d-agencies" id="d-agencies"></div>
      <div class="panel d-list" id="d-list"></div>
    </div>
    <aside class="drawer" id="d-drawer" aria-label="Fala selecionada" hidden></aside>
    <div class="fsheet-bd" id="fsheet-bd" data-act="fclose" hidden></div>
    <div class="fsheet" id="fsheet" role="dialog" aria-label="Filtros" hidden></div>
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

function dBar() {
  const d = state.debate; const f = dash();
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, label, cls]) => setBtn(`${k}:${v}`, esc(label), "fbtn " + (cls || ""), f[k] === v)).join("")}</div>`;
  const sel = (k, all, opts) => `<label class="dsel"><span class="sr-only">${all}</span><select data-dsel="${k}"><option value="">${all}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${f[k] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const n = d.claims.filter((c) => fits(c, f)).length;
  const any = DKEYS.some((k) => f[k]) || state.graphSelected;
  const nActive = DKEYS.filter((k) => f[k]).length;
  const chips = DKEYS.filter((k) => f[k]).map((k) => `<button class="achip" data-act="dunset" data-k="${k}" aria-label="Tirar filtro ${esc(filterLabel(k, f[k]))}">${esc(filterLabel(k, f[k]))} <span aria-hidden="true">✕</span></button>`).join("");
  const phone = `<div class="bar-m"><button class="btn sm fopen" data-act="fopen">Filtrar${nActive ? ` (${nActive})` : ""}</button><span class="dcount"><b>${n}</b> de ${d.claims.length}</span>${any ? `<button class="iconbtn" data-act="dclear">Limpar</button>` : ""}<button class="iconbtn" data-act="dlink">Compartilhar</button></div>${nActive ? `<div class="achips">${chips}</div>` : ""}`;
  return phone + `<div class="bar-d">
    ${seg("c", cands().map((c) => [c, d.candidates[c].name]))}
    ${seg("v", ORDER.map((v) => [v, VERDICT[v].label, "vt " + v]))}
    ${sel("tp", "Todos os temas", topicsUsed().map((t) => [t, TOPIC[t]]))}
    ${sel("ag", "Todas as agências", Object.entries(d.agencies).map(([k, a]) => [k, a.name]))}
    ${sel("gv", "Todos os governos", GOV.map(([k, n, y]) => [k, `${n} (${y})`]))}
    <span class="dcount"><b>${n}</b> de ${d.claims.length} falas</span>
    ${any ? `<button class="iconbtn" data-act="dclear">Limpar</button><button class="iconbtn" data-act="dlink">Compartilhar esta visão</button>` : ""}</div>`;
}

function filterLabel(k, v) {
  const d = state.debate;
  return k === "c" ? d.candidates[v]?.name : k === "v" ? VERDICT[v]?.label : k === "tp" ? TOPIC[v] : k === "ag" ? d.agencies[v]?.name : k === "gv" ? GOV_NAME[v] : v;
}
function fSheet() {
  const d = state.debate; const f = dash();
  const group = (title, k, opts) => `<div class="fgroup"><h3 class="h3">${title}</h3><div class="chips">${opts.map(([v, l, cls]) => setBtn(`${k}:${v}`, esc(l), "fbtn " + (cls || ""), f[k] === v)).join("")}</div></div>`;
  const n = d.claims.filter((c) => fits(c, f)).length;
  return `<div class="fsheet-head"><h2 class="h3">Filtros</h2><button class="iconbtn" data-act="fclose">Fechar ✕</button></div>
    ${group("Candidato", "c", cands().map((c) => [c, d.candidates[c].name]))}
    ${group("Veredito", "v", ORDER.map((v) => [v, VERDICT[v].label, "vt " + v]))}
    ${group("Tema", "tp", topicsUsed().map((t) => [t, TOPIC[t]]))}
    ${group("Agência", "ag", Object.entries(d.agencies).map(([k, a]) => [k, a.name]))}
    ${group("Governo a que o fato se refere", "gv", GOV.map(([k, nm, y]) => [k, `${nm} (${y})`]))}
    <div class="fsheet-foot"><button class="btn sm ghost" data-act="dclear">Limpar tudo</button><button class="btn accent" data-act="fclose">Ver ${n} falas</button></div>`;
}
function fSheetSync() {
  const el = document.getElementById("fsheet"), bd = document.getElementById("fsheet-bd"); if (!el) return;
  el.hidden = !state.fsheetOpen; if (bd) bd.hidden = !state.fsheetOpen;
  if (state.fsheetOpen) el.innerHTML = fSheet();
}
function dScore() {
  const d = state.debate; const f = dash();
  const rows = cands().map((cid) => {
    const cl = d.claims.filter((c) => c.candidate === cid && fits(c, f, ["c", "v"])); const t = tally(cl);
    const segs = ORDER.map((v) => t[v] ? `<button class="segv ${v} ${isActive(`c:${cid},v:${v}`) ? "on" : ""}" style="flex:${t[v]}" data-act="dset" data-set="c:${cid},v:${v}" title="${esc(d.candidates[cid].name)}: ${t[v]} ${esc(VERDICT[v].label)}">${t[v]}</button>` : "").join("");
    const prob = (t.distorcido || 0) + (t.falso || 0); const pct = cl.length ? Math.round(100 * prob / cl.length) : 0;
    return `<div class="cand-row ${f.c && f.c !== cid ? "dim" : ""}" style="--c:${d.candidates[cid].color}">
      <div class="name">${setBtn(`c:${cid}`, `<b>${esc(d.candidates[cid].name)}</b>`, "linkish", f.c === cid)}<span>${pct}% com problema · ${t.falso || 0} fake · ${cl.length} falas</span></div>
      <div class="bar">${segs || `<i class="none"></i>`}</div></div>`;
  }).join("");
  return `<div class="panel-head"><h2 class="h3">Placar</h2><p>Toque numa faixa.</p></div>${rows}${legend()}`;
}

function tlSvg(deb, claims, f) {
  const d = state.debate; const W = 1000, H = 150, padL = 70, padR = 16; const DUR_ = (deb.video && deb.video.duration_s) || DUR;
  const x = (t) => padL + (W - padL - padR) * (t / DUR_);
  const rowY = Object.fromEntries(cands().map((c, i) => [c, 50 + i * 60]));
  const ticks = []; for (let m = 0; m * 60 <= DUR_; m += 15) ticks.push(`<line x1="${x(m * 60)}" x2="${x(m * 60)}" y1="20" y2="${H - 18}" class="tick"/><text x="${x(m * 60)}" y="${H - 4}" class="tl" text-anchor="middle">${m}min</text>`);
  const lanes = cands().map((c) => `<text x="8" y="${rowY[c] + 5}" class="ln">${esc(d.candidates[c].name)}</text><line x1="${padL}" x2="${W - padR}" y1="${rowY[c]}" y2="${rowY[c]}" class="lane"/>`).join("");
  const dots = claims.filter((c) => c.t != null).sort((a, b) => a.t - b.t).map((c) => {
    const on = fits(c, f); const sel = state.graphSelected === c.id;
    return `<circle cx="${x(c.t).toFixed(1)}" cy="${rowY[c.candidate]}" r="${sel ? 11 : 8}" class="tdot ${c.verdict} ${on ? "" : "off"} ${sel ? "sel" : ""}" data-act="dsel" data-id="${c.id}"><title>${mmss(c.t)} · ${esc(c.claim)}</title></circle>`;
  }).join("");
  return `<div class="tl-wrap"><svg viewBox="0 0 ${W} ${H}" class="tl-svg" role="img" aria-label="Linha do tempo do ${esc(deb.title)}">${ticks.join("")}${lanes}${dots}</svg></div>`;
}
function dTime() {
  const d = state.debate; const f = dash();
  const parts = d.parts ? d.parts.map((id) => state.debates[id]) : [d];
  const body = parts.map((deb) => `${d.parts ? `<h3 class="tl-title">${esc(deb.title)} · ${esc(dateBR(deb.date))}</h3>` : ""}${tlSvg(deb, d.claims.filter((c) => c.debate === deb.id), f)}`).join("");
  const missing = d.claims.filter((c) => c.t == null && fits(c, f)).length;
  return `<div class="panel-head"><h2 class="h3">Minuto a minuto</h2><p>Cada fala no momento em que foi dita. Toque pra abrir.</p></div>
    ${body}
    ${missing ? `<p class="small muted">${missing} fala${missing > 1 ? "s" : ""} do filtro sem minuto localizado.</p>` : ""}`;
}

function dTopics() {
  const d = state.debate; const f = dash();
  const head = `<div></div>${cands().map((c) => `<div class="hd">${esc(d.candidates[c].name)}</div>`).join("")}`;
  const rows = topicsUsed().map((tp) => {
    const cells = cands().map((cid) => {
      const cl = d.claims.filter((c) => c.topic === tp && c.candidate === cid && fits(c, f, ["tp", "c"])); const t = tally(cl);
      const prob = (t.distorcido || 0) + (t.falso || 0);
      const dots = ORDER.flatMap((v) => Array(t[v] || 0).fill(`<i class="${v}"></i>`)).join("");
      const on = isActive(`tp:${tp},c:${cid}`);
      return `<button class="cell ${cl.length ? "" : "empty"} ${on ? "on" : ""}" data-act="dset" data-set="tp:${tp},c:${cid}" aria-pressed="${on}"><div class="n">${cl.length}<small>${cl.length ? `${prob} c/ problema` : "nenhuma"}</small></div><div class="dots">${dots}</div></button>`;
    }).join("");
    return `${setBtn(`tp:${tp}`, esc(TOPIC[tp]), "rl linkish", f.tp === tp)}${cells}`;
  }).join("");
  const quizBtn = f.tp && QUIZ_THEMES.includes(f.tp) ? `<a class="btn sm accent" href="#/quiz?tema=${f.tp}">Jogar o quiz de ${esc(TOPIC[f.tp])}</a>` : "";
  return `<div class="panel-head"><h2 class="h3">Temas</h2><p>Toque num tema ou numa célula.</p></div><div class="heat">${head}${rows}</div>${quizBtn}`;
}

function dAgencies() {
  const d = state.debate; const f = dash();
  const stats = Object.entries(d.agencies).map(([a, info]) => {
    const per = cands().map((cid) => {
      const cl = d.claims.filter((c) => c.candidate === cid && fits(c, f, ["ag", "c"]) && c.sources.some((s) => s.agency === a));
      const prob = cl.filter((c) => { const s = c.sources.find((s) => s.agency === a); return LABEL_CLASS[s.label] !== "V"; }).length;
      return { cid, n: cl.length, prob };
    });
    return { a, info, per };
  });
  const max = Math.max(1, ...stats.flatMap((s) => s.per.map((p) => p.n)));
  const rows = stats.map(({ a, info, per }) => `<div class="agency ${f.ag && f.ag !== a ? "dim" : ""}">
      <div class="name">${setBtn(`ag:${a}`, `${info.logo ? `<img src="${esc(info.logo)}" alt="">` : ""}<b>${esc(info.name)}</b>`, "linkish agbtn", f.ag === a)}<a class="src-link" href="${esc(info.url)}" target="_blank" rel="noopener">checagem original</a></div>
      ${per.map((p) => `<div class="mini"><span class="who">${esc(d.candidates[p.cid].name)}</span><div class="track"><i class="all" style="width:${Math.round(100 * p.n / max)}%"></i><i class="prob" style="width:${Math.round(100 * p.prob / max)}%"></i></div><b>${p.prob}<span class="muted">/${p.n}</span></b></div>`).join("")}
    </div>`).join("");
  return `<div class="panel-head"><h2 class="h3">Agências</h2><p>Falas com problema / falas checadas por cada uma, nesta base. Toque pra ver só as de uma agência.</p></div><div class="agencies two-col">${rows}</div>`;
}

function dList() {
  const d = state.debate; const f = dash();
  const list = d.claims.filter((c) => fits(c, f)).sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9));
  const items = list.length ? list.map((c) => `
    <article class="item ${c.verdict} ${state.graphSelected === c.id ? "sel" : ""}" id="it-${c.id}">
      <div class="top-line"><span>${chip(c.candidate)} <span class="muted">${esc(TOPIC[c.topic])}${c.t != null ? ` · ${mmss(c.t)}` : ""}</span></span><span class="vt ${c.verdict}">${esc(VERDICT[c.verdict].label)}</span></div>
      <p class="q">${esc(c.claim)}</p>
      <p class="w">${esc(c.why)}</p>
      ${sources(c)}
      ${videoActions(c)}
    </article>`).join("") : `<div class="empty">Nenhuma fala com esse filtro. <button class="iconbtn" data-act="dclear">Limpar filtros</button></div>`;
  return `<div class="panel-head"><h2 class="h3">Todas as falas do filtro</h2><p>${list.length} falas, em ordem de quando foram ditas.</p></div><div class="list">${items}</div>`;
}

function dDetail() {
  const c = state.graphSelected && claimById(state.graphSelected);
  if (!c) return "";
  return `<div class="drawer-head"><h2 class="h3">Fala selecionada</h2><button class="iconbtn" data-act="dclose" aria-label="Fechar a fala selecionada">Fechar ✕</button></div>${selectedHtml(c)}`;
}
function drawerSync() {
  const el = document.getElementById("d-drawer"); if (!el) return;
  const open = !!(state.graphSelected && claimById(state.graphSelected));
  el.innerHTML = dDetail(); el.hidden = !open;
  document.body.classList.toggle("drawer-open", open);
}

function dashUpdate({ scroll = false } = {}) {
  const f = dash();
  setHTML("dash-bar", dBar()); setHTML("d-score", dScore()); setHTML("d-time", dTime()); setHTML("d-gov", dGov()); setHTML("d-topics", dTopics());
  setHTML("d-agencies", dAgencies()); setHTML("d-list", dList()); drawerSync(); fSheetSync();
  if (liveGraph) { liveGraph.setFilter({ candidate: f.c || null, verdict: f.v || null, topic: f.tp || null, agency: f.ag || null, era: f.gv || null }); liveGraph.select(state.graphSelected || null); }
  writeDashToHash();
  if (scroll && state.graphSelected) document.querySelector("#d-drawer .drawer-head button")?.focus({ preventScroll: true });
}
function dashSet(pairs) {
  const f = dash(); const kv = pairs.split(",").map((p) => p.split(":"));
  const allOn = kv.every(([k, v]) => f[k] === v);
  for (const [k, v] of kv) { if (allOn) delete f[k]; else f[k] = v; }
  track("dash_filter", { ...f });
  dashUpdate();
}
function dashSelect(id) {
  state.graphSelected = state.graphSelected === id ? null : id;
  if (state.graphSelected) track("dash_select", { claim: id });
  dashUpdate({ scroll: !!state.graphSelected });
}


// ---------- facts by government (historical timeline) ----------
const GOV = [
  ["fhc", "FHC", "1995–2002", 8], ["lula12", "Lula 1 e 2", "2003–2010", 8], ["dilma", "Dilma", "2011–2016", 5.5],
  ["temer", "Temer", "2016–2018", 2.5], ["bolsonaro", "Bolsonaro", "2019–2022", 4], ["lula3", "Lula 3", "2023–2026", 4],
];
const GOV_NAME = Object.fromEntries(GOV.map(([k, n]) => [k, n]));
function dGov() {
  const d = state.debate; const f = dash();
  const ROWS = 3, CELL = 20, W = 1000, top = 46, laneH = ROWS * CELL + 14;
  const lanes = cands();
  const placed = d.claims.filter((c) => (c.eras || []).length);
  const need = GOV.map(([k]) => Math.max(...lanes.map((cid) => Math.ceil(placed.filter((c) => c.candidate === cid && c.eras.includes(k)).length / ROWS))));
  const raw = need.map((cols, i) => Math.max(GOV[i][3] * 10, cols * CELL + 16, 96));
  const padL = 64, scale = (W - padL - 8) / raw.reduce((a, b) => a + b, 0);
  let x0 = padL; const bands = GOV.map(([k, name, years], i) => { const w = raw[i] * scale; const b = { k, name, years, x: x0, w }; x0 += w; return b; });
  const H = top + lanes.length * laneH + 10;
  const out = [];
  bands.forEach((b, i) => {
    const on = f.gv === b.k;
    out.push(`<g class="gband ${on ? "on" : ""} ${f.gv && !on ? "dim" : ""}" data-act="dset" data-set="gv:${b.k}"><rect x="${b.x + 2}" y="6" width="${b.w - 4}" height="${H - 10}" rx="10" class="gbg ${i % 2 ? "alt" : ""}"/>
      <text x="${b.x + b.w / 2}" y="24" text-anchor="middle" class="gname">${esc(b.name)}</text><text x="${b.x + b.w / 2}" y="39" text-anchor="middle" class="gyears">${b.years}</text></g>`);
  });
  lanes.forEach((cid, li) => {
    const y0 = top + li * laneH + 8;
    out.push(`<text x="8" y="${y0 + (ROWS * CELL) / 2 + 4}" class="ln">${esc(d.candidates[cid].name)}</text>`);
    bands.forEach((b) => {
      const list = placed.filter((c) => c.candidate === cid && c.eras.includes(b.k)).sort((a, z) => ORDER.indexOf(a.verdict) - ORDER.indexOf(z.verdict));
      const cols = Math.max(1, Math.floor((b.w - 12) / CELL));
      list.forEach((c, j) => {
        const col = Math.floor(j / ROWS), row = j % ROWS;
        if (col >= cols) return;
        const cx = b.x + 8 + CELL / 2 + col * CELL, cy = y0 + CELL / 2 + row * CELL;
        const sel = state.graphSelected === c.id;
        out.push(`<circle cx="${cx}" cy="${cy}" r="${sel ? 9 : 7}" class="tdot ${c.verdict} ${fits(c, f) ? "" : "off"} ${sel ? "sel" : ""}" data-act="dsel" data-id="${c.id}"><title>${esc(GOV_NAME[b.k])} · ${esc(c.claim)}</title></circle>`);
      });
    });
  });
  const outside = d.claims.filter((c) => !(c.eras || []).length && fits(c, f, ["gv"])).length;
  return `<div class="panel-head"><h2 class="h3">Os fatos por governo</h2><p>Em que governo aconteceu o que cada um citou. Toque num governo pra filtrar, ou numa bolinha pra abrir.</p></div>
    <div class="tl-wrap"><svg viewBox="0 0 ${W} ${H}" class="tl-svg gov-svg" role="img" aria-label="Falas organizadas pelo governo a que se referem">${out.join("")}</svg></div>
    <p class="small muted">Falas que comparam dois períodos aparecem nos dois. ${outside ? `${outside} fala${outside > 1 ? "s" : ""} sem período definido (promessa, outro país ou data não confirmada).` : ""}</p>`;
}

function selectedHtml(claim) {
  if (!claim) return peekHtml(null);
  return `<article class="item ${claim.verdict} in-peek">
    <div class="top-line"><span>${chip(claim.candidate)} <span class="muted">${esc(TOPIC[claim.topic])}${claim.t != null ? ` · ${mmss(claim.t)}` : ""}</span></span><span class="vt ${claim.verdict}">${esc(VERDICT[claim.verdict].label)}</span></div>
    <p class="q">${esc(claim.claim)}</p>
    <p class="w">${esc(claim.why)}</p>
    ${sources(claim)}
    ${videoActions(claim)}
  </article>`;
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
    <p>Usamos as checagens publicadas sobre ${d.parts ? "cada debate" : "este debate"}, lidas fala a fala nas páginas originais. Cada fala mostra o rótulo exato que cada agência deu, com link para a checagem. Quando a agência tem link para o item, o link vai direto a ele.</p>
    ${(d.parts ? d.parts.map((id) => state.debates[id]) : [d]).filter((x) => x.sources_note && x.id.startsWith("globo")).map((x) => `<p class="small muted">${esc(x.title)}: ${esc(x.sources_note)}</p>`).join("")}
    <h2 class="h3">Como os rótulos foram unificados</h2>
    <p>Cada agência tem a própria escala. Agrupamos os rótulos em três classes:</p>
    <div class="maptable">
      <div>${verdictPill("verdadeiro")}<span>Verdadeiro (Lupa, Aos Fatos, Estadão), #FATO (g1), "acerta" (Folha)</span></div>
      <div>${verdictPill("distorcido")}<span>Exagerado, Subestimado, Falta contexto, Impreciso, Enganoso, Não é bem assim, #NÃOÉBEMASSIM</span></div>
      <div>${verdictPill("falso")}<span>Falso, #FAKE, "erra" (Folha) e Insustentável (afirmação feita como fato sem evidência que a sustente)</span></div>
    </div>
    <h2 class="h3">Quando as agências discordam</h2>
    <p>A mesma regra vale para as duas candidaturas, sem preferência por agência:</p>
    <ul>
      <li>Se uma agência diz verdadeiro e outra diz falso sobre a mesma fala, ela aparece como ${verdictPill("divergente")} e fica fora do quiz.</li>
      <li>Fora isso, vale a classe da maioria das agências que checaram a fala.</li>
      <li>Empate entre verdadeiro e distorcido, ou entre distorcido e falso, vira distorcido.</li>
    </ul>
    <p>As falas aparecem resumidas, sem aspas, porque o texto é nosso. O que o candidato disse de fato está no corte do vídeo e no link para o minuto exato.</p>
    <h2 class="h3">O que isso não é</h2>
    <ul>
      <li>Não é uma amostra de tudo que foi dito. As agências escolhem o que checar, e cada uma escolhe diferente.</li>
      <li>Não é um placar de quem "venceu". É um mapa de quais falas sobreviveram à checagem.</li>
      <li>Os números por agência contam as falas desta base que cada uma checou. Não devem ser somados entre si: a mesma fala pode ter várias fontes.</li>
    </ul>
    <h2 class="h3">O quiz</h2>
    <p>São 10 falas por dia, 5 de cada candidato, sorteadas entre as que têm veredito claro e corte do vídeo. O sorteio garante 3 ou 4 falas de cada veredito, pelo menos uma de saúde e uma de um tema menos citado. Todo mundo que joga no mesmo dia recebe as mesmas 10, então dá pra comparar resultado. Também dá pra jogar por tema: economia, segurança, corrupção e saúde.</p>
    <h2 class="h3">Imagens, cortes e vídeo</h2>
    <p>Tudo que você gera aqui é desenhado no seu navegador a partir dos mesmos dados, com a fonte escrita no próprio arquivo. Nada é enviado a servidor nenhum.</p>
    <p>Os cortes são trechos curtos do vídeo oficial do debate publicado no YouTube, com a legenda automática do trecho, o veredito, as fontes e o crédito da emissora gravados no vídeo, para fins de checagem e comentário. A legenda é automática e pode ter erros de transcrição. O botão "Ver no debate" toca o trecho e dá o link para o momento exato no YouTube.</p>
    <h2 class="h3">Fotos e marcas</h2>
    <ul>${Object.values(d.candidates).filter((c) => c.photo_credit).map((c) => `<li>${esc(c.full)}: ${esc(c.photo_credit)}</li>`).join("")}
    <li>Logos de partidos, emissora e agências são marcas dos respectivos donos, usadas só para identificar quem é quem. Nenhum deles endossa este site.</li></ul>
    ${(d.parts ? d.parts.map((id) => state.debates[id]) : [d]).filter((x) => x.video).map((x) => `<p class="small muted">Vídeo do ${esc(x.title)}: "${esc(x.video.title || "")}", canal ${esc(x.video.channel)} no YouTube.</p>`).join("")}
    <h2 class="h3">Estatísticas de uso</h2>
    <p>Quando ativadas, coletamos estatísticas anônimas de uso (páginas vistas, origem do acesso, dispositivo, país, cliques no quiz, nos cortes e nos compartilhamentos) com a ferramenta PostHog, sem guardar IP nem qualquer dado que identifique você. Isso serve só para saber o que funciona e corrigir o que não funciona. Navegadores com "Não rastrear" ativado ficam de fora.</p>
    <h2 class="h3">Quem fez</h2>
    <p>Projeto independente de <a href="https://www.linkedin.com/in/deniciosantos/" target="_blank" rel="noopener">Denicio Santos</a>. Sem vínculo com candidatos, partidos, emissoras ou agências de checagem.</p>
    <h2 class="h3">Achou um erro?</h2>
    <p>Se um veredito está diferente do que a agência publicou, ou uma fala foi resumida de forma injusta, o problema é nosso, não da agência. Abra o link da fonte, compare e avise pelo <a href="https://www.linkedin.com/in/deniciosantos/" target="_blank" rel="noopener">LinkedIn</a>.</p>
    <p class="small muted">Site independente, sem vínculo com candidatos, partidos, emissoras ou agências de checagem. Dados: ${esc(d.title)}, ${esc(d.dateLabel || dateBR(d.date))}.</p>
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
  const v = vidOf(claim); const start = Math.max(0, (ytT(claim) || 0) - 3);
  const real = await hasClip(claim);
  const el = document.createElement("div"); el.className = "modal"; el.setAttribute("role", "dialog");
  const player = real
    ? `<video class="clipv" src="${esc(claim.clip)}" controls playsinline preload="metadata"></video><p class="small muted">Trecho do debate (imagens: ${esc(debOf(claim).broadcaster)}), com legenda e veredito. Abaixo, o vídeo completo no momento da fala.</p>`
    : `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(ytId(claim))}?start=${start}&rel=0" title="Debate no YouTube" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  el.innerHTML = `<div class="box">
    ${player}
    <div class="who">${chip(claim.candidate)} <span class="muted small">aos ${mmss(ytT(claim))} · ${esc(v.channel)}</span></div>
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
function showMedia({ blob, kind, filename, text, link = siteUrl() }) {
  const url = URL.createObjectURL(blob);
  const el = document.createElement("div"); el.className = "modal"; el.setAttribute("role", "dialog");
  el.innerHTML = `<div class="box">${kind === "video" ? `<video src="${url}" controls autoplay muted playsinline loop></video>` : `<img src="${url}" alt="Pré-visualização">`}
    <div class="row"><button class="btn accent" data-m="share">Compartilhar ${kind === "video" ? "o vídeo" : "a imagem"}</button><a class="btn ghost" href="${url}" download="${esc(filename)}">Baixar</a></div>
    ${shareRow(text, link)}
    <div class="row"><button class="btn sm ghost" data-m="close">Fechar</button></div>
    <div class="status" data-m="status"></div></div>`;
  let close;
  el.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m;
    if (m === "close" || e.target === el) { close(); return; }
    if (m === "share") { track("share", { what: kind, file: filename }); await deliver(blob, filename, text, el.querySelector('[data-m="status"]')); }
    if (m === "copylink") { try { await navigator.clipboard.writeText(link); el.querySelector('[data-m="status"]').textContent = "Link copiado."; } catch (_) {} }
  });
  close = openModal(el, () => URL.revokeObjectURL(url));
}
async function makeClaimCard(id) {
  track("card", { what: "claim", claim: id });
  const claim = claimById(id); const c = document.createElement("canvas");
  await document.fonts.ready; drawClaimCard(c, { claim, debate: debOf(claim) });
  const blob = await toBlob(c);
  showMedia({ blob, kind: "image", filename: `raio-x-${id}.png`, text: `${state.debate.candidates[claim.candidate].name} disse, em resumo: ${claim.claim} — ${VERDICT[claim.verdict].label}, segundo ${claim.sources.map((s) => state.debate.agencies[s.agency].name).join(" e ")}. Veja a checagem e o vídeo: ${claimLink(id)}`, link: claimLink(id) });
}
async function makeTapeCard() {
  track("card", { what: "tape" });
  const c = document.createElement("canvas"); await document.fonts.ready; await drawTapeCard(c, { debate: state.debate });
  const [a, b] = cands(); const A = tapeStats(a), B = tapeStats(b);
  showMedia({ blob: await toBlob(c), kind: "image", filename: "ficha-do-debate.png", text: `Ficha técnica do ${state.debate.title}: ${cand(a).name} ${A.pct}% x ${cand(b).name} ${B.pct}% das falas checadas com problema. Veja fala por fala: ${siteUrl()}`, link: siteUrl() });
}
async function makeRaioxCard() {
  track("card", { what: "raiox" });
  const c = document.createElement("canvas"); await document.fonts.ready; drawRaioxCard(c, { debate: state.debate });
  showMedia({ blob: await toBlob(c), kind: "image", filename: "raio-x-do-debate.png", text: `Raio-X ${state.debate.parts ? "dos" : "do"} ${state.debate.title}: ${state.debate.claims.length} falas checadas, numa imagem. Explore: ${siteUrl()}#/raiox`, link: siteUrl() + "#/raiox" });
}
async function makeClip(btn, id) {
  track("clip", { what: "rendered", claim: id });
  const claim = claimById(id); const old = btn.textContent; btn.disabled = true;
  try {
    await document.fonts.ready;
    const { blob, ext } = await recordClaimClip(debOf(claim), claim, { onProgress: (p) => { btn.textContent = `Gravando ${Math.round(p * 100)}%`; } });
    showMedia({ blob, kind: "video", filename: `corte-${id}.${ext}`, text: `${cand(claim.candidate).name} disse, em resumo: ${claim.claim} — ${VERDICT[claim.verdict].label}, segundo ${claim.sources.map((s) => state.debate.agencies[s.agency].name).join(" e ")}. Veja a checagem e o vídeo: ${claimLink(id)}`, link: claimLink(id) });
  } catch (e) { alert("Não deu pra gravar: " + e.message); }
  btn.disabled = false; btn.textContent = old;
}
async function makeVideo(btn) {
  const status = document.getElementById("export-status"); btn.disabled = true;
  try {
    await document.fonts.ready;
    const { blob, ext } = await recordRaioxVideo(state.debate, { onProgress: (p) => { status.textContent = `Gravando… ${Math.round(p * 100)}%`; } });
    status.textContent = ""; showMedia({ blob, kind: "video", filename: `raio-x-do-debate.${ext}`, text: `Raio-X ${state.debate.parts ? "dos" : "do"} ${state.debate.title} em 8 segundos. Explore: ${siteUrl()}#/raiox`, link: siteUrl() + "#/raiox" });
  } catch (e) { status.textContent = "Não deu pra gravar: " + e.message; }
  btn.disabled = false;
}
function resultText() { const n = score(), total = state.quiz.ids.length, tp = state.quiz.topic; return `Acertei ${n} de ${total} no quiz${tp ? " de " + TOPIC[tp] : ""} do Raio-X do Debate. Fato, distorcido ou fake: você acerta quantas? ${quizLink()}`; }
function quizLink() { const tp = state.quiz && state.quiz.topic; return siteUrl() + "quiz/" + (tp ? "?tema=" + tp : ""); }
async function shareResult() {
  const canvas = document.getElementById("share-canvas"); const status = document.getElementById("share-status");
  track("share", { what: "result", score: score() });
  await deliver(await toBlob(canvas), "raio-x-do-debate.png", resultText(), status);
}

// ---------- after render / events ----------
function afterRender(path) {
  const tl = (t) => TOPIC[t] || t;
  if (path === "/raiox") {
    const c = document.getElementById("rx-canvas");
    if (c) liveGraph = mountGraph(c, state.debate, {
      topicLabel: tl, filter: {},
      onSelect: (cl) => dashSelect(cl ? cl.id : state.graphSelected),
      onFilter: (gf) => { const f = dash(); for (const [gk, dk] of [["candidate", "c"], ["topic", "tp"]]) { if (gf[gk]) f[dk] = gf[gk]; else delete f[dk]; } track("dash_filter", { ...f }); dashUpdate(); },
    });
    dashUpdate();
  }

  if (path === "/resultado") { const c = document.getElementById("share-canvas"); if (c) document.fonts.ready.then(() => drawResultCard(c, { score: score(), total: state.quiz.ids.length, title: title(score(), state.quiz.ids.length)[0], marks: state.quiz.ids.map((id) => state.quiz.answers[id].hit), debate: state.debate })); }
}

$app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) { const it = e.target.closest(".dash .item[id^='it-']"); if (it && !e.target.closest("a")) dashSelect(it.id.slice(3)); return; }
  const act = btn.dataset.act;
  if (act === "answer") { btn.classList.add("pressed"); btn.closest(".keypad").querySelectorAll(".key").forEach((k) => (k.disabled = true)); setTimeout(() => answer(btn.dataset.v), 110); }
  else if (act === "next") next();
  else if (act === "again") { const tp = state.quiz && state.quiz.topic; startQuiz(`${state.debate.id}|${Date.now()}|${Math.random()}`, tp); location.hash = "#/quiz" + (tp ? "?tema=" + tp : ""); }
  else if (act === "share") shareResult();
  else if (act === "claimcard") makeClaimCard(btn.dataset.id);
  else if (act === "watch") showEmbed(claimById(btn.dataset.id));
  else if (act === "dset") dashSet(btn.dataset.set);
  else if (act === "dsel") dashSelect(btn.dataset.id);
  else if (act === "copyres") { navigator.clipboard?.writeText(quizLink()).then(() => { btn.textContent = "Link copiado"; }).catch(() => {}); }
  else if (act === "fopen") { state.fsheetOpen = true; track("dash_filters_open"); dashUpdate(); }
  else if (act === "fclose") { state.fsheetOpen = false; dashUpdate(); }
  else if (act === "dunset") { delete dash()[btn.dataset.k]; dashUpdate(); }
  else if (act === "debate") { const id = idForKey(btn.dataset.d); if (id) { setDebate(id); route(); } }
  else if (act === "dclose") { state.graphSelected = null; dashUpdate(); }
  else if (act === "dclear") { state.dash = {}; state.graphSelected = null; dashUpdate(); }
  else if (act === "dlink") { const link = siteUrl() + location.hash; shareSite(link, `Olha este recorte do raio-X do debate, checado por ${agencyCount()} agências: ` + link); }
  else if (act === "shareSite") shareSite();
  else if (act === "clip") makeClip(btn, btn.dataset.id);
  else if (act === "realclip") realClip(btn, btn.dataset.id);
  else if (act === "raioxcard") makeRaioxCard();
  else if (act === "tapecard") makeTapeCard();
  else if (act === "video") { track("video_summary"); makeVideo(btn); }
  else if (act === "graphpng") { const c = document.getElementById("rx-canvas"); if (c) toBlob(c).then((blob) => showMedia({ blob, kind: "image", filename: "malha-do-debate.png", text: `A malha do ${state.debate.title}: cada ponto é uma fala checada. Explore: ${siteUrl()}#/raiox`, link: siteUrl() + "#/raiox" })); }
});
$app.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-dsel]"); if (!sel) return;
  const f = dash(); if (sel.value) f[sel.dataset.dsel] = sel.value; else delete f[sel.dataset.dsel];
  track("dash_filter", { ...f }); dashUpdate();
});
// timeline dots are SVG circles: clicks bubble with data-act, handled above
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.fsheetOpen) { state.fsheetOpen = false; dashUpdate(); return; }
  if (e.key === "Escape" && document.body.classList.contains("drawer-open") && !document.querySelector(".modal")) { state.graphSelected = null; dashUpdate(); return; }
  if (!location.hash.startsWith("#/quiz") || !state.quiz) return;
  const map = { "1": "verdadeiro", "2": "distorcido", "3": "falso" };
  if (map[e.key]) { const b = document.querySelector(`.key[data-v="${map[e.key]}"]`); if (b && !b.disabled) b.click(); }
  if (e.key === "Enter") { const n = document.querySelector('[data-act="next"]'); if (n) n.click(); }
});
document.getElementById("navshare")?.addEventListener("click", () => shareSite());
document.getElementById("dswitch")?.addEventListener("click", (e) => { const b = e.target.closest('[data-act="debate"]'); if (!b) return; const id = idForKey(b.dataset.d); if (id) { setDebate(id); route(); } });
window.addEventListener("hashchange", () => { route(); window.scrollTo({ top: 0 }); });

loadData().then(route).catch((err) => { $app.innerHTML = `<section class="prose"><h1 class="h2">Não deu pra carregar os dados</h1><p>Abra o site por um servidor (não por file://). Detalhe: ${esc(err.message)}</p></section>`; });
