/* ============================================================================
   YouTube Interest Profiler — app.js
   A tiny vanilla "window manager" that loads data.json and draws a Win95 desktop.
   No frameworks, no build step, no browser storage.
   ========================================================================== */
"use strict";

/* ----------------------------------- helpers ----------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const coarse = window.matchMedia("(pointer: coarse)").matches;
const isSmall = () => window.innerWidth <= 640;

/* ----------------------------------- demo data ----------------------------------- */
/* Shown when data.json can't be fetched (e.g. opened via file://, or not generated
   yet). Mirrors `python backend.py --sample`. */
const DEMO_DATA = {
  generated_at: "—",
  source: "demo data",
  video_count: 18,
  titles: [
    "I beat Elden Ring at level 1 (no hits, no summons)",
    "Why Sekiro's combat is the best ever designed",
    "Building a $2,000 small form-factor PC in 2026",
    "Frieren is the best anime of the decade — here's why",
    "How to make tonkotsu ramen broth from scratch (18 hrs)",
    "Lo-fi beats to code / study to — 24/7 radio",
    "The hidden lore of Bloodborne explained",
    "Tokyo at night: a walking tour through Shinjuku",
    "I tried living like a Japanese minimalist for 30 days",
    "Optimising Linux for low-latency gaming",
    "Every Dark Souls boss ranked from worst to best",
    "Learning Japanese with anime — does it actually work?",
    "Mechanical keyboard sound test (40 switches)",
    "Authentic gyoza at home — the technique nobody shows you",
    "Cyberpunk 2077 photo-mode masterclass",
    "Why I switched my whole setup to a tiling window manager",
    "A quiet day in a Kyoto tea house (ASMR)",
    "Soulslike beginners guide: stop dodging, start parrying",
  ],
  profile: {
    dominant_theme: "The Nocturnal Power-User",
    watch_style: "Deep Diver",
    personality_summary:
      "You don't just play games, you study them — the Souls deep-dives sit right next to PC-tuning guides, the signature of someone who treats hobbies like systems to master. The anime and ramen tutorials aren't a separate lane; they're the same curiosity pointed at Japan. Late-night lo-fi ties it together: a focused, build-it-yourself kind of mind.",
    hidden_passion:
      "Your anime picks lean slow, atmospheric and distinctly Japanese, and they keep landing next to ramen, gyoza and Tokyo walking tours. That's not a coincidence — under the gaming is a quietly growing pull toward Japanese culture and language. You're closer to booking a Kyoto trip than you think.",
    sample_titles: [
      "I beat Elden Ring at level 1 (no hits, no summons)",
      "Learning Japanese with anime — does it actually work?",
      "How to make tonkotsu ramen broth from scratch (18 hrs)",
    ],
    top_interests: [
      { category: "Soulslike Mastery", confidence: 95, emoji: "⚔️",
        reason: "Not casual playthroughs — challenge runs, lore breakdowns and boss rankings. You want to understand the design, not just clear it." },
      { category: "PC Building & Tuning", confidence: 88, emoji: "🖥️",
        reason: "SFF builds, Linux latency tweaks, tiling window managers. Classic power-user signal: the setup is part of the hobby." },
      { category: "Japanese Culture", confidence: 80, emoji: "🎌",
        reason: "Atmospheric anime plus Tokyo tours and minimalism experiments. Curiosity about a place, not just a genre." },
      { category: "Cooking (Japanese)", confidence: 72, emoji: "🍜",
        reason: "Ramen, gyoza, technique-first videos. You cook what you watch — hands-on, not passive." },
      { category: "Focus & Ambient Audio", confidence: 64, emoji: "🎧",
        reason: "Lo-fi radios and ASMR tea houses. Background fuel for long, deep sessions on everything else." },
    ],
  },
};

