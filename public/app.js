// PhishSense game logic (runs in the browser)

const ROUNDS = 5;        // rounds per mode
const TO_PASS = 4;       // correct answers needed for the badge
const PER_CORRECT = 100; // points per correct answer
const BADGES = { easy: "Minnow", medium: "Angler", hard: "Captain" };
const ALL_MODES = ["easy", "medium", "hard"];

// Badge icons: simple inline SVGs drawn in currentColor, so each one takes
// its difficulty color from CSS (.tier-easy green, .tier-medium yellow, .tier-hard red).
const BADGE_SVG = {
  // Minnow: a small fish
  easy: `<ellipse cx="13.5" cy="12" rx="7.5" ry="4.8" fill="currentColor"/>
    <path d="M7 12 1.5 7v10z" fill="currentColor"/>
    <circle cx="17" cy="10.8" r="1.1" fill="#0a1a33"/>`,
  // Angler: a fishing rod with its line and hook
  medium: `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 21 19 3" stroke-width="2.4"/>
    <circle cx="7" cy="16.5" r="2.2" stroke-width="2"/>
    <path d="M19 3v11.5" stroke-width="1.3"/>
    <path d="M19 14.5v2.3a2.2 2.2 0 0 1-4.4 0v-.8" stroke-width="2"/></g>`,
  // Captain: an anchor
  hard: `<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="4.6" r="2.2"/>
    <path d="M12 6.8V21M8 10h8M4.5 13.5c0 4.3 3.2 7.5 7.5 7.5s7.5-3.2 7.5-7.5"/>
    <path d="M2.5 15.5l2-2 2 2M17.5 15.5l2-2 2 2"/></g>`,
};
const badgeIcon = (m) =>
  `<svg class="badge-icon tier-${m}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${BADGE_SVG[m]}</svg>`;
// Icon + name, e.g. for "You earned [fish] Minnow!"
const badgeLabel = (m) => `<span class="badge-label tier-${m}">${badgeIcon(m)}${BADGES[m]}</span>`;

// Fill every placeholder like <span data-badge-icon="easy"> (the difficulty buttons)
document.querySelectorAll("[data-badge-icon]").forEach((el) => (el.innerHTML = badgeIcon(el.dataset.badgeIcon)));
const MISSIONS = {
  easy: "Warm-up shift. These scams are obvious: watch for typos, surprise prizes, and ALL CAPS urgency.",
  medium: "Scammers are getting smarter. Check every sender address and phone number against the real ones above.",
  hard: "Expert level. Some scams look perfect, and some real emails look scary. Read every detail before you decide.",
};

// The real addresses players check every message against.
const TRUSTED = [
  { name: "Bayline Energy", note: "your company", domain: "bayline-energy.com", phone: "(404) 555-0100" },
  { name: "NewsNow", domain: "newsnow.com" },
  { name: "ConnectPro", domain: "connectpro.com" },
  { name: "TechHub", domain: "techhub.com" },
];

let mode, round, correct, current, seen;
let results;  // one entry per round: true (correct) or false (wrong)
let streak;   // correct answers in a row, resets on a wrong answer
let missed;   // every red flag from the rounds the player got wrong

const $ = (id) => document.getElementById(id);
const show = (id) => {
  ["start-screen", "mission-screen", "play-screen", "end-screen"].forEach((s) => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
  // style.css uses this to pick the big header or the slim top bar,
  // and to show the leaderboard only on the home and end screens.
  document.body.dataset.screen = id;
  window.scrollTo(0, 0);
};
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Players who ask for less motion get the same game with the animations off.
const calmMode = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Talking to the backend ----------
// Practice mode: if the backend isn't running (opened as a file, Live Server,
// or a static host like Vercel), the game uses mock-data.js instead.
let OFFLINE = location.protocol === "file:";

async function checkBackend() {
  if (OFFLINE) return;
  try {
    const r = await fetch("/api/leaderboard");
    if (!r.ok) throw new Error("no backend");
    await r.json();
  } catch (e) {
    OFFLINE = true;
  }
}

async function apiGetScenario(mode, seen) {
  if (OFFLINE) {
    const pool = MOCK_SCENARIOS.filter((s) => s.difficulty === mode && !seen.includes(s.scenario_id));
    const s = pool[Math.floor(Math.random() * pool.length)];
    return { scenario_id: s.scenario_id, channel: s.channel, sender: s.sender, subject: s.subject, body: s.body, link: s.link };
  }
  return fetch(`/api/scenario?mode=${mode}&seen=${seen.join(",")}`).then((r) => r.json());
}

async function apiAnswer(scenario_id, guess) {
  if (OFFLINE) {
    const s = MOCK_SCENARIOS.find((x) => x.scenario_id === scenario_id);
    return { correct: guess === s.game_answer, game_answer: s.game_answer, red_flags: s.red_flags, explanation: s.explanation };
  }
  return fetch("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario_id, guess }),
  }).then((r) => r.json());
}

