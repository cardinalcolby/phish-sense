// PhishSense game logic (runs in the browser)

const ROUNDS = 5;        // rounds per mode
const TO_PASS = 4;       // correct answers needed for the badge
const PER_CORRECT = 100; // points per correct answer
const BADGES = { easy: "🐟 Minnow", medium: "🎣 Angler", hard: "⚓ Captain" };
const ALL_MODES = ["easy", "medium", "hard"];
const MISSIONS = {
  easy: "Warm-up shift. These scams are obvious: watch for typos, surprise prizes, and ALL CAPS urgency.",
  medium: "Scammers are getting smarter. Check every sender address and phone number against the real ones above.",
  hard: "Expert level. Some scams look perfect, and some real emails look scary. Read every detail before you decide.",
};

let mode, round, correct, current, seen;
let results;  // one entry per round: true (correct) or false (wrong)
let streak;   // correct answers in a row, resets on a wrong answer
let missed;   // every red flag from the rounds the player got wrong

const $ = (id) => document.getElementById(id);
const show = (id) => {
  ["start-screen", "mission-screen", "play-screen", "end-screen"].forEach((s) => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
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

// ---------- Start: pick a difficulty, then see the mission ----------
document.querySelectorAll(".mode").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (!$("username").value.trim()) return $("username").focus();
    mode = btn.dataset.mode;
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    $("mission-mode").textContent = `${label} mode · ${BADGES[mode]} badge`;
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

function renderStreak() {
  $("streak").textContent =
    streak >= 2 ? `🔥 ${streak} in a row` : streak === 1 ? "🔥 1 correct" : "";
}

// ---------- Play ----------
async function nextRound() {
  await ready;
  round++;
  $("progress").textContent = `${mode.toUpperCase()} · Round ${round} of ${ROUNDS} · ${correct} correct`;
  $("result").classList.add("hidden");
  $("btn-next").classList.add("hidden");
  $("btn-phish").disabled = $("btn-legit").disabled = true;
  $("message").className = "card";   // clears the glow or shake from the last round
  $("pop-layer").innerHTML = "";
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

function renderMessage(s) {
  // Links are shown as plain text on purpose: never clickable.
  const link = s.link ? `<p class="link">🔗 ${esc(s.link)}</p>` : "";
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

async function answer(guess) {
  $("btn-phish").disabled = $("btn-legit").disabled = true;
  const r = await apiAnswer(current.scenario_id, guess);

  results[round - 1] = !!r.correct;
  if (r.correct) {
    correct++;
    streak++;
    $("message").classList.add("is-correct");
    floatScore(`+${PER_CORRECT}`);
  } else {
    streak = 0;
    $("message").classList.add("is-wrong");
    flagList(r.red_flags).forEach((f) => missed.push(f));
  }
  renderDots();
  renderStreak();

  const flags = r.red_flags
    ? `<p><b>Red flags:</b></p><ul>${flagList(r.red_flags).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`
    : "";
  $("result").innerHTML = `
    <h3>${r.correct ? "✅ Correct!" : "❌ Not quite."} This one was <b>${r.game_answer}</b>.</h3>
    ${flags}<p>${esc(r.explanation)}</p>`;
  $("result").className = `card ${r.correct ? "good" : "bad"}`;
  $("progress").textContent = `${mode.toUpperCase()} · Round ${round} of ${ROUNDS} · ${correct} correct`;
  $("btn-next").textContent = round < ROUNDS ? "Next" : "See results";
  $("btn-next").classList.remove("hidden");
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
  const [icon, ...name] = BADGES[mode].split(" ");
  $("badge-art").textContent = icon;
  $("badge-name").textContent = name.join(" ");
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

  $("end-title").textContent = passed ? `You earned ${BADGES[mode]}!` : `${correct} of ${ROUNDS} correct`;
  $("end-text").textContent = passed
    ? "Nice catch. Try the next mode!"
    : `You need ${TO_PASS} to earn ${BADGES[mode]}. Every round is new, so try again!`;

  if (passed) revealBadge(isMaster);
  else $("badge-reveal").classList.add("hidden");

  renderRecap();
  show("end-screen");
  loadLeaderboard();
}

$("btn-home").addEventListener("click", () => show("start-screen"));

// ---------- Leaderboard ----------
async function loadLeaderboard() {
  const rows = await apiLeaderboard();
  $("leaderboard").innerHTML = rows.length
    ? rows.map((p) => {
        const icons = p.badges.map((b) => BADGES[b]?.split(" ")[0] || "").join(" ");
        const master = ALL_MODES.every((b) => p.badges.includes(b)) ? " 🏆" : "";
        return `<li><b>${esc(p.username)}</b> ${icons}${master} <span>${p.total_score} pts</span></li>`;
      }).join("")
    : '<li class="empty">No scores yet. Be the first!</li>';
}

const ready = checkBackend();
ready.then(loadLeaderboard);