/* ----------------------------------- themes ----------------------------------- */
/* ids match the [data-theme=…] blocks in style.css ("dusk" = :root defaults) */
const THEMES = [
  { id: "dusk",          name: "Dusk Anime",    swatch: "linear-gradient(135deg,#b9a7d6,#c9a6c6 60%,#9a86c4)" },
  { id: "deep-space",    name: "Deep Space",    swatch: "linear-gradient(135deg,#16163a,#7b61ff)" },
  { id: "neon-terminal", name: "Neon Terminal", swatch: "linear-gradient(135deg,#07241a,#00ff88)" },
  { id: "sunset-neon",   name: "Sunset Neon",   swatch: "linear-gradient(135deg,#3a0f2a,#ff6b35)" },
  { id: "arctic",        name: "Arctic",        swatch: "linear-gradient(135deg,#07203a,#00c8ff)" },
];

/* ----------------------------------- state ----------------------------------- */
let DATA = DEMO_DATA;
let IS_DEMO = true;
const windows = new Map();   // id -> { el, taskBtn, minimized, maximized, prevRect }
let zTop = 10;
let cascade = 0;

/* DOM refs */
const wrapper    = $("#wrapper");
const desktopEl  = $("#desktop");
const layer      = $("#window-layer");
const tasksEl    = $("#tasks");
const startBtn   = $("#start-button");
const startMenu  = $("#start-menu");
const startItems = $("#start-items");
const clockEl    = $("#clock");
const toastEl    = $("#toast");

/* ============================================================================
   APP DEFINITIONS  — single source of truth for desktop icons, start menu,
   taskbar buttons and window contents. Each .win(data) returns window config.
   ========================================================================== */
