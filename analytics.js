// Anonymous product analytics (PostHog). No-op until data/config.json has a key.
// What we capture: page views per hash route, quiz events, shares, clip/video plays, lens changes,
// filters, time on page (PostHog's own), referrer/UTM/device/geo (PostHog's own, IP not stored).
// Respects Do Not Track. No autocapture of every DOM click: only the events below.

let ph = null;
let enabled = false;
const queue = [];

export async function initAnalytics(config) {
  const c = config && config.posthog;
  if (!c || !c.key) return false;
  if (navigator.doNotTrack === "1") return false;
  try {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = (c.assets || "https://us-assets.i.posthog.com") + "/static/array.js";
      s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    ph = window.posthog;
    const opts = {
      api_host: c.host || "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,       // we send our own, per hash route
      capture_pageleave: true,       // gives time on page
      persistence: "localStorage+cookie",
      disable_session_recording: !c.replay,
      disable_surveys: true,           // fewer extra scripts on mobile
      capture_dead_clicks: false,
    };
    if (c.replay) opts.session_recording = { maskAllInputs: true };
    ph.init(c.key, opts);
    enabled = true;
    for (const [n, p] of queue) ph.capture(n, p);
    queue.length = 0;
    notice();
    return true;
  } catch (_) { return false; }
}

// LGPD: a one-time, dismissible notice that anonymous usage statistics are collected
function notice() {
  try { if (localStorage.getItem("raiox:notice") === "1") return; } catch (_) {}
  const el = document.createElement("div"); el.className = "notice";
  el.innerHTML = `<span>Usamos estatísticas de uso anônimas para saber o que funciona. <a href="#/metodologia">Saiba mais</a>.</span><span class="row"><button class="btn sm ghost" data-n="no">Não quero</button><button class="btn sm" data-n="ok">Ok</button></span>`;
  el.addEventListener("click", (e) => {
    const n = e.target.closest("[data-n]")?.dataset.n; if (!n) return;
    if (n === "no" && ph) ph.opt_out_capturing();
    el.remove(); try { localStorage.setItem("raiox:notice", "1"); } catch (_) {}
  });
  document.body.appendChild(el);
}

export function track(name, props = {}) {
  const p = { route: location.hash.replace(/^#/, "") || "/", ...props };
  if (enabled && ph) ph.capture(name, p); else queue.push([name, p]);
}

export function pageview(route, extra = {}) {
  track("$pageview", { $current_url: location.origin + location.pathname + "#" + route, route, ...extra });
}