async function apiSaveScore(username, points, badge) {
  if (OFFLINE) {
    const board = JSON.parse(localStorage.getItem("ps-board") || "{}");
    const p = board[username] || { username, total_score: 0, badges: [] };
    p.total_score += points;
    if (badge && !p.badges.includes(badge)) p.badges.push(badge);
    board[username] = p;
    try { localStorage.setItem("ps-board", JSON.stringify(board)); } catch (e) {}
    return p;
  }
  return fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, points, badge }),
  }).then((r) => r.json());
}

async function apiLeaderboard() {
  if (OFFLINE) {
    let board = {};
    try { board = JSON.parse(localStorage.getItem("ps-board") || "{}"); } catch (e) {}
    return Object.values(board)
      .sort((a, b) => b.badges.length - a.badges.length || b.total_score - a.total_score)
      .slice(0, 10);
  }
  return fetch("/api/leaderboard").then((r) => r.json());
}

// ---------- Trusted contacts ----------
// One list, shown on the mission briefing and in the panel during play.
function contactsHTML() {
  const rows = TRUSTED.map((c) => `<tr>
      <th scope="row">${esc(c.name)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</th>
      <td><span class="contact-domain">${esc(c.domain)}</span>${c.phone ? `<span class="contact-phone">${esc(c.phone)}</span>` : ""}</td>
    </tr>`).join("");
  return `<table class="contacts-table">
      <thead><tr><th scope="col">Company</th><th scope="col">Real website &amp; phone</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="contacts-tip">Scammers use names you trust with addresses that don't match. Always compare.</p>`;
}
document.querySelectorAll(".contacts-list").forEach((el) => (el.innerHTML = contactsHTML()));

function setContactsOpen(open) {
  $("contacts-panel").classList.toggle("hidden", !open);
  $("btn-contacts").setAttribute("aria-expanded", String(open));
  $("btn-contacts").classList.toggle("open", open);
}
$("btn-contacts").addEventListener("click", () =>
  setContactsOpen($("contacts-panel").classList.contains("hidden")));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("contacts-panel").classList.contains("hidden")) {
    setContactsOpen(false);
    $("btn-contacts").focus();
  }
});

// ---------- Start: pick a difficulty, then see the mission ----------
document.querySelectorAll(".mode").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (!$("username").value.trim()) return $("username").focus();
    mode = btn.dataset.mode;
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    $("mission-mode").className = `mission-mode tier-${mode}`;
    $("mission-mode").innerHTML = `${label} mode · ${badgeIcon(mode)}${BADGES[mode]} badge`;
    $("mission-tip").textContent = MISSIONS[mode];
    show("mission-screen");
  })
);

$("btn-back").addEventListener("click", () => show("start-screen"));

$("btn-start").addEventListener("click", () => {
  round = 0;
  correct = 0;
  seen = [];
  results = [];
  streak = 0;
  missed = [];
  $("recap").classList.add("hidden");
  $("badge-reveal").classList.add("hidden");
  $("confetti").innerHTML = "";
  setContactsOpen(false);
  show("play-screen");
  nextRound();
});

// ---------- Progress dots + streak ----------
function renderDots() {
  let html = "";
  for (let i = 0; i < ROUNDS; i++) {
    let cls = "";
    if (results[i] === true) cls = "correct";
    else if (results[i] === false) cls = "wrong";
    else if (i === round - 1) cls = "current";
    html += `<span class="dot ${cls}"></span>`;
  }
  $("dots").innerHTML = html;
  $("dots").setAttribute("aria-label", `Round ${Math.min(round, ROUNDS)} of ${ROUNDS}, ${correct} correct`);
}

// Only worth celebrating from 2 in a row; the label stays hidden until then.
function renderStreak() {
  $("streak").textContent = streak >= 2 ? `🔥 ${streak} in a row` : "";
}