const APPS = {
  "my-computer": {
    label: "My Computer", icon: "6a2e702f80acff4aabb01c3b_ic-my-computer.png", emoji: "🖥️",
    win: (d) => {
      const p = d.profile;
      return {
        title: "My Computer", w: 510, h: 450,
        menu: ["File", "Edit", "View", "Help"],
        status: [`${Object.keys(APPS).length} object(s)`, `Source: ${esc(d.source)}`],
        html: `
          <div class="sys-head">
            <div class="sys-badge">🖥️</div>
            <div>
              <p class="sys-name">${esc(p.dominant_theme || "Unprofiled PC")}</p>
              <p class="sys-sub">Your viewing profile, summarised</p>
            </div>
          </div>
          <dl class="prop-grid">
            <dt>Watch style</dt>   <dd><span class="chip">${esc(p.watch_style || "Unknown")}</span></dd>
            <dt>Videos analysed</dt><dd>${esc(d.video_count ?? "—")}</dd>
            <dt>Interests found</dt><dd>${(p.top_interests || []).length}</dd>
            <dt>Data source</dt>   <dd>${esc(d.source || "—")}</dd>
            <dt>Last generated</dt><dd>${esc(d.generated_at || "—")}</dd>
          </dl>`,
      };
    },
  },

  "interests": {
    label: "Top Interests", icon: "6a2e702f80acff4aabb01c41_ic-programs.png", emoji: "📊",
    win: (d) => {
      const items = d.profile.top_interests || [];
      const body = items.length
        ? items.map((it) => `
            <div class="interest-card">
              <div class="interest-head">
                <span class="emoji">${esc(it.emoji || "📺")}</span>
                <span class="category">${esc(it.category || "Unknown")}</span>
                <span class="conf">${clamp(Number(it.confidence) || 0, 0, 100)}%</span>
              </div>
              <div class="bar-track"><div class="bar-fill" data-fill="${clamp(Number(it.confidence) || 0, 0, 100)}"></div></div>
              <p class="reason">${esc(it.reason || "")}</p>
            </div>`).join("")
        : emptyState("No interests detected", "The profiler needs more watch history. Scroll your feed, then run", "python backend.py");
      return {
        title: "Top Interests", w: 590, h: 580,
        menu: ["File", "View", "Help"],
        status: [`${items.length} interest(s)`],
        html: `<p class="section-title">Detected interests</p>${body}`,
      };
    },
  },

  "passion": {
    label: "Hidden Passion", icon: "6a2e702f80acff4aabb01c5c_ic-find.png", emoji: "🔑",
    win: (d) => {
      const p = d.profile;
      return {
        title: "Hidden Passion", w: 540, h: 400,
        menu: ["File", "Help"],
        html: `
          <p class="lead">Something the algorithm noticed that you might not have:</p>
          <div class="passion-box">
            <p>${esc(p.hidden_passion || "Not enough signal yet — keep watching and run the profiler again.")}</p>
            <span class="passion-tag">Inferred from ${esc(d.video_count ?? 0)} videos · ${esc(p.dominant_theme || "")}</span>
          </div>`,
      };
    },
  },

  "about": {
    label: "About You", icon: "6a2e702f80acff4aabb01c5b_ic-documents.png", emoji: "📝",
    win: (d) => {
      const p = d.profile;
      const paras = String(p.personality_summary || "No summary available.")
        .split(/\n+/).map((t) => `<p>${esc(t)}</p>`).join("");
      const pills = (p.sample_titles || []).map((t) => `<span class="pill">${esc(t)}</span>`).join("");
      return {
        title: "About You.txt — Notepad", w: 600, h: 465,
        menu: ["File", "Edit", "Search", "Help"],
        html: `
          <div class="notepad">${paras}</div>
          ${pills ? `<p class="section-title" style="margin-top:14px">Representative clips</p><div class="pill-row">${pills}</div>` : ""}`,
      };
    },
  },

  "history": {
    label: "Watch History", icon: "6a2e702f80acff4aabb01c4e_ic-monitor.png", emoji: "📺",
    win: (d) => {
      const titles = d.titles || [];
      const rows = titles.length
        ? `<div class="explorer-list">${titles.map((t) =>
            `<div class="explorer-row selectable"><span class="row-ico">📄</span><span>${esc(t)}</span></div>`).join("")}</div>`
        : emptyState("History is empty", "No titles were scraped. Run", "python backend.py");
      return {
        title: "Watch History", w: 635, h: 520,
        menu: ["File", "Edit", "View", "Help"],
        status: [`${titles.length} clip(s)`, `Source: ${esc(d.source)}`],
        html: rows,
      };
    },
  },

  "display": {
    label: "Display Properties", icon: "6a2e702f80acff4aabb01c50_ic-settings.png", emoji: "🎨",
    win: () => ({
      title: "Display Properties", w: 435, h: 545,
      html: `
        <p class="section-title">Background</p>
        <div class="monitor">
          <div class="monitor-screen"></div>
          <div class="monitor-stand"></div>
          <div class="monitor-base"></div>
        </div>
        <div class="theme-list" role="radiogroup" aria-label="Desktop theme">
          ${THEMES.map((t) => `
            <div class="theme-opt" role="radio" tabindex="0" data-theme-id="${t.id}"
                 aria-checked="${document.body.dataset.theme === t.id}">
              <span class="radio" aria-hidden="true"></span>
              <span class="theme-swatch" style="background:${t.swatch}"></span>
              <span>${esc(t.name)}</span>
            </div>`).join("")}
        </div>
        <div class="btn-row">
          <button class="btn" data-act="ok">OK</button>
          <button class="btn" data-act="close">Cancel</button>
        </div>`,
    }),
    after: (win) => {
      const choose = (id) => {
        document.body.dataset.theme = id;
        win.querySelectorAll(".theme-opt").forEach((o) =>
          o.setAttribute("aria-checked", String(o.dataset.themeId === id)));
      };
      win.querySelectorAll(".theme-opt").forEach((o) => {
        o.addEventListener("click", () => choose(o.dataset.themeId));
        o.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(o.dataset.themeId); }
        });
      });
      win.querySelector('[data-act="ok"]').addEventListener("click", () => closeWindow("display"));
      win.querySelector('[data-act="close"]').addEventListener("click", () => closeWindow("display"));
    },
  },

  "recycle": {
    label: "Recycle Bin", icon: "6a2e702f80acff4aabb01c4b_ic-recycle-bin.png", emoji: "🗑️",
    win: () => ({
      title: "Recycle Bin", w: 520, h: 360,
      menu: ["File", "Edit", "View", "Help"],
      status: ["3 item(s)"],
      html: `
        <p class="lead muted">To find your real patterns, the profiler ignores one-off,
        random videos. Here's the noise it filtered out:</p>
        <div class="explorer-list">
          <div class="explorer-row"><span class="row-ico">🗑️</span><span>random_5min_lifehack.tmp</span></div>
          <div class="explorer-row"><span class="row-ico">🗑️</span><span>that_one_news_clip.tmp</span></div>
          <div class="explorer-row"><span class="row-ico">🗑️</span><span>autoplay_accident.tmp</span></div>
        </div>`,
    }),
  },
};

