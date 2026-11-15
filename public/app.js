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
  endTutorial();   // closing it this way doesn't count as seen
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

// Only switch to practice mode when there is no backend at all (network error,
// 404, or a static host returning HTML). If the backend is there but the
// database is down (500/502), stay online so the page shows an error instead
// of quietly showing scores saved only in this browser.
async function checkBackend() {
  if (OFFLINE) return;
  try {
    const r = await fetch("/api/leaderboard");
    if (r.status >= 500) return;
    if (!r.ok) throw new Error("no backend");
    await r.json();
  } catch (e) {
    OFFLINE = true;
  }
}

// Fetch JSON and throw on any HTTP error, so callers can show a message
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}

// Scenarios always come from memory (mock-data.js), not the database, so the
// game loop works whether or not the backend/database is reachable.
async function apiGetScenario(mode, seen) {
  const pool = MOCK_SCENARIOS.filter((s) => s.difficulty === mode && !seen.includes(s.scenario_id));
  const s = pool[Math.floor(Math.random() * pool.length)];
  return { scenario_id: s.scenario_id, channel: s.channel, sender: s.sender, subject: s.subject, body: s.body, link: s.link };
}

async function apiAnswer(scenario_id, guess) {
  const s = MOCK_SCENARIOS.find((x) => x.scenario_id === scenario_id);
  return { correct: guess === s.game_answer, game_answer: s.game_answer, red_flags: s.red_flags, explanation: s.explanation };
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

// Practice mode keeps scores in this browser only
function localBoard() {
  let board = {};
  try { board = JSON.parse(localStorage.getItem("ps-board") || "{}"); } catch (e) {}
  return Object.values(board);
}

// Leaderboard: rows from the scores table (most badges, then highest score)
async function apiLeaderboard() {
  if (OFFLINE) {
    return localBoard()
      .sort((a, b) => b.badges.length - a.badges.length || b.total_score - a.total_score)
      .slice(0, 50);   // same cap as the server
  }
  return getJson("/api/leaderboard");
}

// Masters: players in the scores table with all three badges
async function apiMasters() {
  if (OFFLINE) {
    return localBoard()
      .filter((p) => ALL_MODES.every((b) => p.badges.includes(b)))
      .sort((a, b) => b.total_score - a.total_score);
  }
  return getJson("/api/masters");
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
  relayoutTutorial();   // the panel pushes the message down on phones
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
    maybeStartMissionTutorial();   // new players: walk through the example inbox
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
    let cls = "", mark = "";
    if (results[i] === true) { cls = "correct"; mark = "✓"; }
    else if (results[i] === false) { cls = "wrong"; mark = "✗"; }
    else if (i === round - 1) cls = "current";
    html += `<span class="dot ${cls}" aria-hidden="true">${mark}</span>`;
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
  endTutorial();
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
  // Stay inside the message the link is in
  const column = (peekFor.closest(".email, .sms") || $("message")).getBoundingClientRect();
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

// ---------- Tutorial (mission screen) ----------
// Runs on the mission briefing, before "Start mission", using the example
// inbox there (never on the play screen). Six callouts, one at a time: sender,
// trusted contacts, link, Phish / Legit, progress dots, and the "?" button.
// It starts by itself for a new player; the "?" in the top bar replays it.
//
// The "seen it" flag is saved ONLY when the player finishes (Got it on the
// last tip) or skips (Skip tutorial, Escape, or "?" while it's open).
// Anything else that closes it (Start mission, Change difficulty) does not
// save, so it shows again next time they reach the briefing.
// It's remembered per player name, so every new player on the same browser
// (say, someone trying the game after you) gets it automatically.
const TUTORIAL_KEY = "ps-tutorial-seen-players";
const canHover = () => window.matchMedia("(hover: hover)").matches;
const inSample = (sel) => document.querySelector(`#sample-message ${sel}`);

// The example message: fictional, like every scenario.
$("sample-message").innerHTML = renderMessage({
  scenario_id: 7,
  channel: "email",
  sender: "it-desk@bayline-energy-support.net",
  subject: "Your password expires today",
  body: "Your Bayline Energy password expires in 2 hours. Sign in now to keep your account active.",
  link: "http://bayline-energy-support.net/sign-in",
});

// Each step falls back to something that exists, so a step is never skipped.
// The sound part of the last tip only shows once the game has a sound toggle (#btn-sound).
const TUTORIAL_STEPS = [
  {
    target: () => inSample(".from") || $("sample-message"),
    text: () => "Check who it's really from. Compare it to your trusted contacts.",
  },
  {
    target: () => document.querySelector("#mission-screen .contacts"),
    text: () => "These are the real websites and phone numbers. If a message doesn't match, be suspicious.",
  },
  {
    target: () => inSample(".link-chip") || inSample(".body") || $("sample-message"),
    text: () => `${canHover() ? "Hover" : "Tap"} a link to see where it really goes. Look at the main domain.`,
  },
  {
    target: () => $("sample-answers"),
    text: () => "Decide: Phish or Legit? On a keyboard, use ← for Phish and → for Legit.",
  },
  {
    target: () => $("sample-dots"),
    text: () => "✓ means you got it right, ✗ means you got hooked or were too cautious.",
  },
  {
    target: () => ($("btn-sound") ? document.querySelector(".run-tools") : $("btn-tutorial")),
    text: () => $("btn-sound")
      ? "Turn sound on here, and press ? anytime to replay this tutorial."
      : "Press ? anytime to replay this tutorial.",
  },
];

// Names are matched ignoring capital letters and extra spaces ("Sam " = "sam").
const playerKey = () => $("username").value.trim().replace(/\s+/g, " ").toLowerCase();
function seenPlayers() {
  try {
    const list = JSON.parse(localStorage.getItem(TUTORIAL_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function tutorialSeen() {
  return seenPlayers().includes(playerKey());
}
function markTutorialSeen() {
  const list = seenPlayers();
  if (list.includes(playerKey())) return;
  list.push(playerKey());
  try { localStorage.setItem(TUTORIAL_KEY, JSON.stringify(list)); } catch (e) {}
}

const tut = document.createElement("div");
tut.className = "tutorial";
tut.setAttribute("role", "dialog");
tut.setAttribute("aria-labelledby", "tut-text");
tut.hidden = true;
document.body.appendChild(tut);

let tutStep = -1;       // -1 when the tutorial isn't showing
let tutTarget = null;   // the element the current callout points at
let tutReturn = null;   // where keyboard focus goes back to afterwards
let tutMode = null;     // "float" (in open space next to the target) or "inline" (in the page flow)
let tutOffset = null;   // float: the callout's position relative to the target

const onMission = () => document.body.dataset.screen === "mission-screen";
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Called when the briefing opens. Waits for the page to lay out (two frames,
// and the web font, capped at a short wait) so callouts are placed against
// the final layout.
async function maybeStartMissionTutorial() {
  if (tutorialSeen()) return;
  await nextFrame();
  await nextFrame();
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]);
  if (onMission() && tutStep < 0) startTutorial();
}

function startTutorial() {
  if (!onMission()) return;
  hidePeek();
  if (tutStep < 0) tutReturn = document.activeElement;
  tutStep = 0;
  $("btn-tutorial").classList.add("open");
  showTutorialStep();
}

function clearTutorialTarget() {
  if (tutTarget) tutTarget.classList.remove("tut-target");
  tutTarget = null;
}

function showTutorialStep() {
  clearTutorialTarget();
  if (tutStep >= TUTORIAL_STEPS.length) return endTutorial({ save: true });   // finished

  const step = TUTORIAL_STEPS[tutStep];
  tutTarget = step.target();
  if (!tutTarget) return endTutorial({ save: false });   // the briefing is gone
  tutTarget.classList.add("tut-target");
  tut.innerHTML = `
    <span class="tut-arrow" aria-hidden="true"></span>
    <p class="tut-count">Tip ${tutStep + 1} of ${TUTORIAL_STEPS.length}</p>
    <p class="tut-text" id="tut-text">${esc(step.text())}</p>
    <div class="tut-actions">
      <button type="button" class="tut-skip">Skip tutorial</button>
      <button type="button" class="tut-ok">Got it</button>
    </div>`;
  tut.hidden = false;
  layoutTutorial();
  replayAnimation(tut);
  tut.querySelector(".tut-ok").focus({ preventScroll: true });
}

// ---------- Placing a callout ----------
// 1. Bring the target on screen.
// 2. Look for open space next to it (below, above, right, left, sliding along
//    each side) that stays on screen and covers no text, button, or the target.
// 3. No room? Scroll to make room above or below the target, and look again.
// 4. Still no room (for example inside the email on a phone)? Put the callout
//    in the page flow right under the target, so it pushes the content below
//    it down instead of covering it.
const TUT_GAP = 14;   // target to callout (leaves room for the arrow)
const TUT_EDGE = 8;   // callout to screen edge
const TUT_PAD = 4;    // breathing room around anything the callout must not cover

// Paragraph-like elements: only their lines of text count, not empty padding.
const TEXT_SEL = "h1, h2, h3, p, li, th, td, .brand-name, .email-time, .link-hint, .streak";
// Solid things: their whole box counts.
const BOX_SEL = "button, input, img, .avatar, .dot, .answer, .status-bar";
const textRange = document.createRange();

function tutorialObstacles(targetRect) {
  const rects = [];
  const add = (r) => { if (r.width >= 1 && r.height >= 1) rects.push(r); };
  const skip = (el) => tut.contains(el) || el.closest(".ocean-bg");
  document.querySelectorAll(TEXT_SEL).forEach((el) => {
    if (skip(el)) return;
    textRange.selectNodeContents(el);
    for (const r of textRange.getClientRects()) add(r);
  });
  document.querySelectorAll(BOX_SEL).forEach((el) => { if (!skip(el)) add(el.getBoundingClientRect()); });
  // The email's "INBOX" bar is drawn by CSS (::before), so add its label by hand
  document.querySelectorAll(".email").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height) add(new DOMRect(r.left + 12, r.top + 4, 70, 28));
  });
  // Never cover the target or its ring
  const t = targetRect;
  rects.push(new DOMRect(t.left - 6, t.top - 6, t.width + 12, t.height + 12));
  return rects;
}

// Every position from the middle of a range outward, so callouts prefer to be centered on the target.
function spread(lo, hi, steps = 6) {
  if (hi < lo) return [];
  const mid = (lo + hi) / 2, half = (hi - lo) / 2, out = [mid];
  for (let i = 1; i <= steps; i++) out.push(mid - (half * i) / steps, mid + (half * i) / steps);
  return out;
}

function findTutorialSpot(r, w, h) {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const obstacles = tutorialObstacles(r);
  const free = (left, top) =>
    left >= TUT_EDGE && top >= TUT_EDGE && left + w <= vw - TUT_EDGE && top + h <= vh - TUT_EDGE &&
    !obstacles.some((o) => o.left < left + w + TUT_PAD && o.right > left - TUT_PAD &&
                           o.top < top + h + TUT_PAD && o.bottom > top - TUT_PAD);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  // The arrow sits at least 20px in from the callout's corners
  const lefts = spread(cx - w + 20, cx - 20), tops = spread(cy - h + 20, cy - 20);
  const sides = [
    ["below", lefts.map((left) => [left, r.bottom + TUT_GAP])],
    ["above", lefts.map((left) => [left, r.top - TUT_GAP - h])],
    ["right", tops.map((top) => [r.right + TUT_GAP, top])],
    ["left", tops.map((top) => [r.left - TUT_GAP - w, top])],
  ];
  for (const [side, spots] of sides) {
    for (const [left, top] of spots) {
      if (free(left, top)) return { side, left, top, arrow: side === "below" || side === "above" ? cx - left : cy - top };
    }
  }
  return null;
}

function applyFloat(spot, r, w, h) {
  tutMode = "float";
  tutOffset = { dx: spot.left - r.left, dy: spot.top - r.top };
  tut.dataset.side = spot.side;
  tut.style.left = `${spot.left}px`;
  tut.style.top = `${spot.top}px`;
  const vertical = spot.side === "below" || spot.side === "above";
  tut.style.setProperty(vertical ? "--arrow-x" : "--arrow-y",
    `${Math.min(Math.max(20, spot.arrow), (vertical ? w : h) - 20)}px`);
}

function applyInline(target) {
  tutMode = "inline";
  tutOffset = null;
  tut.classList.add("tut-inline");
  tut.style.left = tut.style.top = "";
  tut.dataset.side = "below";
  // Right under the target: the sender line itself, or the row the target is
  // in (link row, Phish / Legit, dots). In the top bar it goes just under the
  // bar, lined up with the "?" button, so the bar's own layout isn't touched.
  const bar = target.closest(".topbar");
  if (bar) {
    bar.after(tut);
    const gutter = document.documentElement.clientWidth - target.getBoundingClientRect().right;
    tut.style.marginLeft = "auto";
    tut.style.marginRight = `${Math.max(TUT_EDGE, gutter - 20)}px`;
  } else {
    // The sender line sits right on top of the callout; anything else gets it
    // under its whole row. A link whose "inspect" hint has wrapped onto the
    // next line (phones) gets it directly under the link, before the hint.
    const hint = target.matches(".link-chip") && target.parentElement.querySelector(".link-hint");
    const hintWrapped = hint && hint.getBoundingClientRect().top >= target.getBoundingClientRect().bottom - 2;
    const anchor = target.matches(".email .from") || hintWrapped ? target
      : target.closest(".sample-progress") || target.closest(".link, .answers, .dots") || target;
    anchor.after(tut);
    widenInlineInEmailHeader();
  }
  pointInlineArrow();
  // Show the target and the whole callout if they fit; the target wins if not
  const t = target.getBoundingClientRect(), c = tut.getBoundingClientRect();
  const down = Math.min(c.bottom + TUT_EDGE - window.innerHeight, t.top - TUT_EDGE);
  if (down > 0) window.scrollBy(0, down);
  else if (t.top < TUT_EDGE) window.scrollBy(0, t.top - TUT_EDGE);
}

// Under the sender line the callout starts in the narrow sender column. Where
// the avatar (left) or the time (right) has already ended above it, let it
// widen into that space, so it isn't squeezed on phones.
function widenInlineInEmailHeader() {
  const who = tut.parentElement;
  if (!who?.classList.contains("email-who")) return;
  const head = who.closest(".email-head");
  const cs = getComputedStyle(head);
  const h = head.getBoundingClientRect(), w = who.getBoundingClientRect();
  const top = tut.getBoundingClientRect().top;
  const clear = (sel) => { const el = head.querySelector(sel); return !el || el.getBoundingClientRect().bottom + 4 <= top; };
  if (clear(".avatar")) tut.style.marginLeft = `${-(w.left - h.left - parseFloat(cs.paddingLeft))}px`;
  if (clear(".email-time")) tut.style.marginRight = `${-(h.right - parseFloat(cs.paddingRight) - w.right)}px`;
}

function pointInlineArrow() {
  const t = tutTarget.getBoundingClientRect(), c = tut.getBoundingClientRect();
  const x = t.left + t.width / 2 - c.left;
  tut.style.setProperty("--arrow-x", `${Math.min(Math.max(20, x), c.width - 20)}px`);
}

function layoutTutorial() {
  if (tutStep < 0 || !tutTarget) return;
  // Start floating and out of sight, so it can be measured without covering anything
  tut.classList.remove("tut-inline");
  tut.style.marginLeft = tut.style.marginRight = "";
  if (tut.parentNode !== document.body) document.body.appendChild(tut);
  tut.style.left = "-9999px";
  tut.style.top = "0px";
  const w = tut.offsetWidth, h = tut.offsetHeight;
  const vh = window.innerHeight;
  const rect = () => tutTarget.getBoundingClientRect();

  let r = rect();
  if (r.top < TUT_EDGE || r.bottom > vh - TUT_EDGE) {
    tutTarget.scrollIntoView({ block: "center" });
    r = rect();
  }
  let spot = findTutorialSpot(r, w, h);
  if (!spot) {
    // Scroll to open up room below, then above, the target
    const startY = window.scrollY;
    for (const dy of [r.bottom + TUT_GAP + h + TUT_EDGE - vh, r.top - TUT_GAP - h - TUT_EDGE]) {
      if (Math.abs(dy) < 1) continue;
      window.scrollTo(0, startY + dy);
      if (Math.abs(window.scrollY - startY) < 1) continue;   // the page can't scroll that way
      r = rect();
      spot = findTutorialSpot(r, w, h);
      if (spot) break;
      window.scrollTo(0, startY);
    }
    r = rect();
  }
  if (spot) applyFloat(spot, r, w, h);
  else applyInline(tutTarget);
}

// On scroll, a floating callout moves with its target; an inline one already does.
function placeTutorial() {
  if (tutStep < 0 || !tutTarget) return;
  if (!document.body.contains(tutTarget)) {
    // The message was re-rendered under the callout: point at the new element.
    const fresh = TUTORIAL_STEPS[tutStep].target();
    if (!fresh) return endTutorial({ save: false });
    tutTarget = fresh;
    tutTarget.classList.add("tut-target");
    return layoutTutorial();
  }
  if (tutMode !== "float") return;
  const r = tutTarget.getBoundingClientRect();
  tut.style.left = `${r.left + tutOffset.dx}px`;
  tut.style.top = `${r.top + tutOffset.dy}px`;
}
// When the layout changes (resize, contacts panel), find a new spot.
function relayoutTutorial() {
  if (tutStep >= 0) layoutTutorial();
}

// save: true only when the player finished or skipped the tutorial.
function endTutorial({ save = false } = {}) {
  if (tutStep < 0) return;
  tutStep = -1;
  clearTutorialTarget();
  if (save) markTutorialSeen();
  $("btn-tutorial").classList.remove("open");
  const hadFocus = tut.contains(document.activeElement);
  tut.hidden = true;
  tut.classList.remove("tut-inline");
  tut.style.marginLeft = tut.style.marginRight = "";
  document.body.appendChild(tut);
  tutMode = tutOffset = null;
  if (hadFocus) {
    const back = [tutReturn, $("btn-start"), $("btn-tutorial")]
      .find((el) => el && document.body.contains(el) && !el.disabled && el.offsetParent);
    if (back) back.focus({ preventScroll: true });
  }
}

tut.addEventListener("click", (e) => {
  if (e.target.closest(".tut-skip")) return endTutorial({ save: true });
  if (e.target.closest(".tut-ok")) {
    tutStep++;
    showTutorialStep();
  }
});
// Escape skips. Enter presses "Got it", unless focus is already on one of the
// callout's own buttons (then Enter presses that button, as usual).
document.addEventListener("keydown", (e) => {
  if (tutStep < 0) return;
  if (e.key === "Escape") return endTutorial({ save: true });
  if (e.key === "Enter" && !e.repeat && !tut.contains(document.activeElement)) {
    e.preventDefault();
    tut.querySelector(".tut-ok")?.click();
  }
});
window.addEventListener("scroll", placeTutorial, { passive: true });
window.addEventListener("resize", relayoutTutorial);
// "?" in the top bar (mission screen) replays it; clicking it while open closes it (counts as a skip).
$("btn-tutorial").addEventListener("click", () => {
  if (tutStep >= 0) return endTutorial({ save: true });
  startTutorial();
});

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
  endTutorial();

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

// Keyboard shortcuts on the play screen: ← Phish, → Legit.
// Only while the buttons are active, and never while typing in a field.
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (document.body.dataset.screen !== "play-screen" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const btn = e.key === "ArrowLeft" ? $("btn-phish") : $("btn-legit");
  if (btn.disabled || answering) return;
  e.preventDefault();
  btn.click();
});
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
const LEADERBOARD_SHOWN = 7;   // rows shown, so the card doesn't run too tall
const isMasterPlayer = (p) => ALL_MODES.every((b) => p.badges.includes(b));

// One row: rank (or trophy) | name + badge icons | points
function leaderboardRow(lead, p, withIcons) {
  const icons = withIcons
    ? p.badges.filter((m) => BADGES[m])
        .map((m) => `<span class="lb-badge" title="${BADGES[m]} badge">${badgeIcon(m)}</span>`).join("") +
      (isMasterPlayer(p) ? '<span class="lb-badge" title="PhishSense Master">🏆</span>' : "")
    : "";
  return `<li class="lb-row"><span class="lb-rank">${lead}</span>` +
    `<span class="lb-who"><b class="lb-name" title="${esc(p.username)}">${esc(p.username)}</b>${icons}</span>` +
    `<span class="lb-score">${p.total_score} pts</span></li>`;
}

const LOAD_ERROR = '<li class="empty">Couldn\'t load scores right now. Try again soon.</li>';

// Both lists load from the database at the same time; if one fails, the other still shows
async function loadLeaderboard() {
  const [board, mastersResult] = await Promise.allSettled([apiLeaderboard(), apiMasters()]);

  let html = LOAD_ERROR;
  if (board.status === "fulfilled") {
    const rows = board.value;
    html = rows.length
      ? rows.slice(0, LEADERBOARD_SHOWN).map((p, i) => leaderboardRow(i + 1, p, true)).join("")
      : '<li class="empty">No scores yet. Be the first!</li>';
  } else {
    console.error("Leaderboard failed to load:", board.reason);
  }
  document.querySelectorAll(".leaderboard-list").forEach((el) => (el.innerHTML = html));

  // Home screen: Masters (all three badges) get their own list
  const mastersList = $("start-screen").querySelector(".masters-list");
  const masters = mastersResult.status === "fulfilled" ? mastersResult.value : [];
  if (mastersResult.status === "fulfilled") {
    mastersList.innerHTML = masters.length
      ? masters.map((p) => leaderboardRow('<span aria-hidden="true">🏆</span>', p, false)).join("")
      : '<li class="empty">No Masters yet. Be the first!</li>';
  } else {
    console.error("Masters failed to load:", mastersResult.reason);
    mastersList.innerHTML = LOAD_ERROR;
  }
  // Only 1 or 2 Masters: a soft nudge underneath so the card doesn't look empty
  $("start-screen").querySelector(".masters-join")
    .classList.toggle("hidden", !(masters.length === 1 || masters.length === 2));
}

const ready = checkBackend();
ready.then(loadLeaderboard);