// ---------- Play ----------
async function nextRound() {
  await ready;
  round++;
  $("progress").textContent = `${mode.toUpperCase()} · Round ${round} of ${ROUNDS} · ${correct} correct`;
  $("result").classList.add("hidden");
  $("btn-next").classList.add("hidden");
  $("btn-phish").disabled = $("btn-legit").disabled = true;
  $("message").className = "ps-card";   // clears the glow or shake from the last round
  $("message").style.transformOrigin = "";
  $("pop-layer").innerHTML = "";
  $("reaction").className = "reaction hidden";
  $("reaction").textContent = "";
  hidePeek();
  renderDots();
  renderStreak();
  $("message").innerHTML = `<p class="loading">Loading message...</p>`;

  current = await apiGetScenario(mode, seen);
  seen.push(current.scenario_id);
  $("message").innerHTML = renderMessage(current);
  $("btn-phish").disabled = $("btn-legit").disabled = false;
}

// A steady clock time per scenario, so the inbox and phone look real
// without the time jumping around every time you re-read a message.
function clockFor(s) {
  const id = Math.abs(Number(s.scenario_id) || 0);
  const hour24 = 8 + ((id * 3) % 9);          // 8 AM to 4 PM
  const minute = String((id * 17) % 60).padStart(2, "0");
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { short: `${hour12}:${minute}`, long: `${hour12}:${minute} ${hour24 < 12 ? "AM" : "PM"}` };
}

const initialOf = (sender) => {
  const m = String(sender || "").match(/[a-z]/i);
  return m ? m[0].toUpperCase() : "?";
};

// ---------- Hover to inspect links ----------
// Emails hide the real address behind friendly text, the way real phishing
// does. Hovering (or tapping) shows where the link really goes. The link is a
// plain button, so it can never open anything.
const LINK_LABELS = [
  [/\.exe|download|update/i, "Download the update"],
  [/claim|winner|prize|reward/i, "Claim your reward"],
  [/sign-?in|log-?in/i, "Sign in to your account"],
  [/verify/i, "Verify your account"],
  [/confirm/i, "Confirm now"],
  [/billing|invoice|payment/i, "View billing details"],
  [/video|watch/i, "Watch now"],
  [/story|news|article/i, "Read the full story"],
];

function parseLink(raw) {
  const text = String(raw || "").trim();
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
    const host = u.hostname;
    const parts = host.split(".");
    const domain = parts.length > 2 ? parts.slice(-2).join(".") : host;
    return {
      scheme: `${u.protocol}//`,
      sub: host.slice(0, host.length - domain.length), // e.g. "newsnow.com."
      domain,                                          // the site you really land on
      rest: u.pathname === "/" && !u.search ? "" : u.pathname + u.search,
    };
  } catch (e) {
    return { scheme: "", sub: "", domain: text, rest: "" };
  }
}

function linkLabel(s) {
  if (s.link_text) return s.link_text;
  const { rest } = parseLink(s.link);
  const hit = LINK_LABELS.find(([re]) => re.test(rest)) || LINK_LABELS.find(([re]) => re.test(s.link));
  return hit ? hit[1] : "Open link";
}

function renderLink(s) {
  if (!s.link) return "";
  const hint = `<span class="link-hint"><span class="hint-hover">Hover</span><span class="hint-tap">Tap</span> to inspect</span>`;
  if (s.channel === "sms") {
    // Texts show the raw address, but tapping it still previews the real site.
    return `<p class="link"><button type="button" class="link-chip" data-href="${esc(s.link)}">${esc(s.link)}</button>${hint}</p>`;
  }
  return `<p class="link"><button type="button" class="link-chip" data-href="${esc(s.link)}">🔗 ${esc(linkLabel(s))}</button>${hint}</p>`;
}

const peek = document.createElement("div");
peek.id = "link-peek";
peek.className = "link-peek";
peek.setAttribute("role", "tooltip");
peek.hidden = true;
document.body.appendChild(peek);

let peekFor = null;     // the link the popup belongs to
let peekPinned = false; // true after a tap or click, so it stays open