const APP_ORDER = ["my-computer", "interests", "passion", "about", "history", "display", "recycle"];

function emptyState(title, line, code) {
  return `<div class="empty-state">
    <div class="big">📭</div>
    <p style="font-weight:700;margin:0 0 6px">${esc(title)}</p>
    <p style="margin:0">${esc(line)} <code>${esc(code)}</code></p>
  </div>`;
}

/* ============================================================================
   WINDOW MANAGER
   ========================================================================== */
function openApp(id) {
  closeStartMenu();
  const app = APPS[id];
  if (!app) return;
  if (windows.has(id)) { restoreWindow(id); return; }
  createWindow(id, app);
}

function createWindow(id, app) {
  const cfg = app.win(DATA);

  const win = el("div", "win-window is-animating");
  win.dataset.app = id;
  win.style.width = cfg.w + "px";
  win.style.height = cfg.h + "px";

  const menuHtml = cfg.menu
    ? `<div class="win-action-bar">${cfg.menu.map((m) =>
        `<span class="action-item"><span class="underline">${esc(m[0])}</span>${esc(m.slice(1))}</span>`).join("")}</div>`
    : "";
  const statusHtml = cfg.status
    ? `<div class="win-statusbar">${cfg.status.map((s, i) =>
        `<span class="${i === 0 ? "grow" : ""}">${s}</span>`).join("")}</div>`
    : "";

  win.innerHTML = `
    <div class="win-top-bar" data-drag>
      <span class="win-title"><span class="title-ico">${esc(app.emoji)}</span>${esc(cfg.title)}</span>
      <span class="window-icons">
        <button class="win-ctl min"   data-ctl="min"   title="Minimize" aria-label="Minimize"><span class="glyph">_</span></button>
        <button class="win-ctl max"   data-ctl="max"   title="Maximize" aria-label="Maximize"><span class="glyph">□</span></button>
        <button class="win-ctl close" data-ctl="close" title="Close"    aria-label="Close"><span class="glyph">✕</span></button>
      </span>
    </div>
    ${menuHtml}
    <div class="win-body"><div class="win-content">${cfg.html}</div></div>
    ${statusHtml}
    <div class="win-resize" data-resize></div>`;

  /* position: cascade from centre; first window / My Computer centred */
  const W = wrapper.clientWidth, H = wrapper.clientHeight;
  let x = Math.round((W - cfg.w) / 2) + cascade;
  let y = Math.round((H - 36 - cfg.h) / 2) + cascade;
  if (isSmall()) { y = 14 + cascade; }
  win.style.left = clamp(x, 4, Math.max(4, W - 80)) + "px";
  win.style.top  = clamp(y, 4, Math.max(4, H - 80)) + "px";
  cascade = (cascade + 26) % 130;

  layer.appendChild(win);

  /* taskbar button */
  const taskBtn = el("button", "task-button",
    `<span class="t-ico">${esc(app.emoji)}</span><span class="t-label">${esc(cfg.title)}</span>`);
  taskBtn.addEventListener("click", () => {
    const rec = windows.get(id);
    if (!rec) return;
    if (rec.minimized) restoreWindow(id);                    // hidden  → bring back
    else if (rec.el.classList.contains("__focused")) minimizeWindow(id); // focused → minimize
    else focusWindow(id);                                    // behind  → bring to front
  });
  tasksEl.appendChild(taskBtn);

  windows.set(id, { el: win, taskBtn, minimized: false, maximized: false, prevRect: null });

  /* wiring */
  win.addEventListener("pointerdown", () => focusWindow(id), true);
  win.querySelector('[data-ctl="min"]').addEventListener("click", (e) => { e.stopPropagation(); minimizeWindow(id); });
  win.querySelector('[data-ctl="max"]').addEventListener("click", (e) => { e.stopPropagation(); toggleMax(id); });
  win.querySelector('[data-ctl="close"]').addEventListener("click", (e) => { e.stopPropagation(); closeWindow(id); });

  const bar = win.querySelector("[data-drag]");
  bar.addEventListener("dblclick", () => toggleMax(id));
  makeDraggable(id, win, bar);
  makeResizable(id, win, win.querySelector("[data-resize]"));

  if (app.after) app.after(win);

  /* animate confidence bars in */
  requestAnimationFrame(() => {
    win.querySelectorAll(".bar-fill[data-fill]").forEach((b) => { b.style.width = b.dataset.fill + "%"; });
  });
  win.addEventListener("animationend", () => win.classList.remove("is-animating"), { once: true });

  focusWindow(id);
}

