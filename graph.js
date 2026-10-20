// Force-directed network of the debate: candidate hubs, topic anchors, one node per checked claim.
// Pure canvas, no dependencies. Used live on the page and offline for share images / video frames.

export const COLORS = {
  verdadeiro: "#2ee59d",
  distorcido: "#ffb224",
  falso: "#ff4d6d",
  divergente: "#8b7cff",
  nao_verificado: "#6b748c",
  hub: "#eef1f8",
  topic: "#a4adc2",
  bg: "#090c14",
};

export function buildGraph(debate, { width, height }) {
  const cands = Object.keys(debate.candidates);
  const topics = [...new Set(debate.claims.map((c) => c.topic))];
  const nodes = [];
  const links = [];
  const byId = new Map();

  cands.forEach((cid, i) => {
    const n = { id: "cand:" + cid, kind: "hub", label: debate.candidates[cid].name, color: debate.candidates[cid].color || COLORS.hub, x: width * (i === 0 ? 0.28 : 0.72), y: height * 0.5, fx: true, r: 22 };
    nodes.push(n); byId.set(n.id, n);
  });
  topics.forEach((tp, i) => {
    const a = (i / topics.length) * Math.PI * 2 - Math.PI / 2;
    const n = { id: "topic:" + tp, kind: "topic", label: tp, x: width / 2 + Math.cos(a) * width * 0.30, y: height / 2 + Math.sin(a) * height * 0.36, r: 5, fx: true };
    nodes.push(n); byId.set(n.id, n);
  });
  debate.claims.forEach((c, i) => {
    const hub = byId.get("cand:" + c.candidate);
    const n = { id: c.id, kind: "claim", claim: c, x: hub.x + (Math.random() - 0.5) * 20, y: hub.y + (Math.random() - 0.5) * 20, vx: 0, vy: 0, r: 4 + Math.min(c.sources.length, 3) * 1.5, born: i };
    nodes.push(n); byId.set(n.id, n);
    links.push({ a: n, b: hub, k: 0.03, len: Math.min(width, height) * 0.24, kind: "hub" });
    links.push({ a: n, b: byId.get("topic:" + c.topic), k: 0.02, len: Math.min(width, height) * 0.14, kind: "topic" });
  });
  return { nodes, links, width, height, byId, alpha: 1 };
}

export function step(g, dt = 1) {
  const { nodes, links, width, height } = g;
  const alpha = g.alpha;
  // repulsion (claims + topics), hubs fixed
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]; if (a.fx) continue;
    let fx = 0, fy = 0;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue; const b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      if (dx === 0 && dy === 0) { dx = (i - j) * 0.37; dy = (j - i) * 0.21; } // never let two nodes share a point
      let d2 = dx * dx + dy * dy;
      if (d2 > 90000) continue;
      d2 = Math.max(d2, 144); // soften: no stronger than at 12px
      const strength = (b.kind === "hub" ? 1400 : b.kind === "topic" ? 260 : 160);
      const f = strength / d2; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      fx += (dx / d) * f; fy += (dy / d) * f;
    }
    // centering, stronger vertically because the canvas is wide; soft walls near the edges
    fx += (width / 2 - a.x) * 0.004; fy += (height / 2 - a.y) * 0.006;
    const m = 30;
    if (a.x < m) fx += (m - a.x) * 0.2; if (a.x > width - m) fx -= (a.x - (width - m)) * 0.2;
    if (a.y < m) fy += (m - a.y) * 0.2; if (a.y > height - m) fy -= (a.y - (height - m)) * 0.2;
    a.vx = (a.vx || 0) + fx * alpha * dt; a.vy = (a.vy || 0) + fy * alpha * dt;
  }
  for (const l of links) {
    const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y; const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
    const f = (d - l.len) * l.k * alpha;
    const ux = dx / d, uy = dy / d;
    if (!l.a.fx) { l.a.vx += ux * f * dt; l.a.vy += uy * f * dt; }
  }
  for (const n of nodes) {
    if (n.fx) continue;
    n.vx *= 0.8; n.vy *= 0.8;
    const sp = Math.hypot(n.vx, n.vy); const cap = 10;
    if (sp > cap) { n.vx *= cap / sp; n.vy *= cap / sp; }
    n.x += n.vx * dt; n.y += n.vy * dt;
    const m = 14;
    if (n.x < m) { n.x = m; n.vx = 0; } if (n.x > width - m) { n.x = width - m; n.vx = 0; }
    if (n.y < m) { n.y = m; n.vy = 0; } if (n.y > height - m) { n.y = height - m; n.vy = 0; }
  }
  g.alpha = Math.max(0.08, alpha * 0.985);
}