function showPeek(chip) {
  const p = parseLink(chip.dataset.href);
  peek.innerHTML = `
    <p class="peek-title">🔍 This link really goes to:</p>
    <p class="peek-url">${esc(p.scheme)}${p.sub ? `<span class="peek-sub">${esc(p.sub)}</span>` : ""}<b class="peek-domain">${esc(p.domain)}</b>${esc(p.rest)}</p>
    <p class="peek-tip">The real site is the last part of the address, right before the first /</p>`;
  peek.hidden = false;
  if (peekFor && peekFor !== chip) peekFor.removeAttribute("aria-describedby");
  peekFor = chip;
  chip.setAttribute("aria-describedby", "link-peek");
  placePeek();
}

function hidePeek() {
  peek.hidden = true;
  peekPinned = false;
  if (peekFor) peekFor.removeAttribute("aria-describedby");
  peekFor = null;
}

// Always open ABOVE the link, so it never covers the Phish / Legit buttons
// below the message (one column). On wide screens the buttons sit to the
// right of the message, so the popup also stays inside the message column.
// If the link is too close to the top of the screen, scroll up to make room.
function placePeek() {
  if (!peekFor || peek.hidden) return;
  if (!document.body.contains(peekFor)) return hidePeek();
  const gap = 8, edge = 12;
  const column = $("message").getBoundingClientRect();
  peek.style.maxWidth = `${Math.max(200, Math.min(360, column.width, window.innerWidth - 2 * edge))}px`;
  const w = peek.offsetWidth, h = peek.offsetHeight;
  let r = peekFor.getBoundingClientRect();
  const short = edge - (r.top - gap - h);
  if (short > 0 && window.scrollY > 0) {
    window.scrollBy(0, -Math.min(short, window.scrollY));
    r = peekFor.getBoundingClientRect();
  }
  const right = Math.min(window.innerWidth - edge, column.right);
  const top = Math.max(edge, r.top - gap - h);
  const left = Math.min(Math.max(edge, r.left), right - w);
  peek.style.top = `${top}px`;
  peek.style.left = `${Math.max(edge, left)}px`;
}

const chipFrom = (e) => e.target.closest?.(".link-chip");