function focusWindow(id) {
  const rec = windows.get(id);
  if (!rec) return;
  zTop += 1;
  rec.el.style.zIndex = zTop;
  windows.forEach((r, key) => {
    const active = key === id;
    r.el.classList.toggle("is-inactive", !active);
    r.el.classList.toggle("__focused", active);
    r.taskBtn.classList.toggle("is-active", active && !r.minimized);
  });
}

function minimizeWindow(id) {
  const rec = windows.get(id);
  if (!rec) return;
  rec.minimized = true;
  rec.el.hidden = true;
  rec.el.classList.remove("__focused");
  rec.taskBtn.classList.remove("is-active");
  focusTopVisible();
}

function restoreWindow(id) {
  const rec = windows.get(id);
  if (!rec) return;
  rec.minimized = false;
  rec.el.hidden = false;
  focusWindow(id);
}

function toggleMax(id) {
  const rec = windows.get(id);
  if (!rec) return;
  if (rec.maximized) {
    rec.maximized = false;
    rec.el.classList.remove("is-maximized");
    if (rec.prevRect) Object.assign(rec.el.style, rec.prevRect);
  } else {
    rec.maximized = true;
    rec.prevRect = { left: rec.el.style.left, top: rec.el.style.top, width: rec.el.style.width, height: rec.el.style.height };
    rec.el.classList.add("is-maximized");
  }
  focusWindow(id);
}

function closeWindow(id) {
  const rec = windows.get(id);
  if (!rec) return;
  rec.el.remove();
  rec.taskBtn.remove();
  windows.delete(id);
  focusTopVisible();
}

function focusTopVisible() {
  let top = null, topZ = -1;
  windows.forEach((r, key) => {
    if (!r.minimized && +r.el.style.zIndex > topZ) { topZ = +r.el.style.zIndex; top = key; }
  });
  if (top) focusWindow(top);
}

/* ----------------------------------- drag ----------------------------------- */
function makeDraggable(id, win, handle) {
  let sx, sy, ox, oy, dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".win-ctl")) return;
    const rec = windows.get(id);
    if (rec.maximized || isSmall()) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    ox = win.offsetLeft; oy = win.offsetTop;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const W = wrapper.clientWidth, H = wrapper.clientHeight;
    win.style.left = clamp(ox + e.clientX - sx, -win.offsetWidth + 80, W - 80) + "px";
    win.style.top  = clamp(oy + e.clientY - sy, 0, H - 56) + "px";
  });
  const end = (e) => { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch (_) {} };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

/* ----------------------------------- resize ----------------------------------- */
function makeResizable(id, win, grip) {
  let sx, sy, ow, oh, resizing = false;
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const rec = windows.get(id);
    if (rec.maximized || isSmall()) return;
    e.stopPropagation();
    resizing = true;
    sx = e.clientX; sy = e.clientY;
    ow = win.offsetWidth; oh = win.offsetHeight;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    win.style.width  = clamp(ow + e.clientX - sx, 220, wrapper.clientWidth - win.offsetLeft - 4) + "px";
    win.style.height = clamp(oh + e.clientY - sy, 140, wrapper.clientHeight - win.offsetTop - 4) + "px";
  });
  const end = (e) => { resizing = false; try { grip.releasePointerCapture(e.pointerId); } catch (_) {} };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

/* ============================================================================
   DESKTOP ICONS + START MENU + TASKBAR CHROME
   ========================================================================== */