export function settle(g, iterations = 260) { g.alpha = 1; for (let i = 0; i < iterations; i++) step(g); }

// progress: 0..1 reveals claim nodes in birth order; hover/selected: node ids to highlight; filter: {candidate, topic, verdict}
export function draw(ctx, g, { progress = 1, hover = null, selected = null, filter = {}, now = 0, labels = true, topicLabel = (t) => t, dpr = 1, glow = true, zoom = 1, clear = true } = {}) {
  const { nodes, links, width, height } = g;
  ctx.save();
  ctx.scale(dpr, dpr);
  if (clear) ctx.clearRect(0, 0, width, height);
  const z = zoom;
  const total = nodes.filter((n) => n.kind === "claim").length;
  const shown = Math.floor(progress * total + 0.0001);
  const visible = (n) => n.kind !== "claim" || n.born < shown;
  const passes = (n) => n.kind !== "claim" || ((!filter.candidate || n.claim.candidate === filter.candidate) && (!filter.topic || n.claim.topic === filter.topic) && (!filter.verdict || n.claim.verdict === filter.verdict) && (!filter.agency || n.claim.sources.some((s) => s.agency === filter.agency)) && (!filter.era || (n.claim.eras || []).includes(filter.era)));
  const lit = (id) => id === hover || id === selected;

  // links
  ctx.lineWidth = 1;
  for (const l of links) {
    if (!visible(l.a) || !visible(l.b)) continue;
    const c = l.a.kind === "claim" ? COLORS[l.a.claim.verdict] : COLORS.topic;
    const isLit = lit(l.a.id) || lit(l.b.id);
    const dim = !passes(l.a) || !passes(l.b);
    ctx.strokeStyle = c; ctx.globalAlpha = isLit ? 0.95 : dim ? 0.03 : (l.kind === "hub" ? 0.22 : 0.10);
    ctx.lineWidth = (isLit ? 2 : 1) * z;
    ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // topic anchors
  for (const n of nodes) {
    if (n.kind !== "topic") continue;
    const active = filter.topic === n.label;
    ctx.fillStyle = active ? "#fff" : COLORS.topic; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(n.x, n.y, (active ? 5 : 3) * z, 0, Math.PI * 2); ctx.fill();
    if (labels) {
      const text = topicLabel(n.label);
      ctx.font = `700 ${11 * z}px Archivo, sans-serif`; ctx.textBaseline = "middle";
      const tw = ctx.measureText(text).width;
      // top/bottom anchors get the label stacked above/below; side anchors get it beside, facing the centre
      const vertical = Math.abs(n.y - height / 2) > height * 0.28;
      let tx, ty;
      if (vertical) { tx = Math.max(6, Math.min(width - 6 - tw, n.x - tw / 2)); ty = n.y + (n.y > height / 2 ? 14 * z : -14 * z); }
      else { const left = n.x > width / 2; tx = left ? Math.max(6, n.x - 8 * z - tw) : Math.min(width - 6 - tw, n.x + 8 * z); ty = n.y; }
      ctx.globalAlpha = 0.85; ctx.fillStyle = COLORS.bg; ctx.fillRect(tx - 3 * z, ty - 8 * z, tw + 6 * z, 16 * z);
      ctx.globalAlpha = 0.95; ctx.fillStyle = active ? "#fff" : COLORS.topic; ctx.textAlign = "left"; ctx.fillText(text, tx, ty);
      n.labelBox = { x: tx - 3 * z, y: ty - 8 * z, w: tw + 6 * z, h: 16 * z };
    }
  }
  ctx.globalAlpha = 1;

  // claim nodes
  for (const n of nodes) {
    if (n.kind !== "claim" || !visible(n)) continue;
    const c = COLORS[n.claim.verdict];
    const isLit = lit(n.id); const isSel = selected === n.id;
    const appear = Math.min(1, (progress * total - n.born) * 1.5); // pop-in
    const pulse = isSel ? 1 + 0.18 * Math.sin(now / 180) : 1;
    const r = n.r * z * (isLit ? 1.6 : 1) * pulse * (0.4 + 0.6 * appear);
    ctx.globalAlpha = passes(n) ? 1 : 0.12;
    if (glow && passes(n)) { ctx.shadowColor = c; ctx.shadowBlur = (isLit ? 26 : 10) * z; }
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    if (isLit) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * z; ctx.stroke(); }
    if (isSel) { ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5 * z; ctx.beginPath(); ctx.arc(n.x, n.y, r + 7 * z * pulse, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  // hubs
  for (const n of nodes) {
    if (n.kind !== "hub") continue;
    const active = filter.candidate === n.id.replace("cand:", "");
    ctx.fillStyle = active ? n.color : COLORS.bg; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * z, 0, Math.PI * 2); ctx.fill();
    if (glow) { ctx.shadowColor = n.color; ctx.shadowBlur = (active ? 30 : 18) * z; }
    ctx.strokeStyle = n.color; ctx.lineWidth = 2.5 * z; ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.hub; ctx.font = `800 ${13 * z}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(n.label.toUpperCase(), n.x, n.y);
  }
  ctx.restore();
}

export function pick(g, x, y, radius = 14) {
  let best = null, bd = radius * radius;
  for (const n of g.nodes) { if (n.kind !== "claim") continue; const dx = n.x - x, dy = n.y - y; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = n; } }
  return best;
}
// any node: claims first, then hubs, then topics (anchor or label box)
export function pickAny(g, x, y) {
  const c = pick(g, x, y, 16); if (c) return c;
  for (const n of g.nodes) { if (n.kind === "hub" && Math.hypot(n.x - x, n.y - y) <= n.r + 6) return n; }
  for (const n of g.nodes) {
    if (n.kind !== "topic") continue;
    if (Math.hypot(n.x - x, n.y - y) <= 12) return n;
    const b = n.labelBox; if (b && x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) return n;
  }
  return null;
}

// Mount an interactive, animated graph into a <canvas>. Returns a controller.
// Click a claim: select it (onSelect). Click a hub: toggle candidate filter. Click a topic: toggle topic filter. onFilter gets the filter.
export function mount(canvas, debate, { onHover, onSelect, onFilter, topicLabel, animateIn = true, filter: initialFilter = {} } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let g, hover = null, selected = null, raf = 0, t0 = performance.now(), progress = animateIn ? 0 : 1, stopped = false;
  const filter = { ...initialFilter };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(280, Math.round(rect.width)), h = Math.max(260, Math.round(rect.height));
    canvas.width = w * dpr; canvas.height = h * dpr;
    g = buildGraph(debate, { width: w, height: h });
    settle(g, 200); g.alpha = 0.3;
  }
  let idle = false, wakeUntil = 0;
  function wake(ms = 1200) { wakeUntil = Math.max(wakeUntil, performance.now() + ms); if (idle && !stopped) { idle = false; raf = requestAnimationFrame(frame); } }
  function frame(now) {
    if (stopped) return;
    if (progress < 1) progress = Math.min(1, (now - t0) / 2200);
    if (g.alpha > 0.081 || progress < 1) step(g, 1);
    draw(canvas.getContext("2d"), g, { progress, hover, selected, filter, now, dpr, topicLabel });
    // keep animating only while something moves: intro, layout settling, the selected-node pulse, or a recent interaction
    const busy = progress < 1 || g.alpha > 0.081 || selected || now < wakeUntil;
    if (busy && !document.hidden) raf = requestAnimationFrame(frame); else idle = true;
  }
  const onVis = () => { if (!document.hidden) wake(); };
  document.addEventListener("visibilitychange", onVis);
  function at(e) { const rect = canvas.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top]; }
  function move(e) {
    wake(600);
    const [x, y] = at(e); const n = pickAny(g, x, y);
    canvas.style.cursor = n ? "pointer" : "crosshair";
    const id = n && n.kind === "claim" ? n.id : null;
    if (id !== hover) { hover = id; onHover && onHover(n && n.kind === "claim" ? n.claim : null); }
  }
  function down(e) {
    wake();
    const [x, y] = at(e); const n = pickAny(g, x, y);
    if (!n) { if (selected) { selected = null; onSelect && onSelect(null); } return; }
    if (n.kind === "claim") { selected = selected === n.id ? null : n.id; onSelect && onSelect(selected ? n.claim : null); }
    else if (n.kind === "hub") { const cid = n.id.replace("cand:", ""); filter.candidate = filter.candidate === cid ? null : cid; onFilter && onFilter({ ...filter }); }
    else if (n.kind === "topic") { filter.topic = filter.topic === n.label ? null : n.label; onFilter && onFilter({ ...filter }); }
    e.preventDefault();
  }
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerdown", down);
  const ro = new ResizeObserver(() => { resize(); wake(); });
  resize(); ro.observe(canvas);
  raf = requestAnimationFrame(frame);
  return {
    destroy() { stopped = true; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerdown", down); },
    graph: () => g,
    setFilter(f) { Object.assign(filter, f); wake(); },
    select(id) { selected = id; wake(); },
    getFilter: () => ({ ...filter }),
  };
}
