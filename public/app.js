// PhishSense game logic (runs in the browser)

const ROUNDS = 5;        // rounds per mode
const TO_PASS = 4;       // correct answers needed for the badge
const BADGES = { easy: "🐟 Minnow", medium: "🎣 Angler", hard: "⚓ Captain" };

let mode, round, correct, current, seen;

const $ = (id) => document.getElementById(id);
const show = (id) => {
  ["start-screen", "play-screen", "end-screen"].forEach((s) => $(s).classList.add("hidden"));
  $(id).classList.remove("hidden");
};
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Talking to the backend ----------
// If you open index.html directly (no server), the game uses mock-data.js instead.
const OFFLINE = location.protocol === "file:";

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

// ---------- Start ----------
document.querySelectorAll(".mode").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (!$("username").value.trim()) return $("username").focus();
    mode = btn.dataset.mode;
    round = 0;
    correct = 0;
    seen = [];
    show("play-screen");
    nextRound();
  })
);

// ---------- Play ----------
async function nextRound() {
  round++;
  $("progress").textContent = `${mode.toUpperCase()} · Round ${round} of ${ROUNDS} · ${correct} correct`;
  $("result").classList.add("hidden");
  $("btn-next").classList.add("hidden");
  $("btn-phish").disabled = $("btn-legit").disabled = true;
  $("message").innerHTML = `<p class="loading">Loading message...</p>`;

  current = await apiGetScenario(mode, seen);
  seen.push(current.scenario_id);
  $("message").innerHTML = renderMessage(current);
  $("btn-phish").disabled = $("btn-legit").disabled = false;
}

function renderMessage(s) {
  // Links are shown as plain text on purpose: never clickable.
  const link = s.link ? `<p class="link">🔗 ${esc(s.link)}</p>` : "";
  if (s.channel === "sms") {
    return `<div class="sms">
      <p class="label">💬 Text message from <b>${esc(s.sender)}</b></p>
      <p class="bubble">${esc(s.body)}</p>${link}</div>`;
  }
  return `<div class="email">
    <p class="label">✉️ <b>From:</b> ${esc(s.sender)}</p>
    <p class="label"><b>Subject:</b> ${esc(s.subject)}</p>
    <p class="body">${esc(s.body)}</p>${link}</div>`;
}

async function answer(guess) {
  $("btn-phish").disabled = $("btn-legit").disabled = true;
  const r = await apiAnswer(current.scenario_id, guess);

  if (r.correct) correct++;
  const flags = r.red_flags
    ? `<p><b>Red flags:</b></p><ul>${r.red_flags.split(";").map((f) => `<li>${esc(f.trim())}</li>`).join("")}</ul>`
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

// ---------- End of run ----------
async function finish() {
  const passed = correct >= TO_PASS;
  const badge = passed ? mode : null;
  await apiSaveScore($("username").value.trim(), correct * 100, badge);

  $("end-title").textContent = passed ? `You earned ${BADGES[mode]}!` : `${correct} of ${ROUNDS} correct`;
  $("end-text").textContent = passed
    ? "Nice catch. Try the next mode!"
    : `You need ${TO_PASS} to earn ${BADGES[mode]}. Every round is new, so try again!`;
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
        const master = ["easy", "medium", "hard"].every((b) => p.badges.includes(b)) ? " 🏆" : "";
        return `<li><b>${esc(p.username)}</b> ${icons}${master} <span>${p.total_score} pts</span></li>`;
      }).join("")
    : "<li>No scores yet. Be the first!</li>";
}

loadLeaderboard();