function buildDesktop() {
  desktopEl.innerHTML = "";
  APP_ORDER.forEach((id) => {
    const app = APPS[id];
    const icon = el("button", "icon-block");
    icon.type = "button";
    icon.dataset.app = id;
    icon.setAttribute("aria-pressed", "false");
    icon.innerHTML =
      `<img class="win-icon" src="assets/${app.icon}" alt="" data-emoji="${esc(app.emoji)}" />
       <span class="icon-text">${esc(app.label)}</span>`;
    attachIconFallback(icon.querySelector("img"));

    const open = () => openApp(id);
    icon.addEventListener("click", () => (coarse ? open() : selectIcon(icon)));
    icon.addEventListener("dblclick", open);
    icon.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    desktopEl.appendChild(icon);
  });
}

function selectIcon(icon) {
  desktopEl.querySelectorAll(".icon-block").forEach((i) =>
    i.setAttribute("aria-pressed", String(i === icon)));
}

function attachIconFallback(img) {
  img.addEventListener("error", () => {
    const span = el("span", "icon-fallback", img.dataset.emoji || "📄");
    img.replaceWith(span);
  }, { once: true });
}

function buildStartMenu() {
  startItems.innerHTML = "";
  APP_ORDER.forEach((id) => {
    const app = APPS[id];
    const li = el("li", "menu-item-block");
    li.tabIndex = 0;
    li.innerHTML = `<span class="m-ico">${esc(app.emoji)}</span><span class="menu-item-text">${esc(app.label)}</span>`;
    const go = () => openApp(id);
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    startItems.appendChild(li);
  });
  startItems.appendChild(el("div", "menu-divider"));
  const shut = el("li", "menu-item-block");
  shut.tabIndex = 0;
  shut.innerHTML = `<span class="m-ico">⏻</span><span class="menu-item-text">Shut Down…</span>`;
  const doShut = () => { closeStartMenu(); shutDown(); };
  shut.addEventListener("click", doShut);
  shut.addEventListener("keydown", (e) => { if (e.key === "Enter") doShut(); });
  startItems.appendChild(shut);
}

function toggleStartMenu() {
  startMenu.hidden ? openStartMenu() : closeStartMenu();
}
function openStartMenu() {
  startMenu.hidden = false;
  startBtn.setAttribute("aria-expanded", "true");
}
function closeStartMenu() {
  startMenu.hidden = true;
  startBtn.setAttribute("aria-expanded", "false");
}

/* clock — taskbar tray, e.g. "4:20 PM" */
function tickClock() {
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  clockEl.textContent = `${h}:${m} ${ampm}`;
  clockEl.title = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/* shutdown screen */
function shutDown() {
  $("#shutdown").hidden = false;
}

/* ----------------------------------- toast ----------------------------------- */
function showToast(html) {
  toastEl.innerHTML = `<span>${html}</span><button class="t-x" aria-label="Dismiss">✕</button>`;
  toastEl.hidden = false;
  toastEl.querySelector(".t-x").addEventListener("click", () => (toastEl.hidden = true));
}

/* ============================================================================
   BOOT
   ========================================================================== */
async function loadData() {
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("no file");
    const d = await res.json();
    if (!d || !d.profile) throw new Error("bad shape");
    DATA = d; IS_DEMO = false;
  } catch (_) {
    DATA = DEMO_DATA; IS_DEMO = true;
  }
}

function bindGlobal() {
  startBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleStartMenu(); });
  startMenu.addEventListener("pointerdown", (e) => e.stopPropagation());

  // clicking empty desktop closes the menu and deselects icons
  wrapper.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".start-button") && !e.target.closest(".start-menu")) closeStartMenu();
    if (e.target === wrapper || e.target === desktopEl || e.target === layer) {
      desktopEl.querySelectorAll(".icon-block").forEach((i) => i.setAttribute("aria-pressed", "false"));
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeStartMenu();
  });

  $("#restart-btn").addEventListener("click", () => location.reload());
}

async function boot() {
  await loadData();
  buildDesktop();
  buildStartMenu();
  bindGlobal();
  tickClock();
  setInterval(tickClock, 1000);

  // open a window so the desktop isn't empty on arrival
  openApp("my-computer");

  if (IS_DEMO) {
    showToast(`Showing <b>demo data</b>. Run <code style="font-family:var(--font-mono)">backend.py</code> and serve over http to see your real profile.`);
  }
}

boot();