document.addEventListener("mouseover", (e) => {
  const chip = chipFrom(e);
  if (chip && !peekPinned) showPeek(chip);
});
document.addEventListener("mouseout", (e) => {
  const chip = chipFrom(e);
  if (chip && !peekPinned && !chip.contains(e.relatedTarget)) hidePeek();
});
document.addEventListener("focusin", (e) => {
  const chip = chipFrom(e);
  if (chip) showPeek(chip);
});
document.addEventListener("focusout", (e) => {
  if (chipFrom(e) && !peekPinned) hidePeek();
});
document.addEventListener("click", (e) => {
  const chip = chipFrom(e);
  if (chip) {
    e.preventDefault();
    if (peekPinned && peekFor === chip) return hidePeek();
    showPeek(chip);
    peekPinned = true;
  } else if (peekPinned && !peek.contains(e.target)) {
    hidePeek();
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePeek(); });
window.addEventListener("scroll", placePeek, { passive: true });
window.addEventListener("resize", placePeek);

function renderMessage(s) {
  const link = renderLink(s);
  const clock = clockFor(s);

  if (s.channel === "sms") {
    return `<div class="sms">
      <div class="status-bar">
        <span class="sb-time">${esc(clock.short)}</span>
        <span class="sb-right">
          <span class="signal" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span class="battery" aria-hidden="true"><span class="bat-fill"></span></span>
        </span>
      </div>
      <p class="label">💬 Text message from <b>${esc(s.sender)}</b></p>
      <p class="bubble">${esc(s.body)}</p>${link}</div>`;
  }

  return `<div class="email">
    <div class="email-head">
      <div class="avatar" aria-hidden="true">${esc(initialOf(s.sender))}</div>
      <div class="email-who">
        <p class="from"><b>From:</b> ${esc(s.sender)}</p>
        <p class="subject">${esc(s.subject || "(no subject)")}</p>
      </div>
      <p class="email-time">${esc(clock.long)}</p>
    </div>
    <p class="body">${esc(s.body)}</p>${link}
    <div class="email-actions">
      <button type="button" disabled>↩ Reply</button>
      <button type="button" disabled>↪ Forward</button>
    </div>
  </div>`;
}

// Red flags arrive as one string with semicolons between them.
function flagList(red_flags) {
  const parts = Array.isArray(red_flags) ? red_flags : String(red_flags || "").split(";");
  return parts.map((f) => String(f).trim()).filter(Boolean);
}

function floatScore(text) {
  if (calmMode()) return;
  const bit = document.createElement("span");
  bit.className = "pop-score";
  bit.textContent = text;
  $("pop-layer").appendChild(bit);
  setTimeout(() => bit.remove(), 1500);
}

// ---------- Answer reactions: hooked, dodged, too cautious, safe ----------
const REACTIONS = {
  hooked:   "🎣 You got hooked!",
  dodged:   "✅ You dodged the hook!",
  cautious: "🤔 Too cautious! This one was safe.",
  safe:     "✅ Correct, this one's safe.",
};

// Which of the 4 reactions fits: the real answer vs. the player's guess.
function reactionFor(r, guess) {
  const real = String(r.game_answer || "").toLowerCase();
  const said = guess.toLowerCase();
  if (real === "phish") return said === "phish" ? "dodged" : "hooked";
  if (real === "legit") return said === "legit" ? "safe" : "cautious";
  return r.correct ? "safe" : "hooked";
}

function showReaction(kind) {
  const el = $("reaction");
  el.textContent = REACTIONS[kind];
  el.className = `reaction ${kind}`;
}

// The hook and line, drawn as inline SVG (a dark outline under a light
// stroke, so it shows up over both the navy page and the white email).
const HOOK_SVG = `<svg class="hook" width="34" height="48" viewBox="0 0 34 48" aria-hidden="true">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="#0a1a33" stroke-width="5.5"><circle cx="20" cy="5" r="3.5"/><path d="M20 8.5V32a9 9 0 0 1-18 0v-8l5 5"/></g>
    <g stroke="#e9f1f7" stroke-width="3"><circle cx="20" cy="5" r="3.5"/><path d="M20 8.5V32a9 9 0 0 1-18 0v-8l5 5"/></g>
  </g>
</svg>`;

// The rig hangs from the top of the visible screen. It lives in page
// coordinates, so it stays lined up with the card even if the page scrolls.
function makeRig(x, drop) {
  const rig = document.createElement("div");
  rig.className = "hook-rig";
  rig.setAttribute("aria-hidden", "true");
  rig.style.left = `${x + window.scrollX}px`;
  rig.style.top = `${window.scrollY}px`;
  rig.style.setProperty("--drop", `${drop}px`);
  rig.innerHTML = `<span class="hook-line"></span>${HOOK_SVG}`;
  document.body.appendChild(rig);
  return rig;
}

const done = (anim) => anim.finished.catch(() => {});

// Where the hook should aim: the top of the visible part of the message.
function cardTarget() {
  const card = $("message");
  const box = (card.firstElementChild || card).getBoundingClientRect();
  return { card, box, top: Math.max(box.top, 12), x: box.left + box.width / 2 };
}

// Phish, player said Legit: the hook drops, bites, and yanks the card away.
async function playHooked() {
  const { card, box, top, x } = cardTarget();
  const drop = Math.max(top - 26, 4);   // hook's bend lands just inside the card's top edge
  const above = drop + 60;              // far enough up to start off screen
  const lift = box.bottom + 80;         // far enough up to leave the screen
  const rig = makeRig(x, drop);
  const pull = "cubic-bezier(0.55, 0, 0.8, 0.2)";

  card.classList.add("hook-anim");
  card.style.transformOrigin = `50% ${top - card.getBoundingClientRect().top + 14}px`;

  const opts = { duration: 1250, fill: "forwards" };
  const rigAnim = rig.animate([
    { transform: `translateY(${-above}px)`, easing: "cubic-bezier(0.3, 0.6, 0.4, 1)" },
    { transform: "translateY(0px)", offset: 0.34 },
    { transform: "translateY(7px)", offset: 0.42 },
    { transform: "translateY(0px)", offset: 0.5, easing: pull },
    { transform: `translateY(${-lift}px)` },
  ], opts);
  const cardAnim = card.animate([
    { transform: "translateY(0px) rotate(0deg)" },
    { transform: "translateY(0px) rotate(0deg)", offset: 0.34 },
    { transform: "translateY(7px) rotate(0deg)", offset: 0.42 },
    { transform: "translateY(0px) rotate(-2deg)", offset: 0.5, easing: pull },
    { transform: `translateY(${-lift}px) rotate(-4deg)` },
  ], opts);

  await Promise.all([done(rigAnim), done(cardAnim)]);
  rig.remove();

  // Bring the message back so the player can read it next to the explanation.
  const back = card.animate(
    [{ opacity: 0, transform: "translateY(-12px)" }, { opacity: 1, transform: "none" }],
    { duration: 280, easing: "ease-out" }
  );
  cardAnim.cancel();
  done(back).then(() => card.classList.remove("hook-anim"));
}

// Phish, player said Phish: the hook swings down, the card ducks, the hook misses.
async function playDodged() {
  const { card, top, x } = cardTarget();
  const drop = Math.max(top - 36, 4);   // would just graze the card if it stayed put
  const above = drop + 60;
  const rig = makeRig(x, drop);

  card.classList.add("hook-anim");

  const opts = { duration: 1100 };
  const rigAnim = rig.animate([
    { transform: `translateY(${-above}px) rotate(0deg)`, easing: "ease-out" },
    { transform: "translateY(0px) rotate(0deg)", offset: 0.3 },
    { transform: "translateY(0px) rotate(4deg)", offset: 0.42 },
    { transform: "translateY(0px) rotate(-3deg)", offset: 0.54 },
    { transform: "translateY(0px) rotate(0deg)", offset: 0.64, easing: "ease-in" },
    { transform: `translateY(${-above}px) rotate(0deg)` },
  ], { ...opts, fill: "forwards" });
  const cardAnim = card.animate([
    { transform: "translateY(0px) scale(1)" },
    { transform: "translateY(0px) scale(1)", offset: 0.16 },
    { transform: "translateY(18px) scale(0.98)", offset: 0.3 },
    { transform: "translateY(18px) scale(0.98)", offset: 0.62 },
    { transform: "translateY(0px) scale(1)", offset: 0.82 },
    { transform: "translateY(0px) scale(1)" },
  ], opts);

  await Promise.all([done(rigAnim), done(cardAnim)]);
  rig.remove();
  card.classList.remove("hook-anim");
}

let answering = false;

async function answer(guess) {
  if (answering) return;   // ignore double clicks while a reaction plays
  answering = true;
  $("btn-phish").disabled = $("btn-legit").disabled = true;
  hidePeek();

  try {
    const r = await apiAnswer(current.scenario_id, guess);
    const kind = reactionFor(r, guess);

    results[round - 1] = !!r.correct;
    if (r.correct) {
      correct++;
      streak++;
    } else {
      streak = 0;
      flagList(r.red_flags).forEach((f) => missed.push(f));
    }
    renderDots();
    renderStreak();
    showReaction(kind);

    // Hook animations (skipped when the player asks for less motion).
    const animate = !calmMode() && typeof $("message").animate === "function";
    if (animate && kind === "hooked") await playHooked();
    if (animate && kind === "dodged") await playDodged();

    const msg = $("message");
    if (kind === "hooked") msg.classList.add("is-hooked");
    else if (kind === "cautious") msg.classList.add("is-cautious");
    else {
      msg.classList.add("is-correct");
      floatScore(`+${PER_CORRECT}`);
    }

    const flags = r.red_flags
      ? `<p><b>Red flags:</b></p><ul>${flagList(r.red_flags).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`
      : "";
    const went = current.link
      ? `<p class="link-reveal">🔍 That link really went to <b>${esc(parseLink(current.link).domain)}</b></p>`
      : "";
    const nudge = kind === "cautious"
      ? `<p class="gentle-tip">Being careful is a good habit! Before you report a message, check the sender and link against your trusted contacts.</p>`
      : "";
    $("result").innerHTML = `
      <h3>This one was <b>${esc(r.game_answer)}</b>.</h3>
      ${flags}<p>${esc(r.explanation)}</p>${went}${nudge}`;
    $("result").className = `ps-card ${kind === "hooked" ? "bad" : kind === "cautious" ? "gentle" : "good"}`;
    $("progress").textContent = `${mode.toUpperCase()} · Round ${round} of ${ROUNDS} · ${correct} correct`;
    $("btn-next").textContent = round < ROUNDS ? "Next" : "See results";
    $("btn-next").classList.remove("hidden");
  } finally {
    answering = false;
  }
}

$("btn-phish").addEventListener("click", () => answer("Phish"));
$("btn-legit").addEventListener("click", () => answer("Legit"));
$("btn-next").addEventListener("click", () => (round < ROUNDS ? nextRound() : finish()));

// ---------- Badge reveal ----------
const CONFETTI_COLORS = ["#2de0c4", "#3ddc84", "#ffd166", "#ff5d6c", "#8ecae6", "#ffffff"];

// Replays a CSS animation that has already run once this session.
function replayAnimation(el) {
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}

function burstConfetti() {
  const layer = $("confetti");
  layer.innerHTML = "";
  if (calmMode()) return;
  for (let i = 0; i < 30; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti-bit";
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    bit.style.setProperty("--dx", `${(Math.random() - 0.5) * 240}px`);
    bit.style.setProperty("--rot", `${Math.random() * 900 - 450}deg`);
    bit.style.animationDelay = `${Math.random() * 0.35}s`;
    bit.style.animationDuration = `${1.5 + Math.random()}s`;
    if (i % 3 === 0) bit.style.borderRadius = "50%";
    layer.appendChild(bit);
  }
  setTimeout(() => { layer.innerHTML = ""; }, 3200);
}

function revealBadge(isMaster) {
  $("badge-art").innerHTML = badgeIcon(mode);
  $("badge-name").textContent = BADGES[mode];
  $("badge-name").className = `badge-name tier-${mode}`;
  $("badge-reveal").classList.remove("hidden");
  replayAnimation($("badge-art"));
  replayAnimation($("badge-name"));

  if (isMaster) {
    $("badge-master").textContent = "🏆 PhishSense Master: all three badges earned!";
    $("badge-master").classList.remove("hidden");
    replayAnimation($("badge-master"));
  } else {
    $("badge-master").classList.add("hidden");
  }
  burstConfetti();
}

// No badge this run: a hook takes the badge's place at the top of the card
function showMissedBadge() {
  $("badge-art").textContent = "🪝";
  $("badge-name").textContent = "";
  $("badge-master").classList.add("hidden");
  $("confetti").innerHTML = "";
  $("badge-reveal").classList.remove("hidden");
  replayAnimation($("badge-art"));
}

// ---------- End of run ----------
function renderRecap() {
  // Group the same red flag together so repeats show as a count.
  const groups = new Map();
  missed.forEach((flag) => {
    const key = flag.toLowerCase().replace(/\s+/g, " ");
    const hit = groups.get(key);
    if (hit) hit.n++;
    else groups.set(key, { text: flag, n: 1 });
  });
  const items = [...groups.values()].sort((a, b) => b.n - a.n);

  $("recap").innerHTML = `<h3>Red flags you missed this run</h3>` + (items.length
    ? `<ul>${items.map((g) => `<li>${esc(g.text)}${g.n > 1 ? ` <span class="count">×${g.n}</span>` : ""}</li>`).join("")}</ul>`
    : `<p class="clean">You caught every red flag!</p>`);
  $("recap").classList.remove("hidden");
}

async function finish() {
  const passed = correct >= TO_PASS;
  const badge = passed ? mode : null;
  const player = await apiSaveScore($("username").value.trim(), correct * PER_CORRECT, badge);

  const owned = Array.isArray(player?.badges) ? player.badges : (passed ? [mode] : []);
  const isMaster = ALL_MODES.every((m) => owned.includes(m));

  $("end-title").innerHTML = passed ? `You earned ${badgeLabel(mode)}!` : `${correct} of ${ROUNDS} correct`;
  $("end-text").innerHTML = passed
    ? "Nice catch. Try the next mode!"
    : `You need ${TO_PASS} to earn ${badgeLabel(mode)}. Every round is new, so try again!`;

  if (passed) revealBadge(isMaster);
  else showMissedBadge();

  renderRecap();
  show("end-screen");
  loadLeaderboard();
}

$("btn-home").addEventListener("click", () => show("start-screen"));

// ---------- Leaderboard ----------
// The same list is shown on the home screen and the end screen.
async function loadLeaderboard() {
  const rows = await apiLeaderboard();
  const html = rows.length
    ? rows.map((p) => {
        const icons = p.badges.filter((m) => BADGES[m])
          .map((m) => `<span class="lb-badge" title="${BADGES[m]} badge">${badgeIcon(m)}</span>`).join("");
        const master = ALL_MODES.every((b) => p.badges.includes(b)) ? " 🏆" : "";
        return `<li><b>${esc(p.username)}</b> ${icons}${master} <span class="lb-score">${p.total_score} pts</span></li>`;
      }).join("")
    : '<li class="empty">No scores yet. Be the first!</li>';
  document.querySelectorAll(".leaderboard-list").forEach((el) => (el.innerHTML = html));
}

const ready = checkBackend();
ready.then(loadLeaderboard);
