// PhishSense backend
// Run: npm install, then npm start. Open http://localhost:3000
// Needs a .env file with DATABASE_URL, GEMINI_API_KEY, and GEMINI_MODEL (see .env.example)

import "dotenv/config";
import fs from "node:fs";
import express from "express";
import pg from "pg";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());
app.use(express.static("public")); // serves the game (public/index.html)

// ---------- Database (Vultr Managed PostgreSQL, database "appdb") ----------
// Vultr's connection string ends in ?sslmode=require. The pg library treats
// that as "verify-full" and it overrides the ssl option below, so the
// connection fails on Vultr's self-signed certificate. We remove the ssl*
// settings from the URL and set SSL here instead:
//   - DATABASE_CA_CERT=/path/to/vultr-ca.crt  -> verify the server (recommended)
//   - not set                                 -> encrypted, but not verified
function dbConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
    return {};
  }
  const url = new URL(raw);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(key);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  let ssl = false;
  if (!local) {
    const caPath = process.env.DATABASE_CA_CERT;
    ssl = caPath ? { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: false };
  }
  return { connectionString: url.toString(), ssl, connectionTimeoutMillis: 10000 };
}

const db = new pg.Pool(dbConfig());
// A dropped idle connection must not crash the whole app.
db.on("error", (err) => console.error("Database pool error:", err.message));

// On startup: connect, create the tables if they're missing, and load the 20
// backup scenarios if the scenarios table is empty. setup.sql is safe to run
// more than once (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING).
async function prepareDatabase() {
  try {
    const { rows } = await db.query("SELECT current_database() AS name");
    console.log(`Connected to database "${rows[0].name}"`);
    await db.query(fs.readFileSync(new URL("./setup.sql", import.meta.url), "utf8"));
    const { rows: counts } = await db.query(
      `SELECT (SELECT COUNT(*) FROM scenarios)::int AS scenarios, (SELECT COUNT(*) FROM leaderboard)::int AS players,
              (SELECT COUNT(*) FROM scores)::int AS games`
    );
    console.log(`Database ready: ${counts[0].scenarios} scenarios, ${counts[0].players} players, ${counts[0].games} games`);
  } catch (err) {
    console.error("DATABASE NOT READY:", err.message || err.code || err);
  }
}

// Express 4 doesn't catch errors from async routes. Without this, one failed
// database query crashes Node and nginx shows "502 Bad Gateway" for everyone.
const safe = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.path} failed:`, err.message || err.code || err);
    if (!res.headersSent) res.status(500).json({ error: "Server error" });
  }
};
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const MODES = ["easy", "medium", "hard"];

// ---------- Gemini ----------

// The exact fields we want back (same columns as the Google Sheet)
const SCENARIO_SCHEMA = {
  type: "object",
  properties: {
    channel: { type: "string", enum: ["email", "sms"] },
    sender: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    link: { type: "string" },
    game_answer: { type: "string", enum: ["Phish", "Legit"] },
    red_flags: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["channel", "sender", "subject", "body", "link", "game_answer", "red_flags", "explanation"],
};

const LEVELS = {
  easy: "Obvious. Phish: prizes you never entered, typos, ALL CAPS urgency, asks for card or Social Security numbers. Legit: friendly and specific, asks for nothing sensitive.",
  medium: "Realistic. Phish: lookalike domains, fake failed payments, fake sign-in pages, fake company IT. Legit: normal work requests about meetings, forms, or schedules.",
  hard: "Subtle. Phish: polished grammar, subdomain tricks like brand.com.fake-site.net, fake alerts from familiar-looking brands. Legit: HR, invoice, or report emails that look scary but come from @bayline-energy.com and ask for nothing risky.",
};

async function askGemini(mode, examples) {
  const answer = Math.random() < 0.5 ? "Phish" : "Legit"; // keep the game balanced
  const channel = Math.random() < 0.3 ? "sms" : "email";

  const prompt = `You write scenarios for PhishSense, a phishing-awareness game.
The player works at a fictional company, Bayline Energy.
Real company email: @bayline-energy.com. Real company phone: (404) 555-0100.

Write ONE ${channel} message. Difficulty: ${mode}. The correct answer must be: ${answer}.
Difficulty guide: ${LEVELS[mode]}

Trusted contacts (the player can see this list and checks every message against it):
- Bayline Energy (the player's company): bayline-energy.com, phone (404) 555-0100
- NewsNow: newsnow.com
- ConnectPro: connectpro.com
- TechHub: techhub.com

Rules:
- Only these four companies may appear. No other company, brand, bank, or government agency names. People's names must be fictional.
- Legit: the sender and any link must use the company's real domain exactly as listed (for example jordan.lee@bayline-energy.com or https://newsnow.com/...). Any phone number must be the real one from the list. Only Bayline Energy has a phone number, so a Legit sms must come from (404) 555-0100.
- Phish: impersonate one of these four companies with a lookalike address, such as a different domain (connectpro-members.net), an extra word (techhub-support.com), or a subdomain trick (newsnow.com.alerts-center.net). Any phone number in a Phish must NOT be (404) 555-0100. The explanation must say what the real address is.
- Phone numbers must look like (404) 555-01XX.
- For sms, leave subject empty and use a phone number as the sender.
- link is display text only (or empty).
- The examples below show the writing style only. Follow these company rules even if an example uses other names.
- red_flags: short phrases separated by semicolons. Empty for Legit.
- explanation: 1 to 2 plain sentences anyone can understand.

Examples of the style we want:
${JSON.stringify(examples)}`;

  const call = ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json", responseJsonSchema: SCENARIO_SCHEMA },
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000));
  const response = await Promise.race([call, timeout]);
  const s = JSON.parse(response.text);
  if (s.game_answer !== answer) throw new Error("wrong answer type");
  return s;
}

// ---------- Routes ----------

// 1. Get a scenario (Gemini first, sheet backup if Gemini fails)
app.get("/api/scenario", safe(async (req, res) => {
  const mode = MODES.includes(req.query.mode) ? req.query.mode : "easy";
  const seen = String(req.query.seen || "").split(",").map(Number).filter(Boolean); // avoid repeats in a run
  let row;
  try {
    if (!ai) throw new Error("no Gemini key");
    const { rows: examples } = await db.query(
      `SELECT channel, sender, subject, body, link, game_answer, red_flags, explanation
         FROM scenarios WHERE source = 'sheet' AND difficulty = $1 ORDER BY random() LIMIT 2`,
      [mode]
    );
    const s = await askGemini(mode, examples);
    const { rows } = await db.query(
      `INSERT INTO scenarios (source, channel, difficulty, sender, subject, body, link, game_answer, red_flags, explanation)
       VALUES ('gemini', $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [s.channel, mode, s.sender, s.subject, s.body, s.link, s.game_answer, s.red_flags, s.explanation]
    );
    row = rows[0];
  } catch (err) {
    console.log(`Using backup scenario (${err.message})`);
    // Prefer the hand-checked scenarios; use saved Gemini ones only if those run out.
    const { rows } = await db.query(
      `SELECT * FROM scenarios WHERE difficulty = $1 AND NOT (scenario_id = ANY($2::int[]))
        ORDER BY (source = 'sheet') DESC, random() LIMIT 1`,
      [mode, seen]
    );
    row = rows[0];
  }
  if (!row) return res.status(404).json({ error: "No scenarios found" });
  // Only send what the player should see. The answer stays on the server.
  res.json({
    scenario_id: row.scenario_id, channel: row.channel, sender: row.sender,
    subject: row.subject, body: row.body, link: row.link,
  });
}));

// 2. Check an answer
app.post("/api/answer", safe(async (req, res) => {
  const { scenario_id, guess } = req.body;
  const { rows } = await db.query(`SELECT * FROM scenarios WHERE scenario_id = $1`, [scenario_id]);
  if (!rows[0]) return res.status(404).json({ error: "Scenario not found" });
  const s = rows[0];
  res.json({
    correct: guess === s.game_answer,
    game_answer: s.game_answer,
    red_flags: s.red_flags,
    explanation: s.explanation,
  });
}));

// Same rules as public/app.js. The server works out points and badges itself,
// so a player can't send a made-up score.
const ROUNDS = 5;
const TO_PASS = 4;
const PER_CORRECT = 100;
const cleanName = (v) => String(v || "").trim().replace(/\s+/g, " ").slice(0, 20);

// Every player with their totals plus stats from their games in "scores".
// Most badges first, then highest score.
const PLAYER_SELECT = `
  SELECT l.username, l.total_score, l.badges, l.updated_at,
         COALESCE(g.games_played, 0)::int AS games_played,
         COALESCE(g.best_points, 0)::int  AS best_points,
         g.last_played
    FROM leaderboard l
    LEFT JOIN (SELECT username, COUNT(*) AS games_played, MAX(points) AS best_points,
                      MAX(played_at) AS last_played
                 FROM scores GROUP BY username) g ON g.username = l.username`;

// 3. Save a finished game: one row in "scores", and the points and badge are
// added to the player's "leaderboard" row. Both happen in one transaction.
// Body: { username, mode, correct, run_id? }
app.post("/api/score", safe(async (req, res) => {
  const username = cleanName(req.body.username);
  const mode = req.body.mode;
  const correct = Number(req.body.correct);
  const runId = req.body.run_id ? String(req.body.run_id).slice(0, 64) : null;
  const playedAt = Date.parse(req.body.played_at);
  if (!username) return res.status(400).json({ error: "Username required" });
  if (!MODES.includes(mode)) return res.status(400).json({ error: "Unknown mode" });
  if (!Number.isInteger(correct) || correct < 0 || correct > ROUNDS) {
    return res.status(400).json({ error: "Bad number of correct answers" });
  }
  const points = correct * PER_CORRECT;
  const passed = correct >= TO_PASS;
  const badge = passed ? mode : null;
  // A game saved late (it was played while the database was down) keeps its
  // real time, as long as that time is in the past.
  const when = Number.isFinite(playedAt) && playedAt <= Date.now() ? new Date(playedAt) : new Date();

  const client = await db.connect();
  let game;
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO leaderboard (username) VALUES ($1) ON CONFLICT (username) DO NOTHING`,
      [username]
    );
    const inserted = await client.query(
      `INSERT INTO scores (run_id, username, mode, correct, rounds, points, passed, badge, played_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (run_id) DO NOTHING
       RETURNING *`,
      [runId, username, mode, correct, ROUNDS, points, passed, badge, when]
    );
    game = inserted.rows[0];
    if (game) {
      await client.query(
        `UPDATE leaderboard SET
           total_score = total_score + $2,
           badges = CASE WHEN $3::text IS NULL OR $3 = ANY(badges) THEN badges ELSE badges || $3::text END,
           updated_at = now()
         WHERE username = $1`,
        [username, points, badge]
      );
    } else {
      // Same run_id was already saved (a retry): return that game, add nothing
      game = (await client.query(`SELECT * FROM scores WHERE run_id = $1`, [runId])).rows[0];
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await db.query(`${PLAYER_SELECT} WHERE l.username = $1`, [username]);
  res.json({ ...rows[0], game });
}));

// 4. Leaderboard: every player in the database (most badges, then highest score)
app.get("/api/leaderboard", safe(async (req, res) => {
  const { rows } = await db.query(
    `${PLAYER_SELECT} ORDER BY cardinality(l.badges) DESC, l.total_score DESC, l.updated_at ASC`
  );
  res.json(rows);
}));

// 5. PhishSense Masters: every player with all three badges, highest score first
app.get("/api/masters", safe(async (req, res) => {
  const { rows } = await db.query(
    `${PLAYER_SELECT} WHERE l.badges @> $1::text[] ORDER BY l.total_score DESC, l.updated_at ASC`,
    [MODES]
  );
  res.json(rows);
}));

// 6. One player after a game: their totals and their recent games
app.get("/api/players/:username", safe(async (req, res) => {
  const username = cleanName(req.params.username);
  const { rows } = await db.query(`${PLAYER_SELECT} WHERE l.username = $1`, [username]);
  if (!rows[0]) return res.status(404).json({ error: "Player not found" });
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
  const { rows: games } = await db.query(
    `SELECT score_id, mode, correct, rounds, points, passed, badge, played_at
       FROM scores WHERE username = $1 ORDER BY played_at DESC LIMIT $2`,
    [username, limit]
  );
  res.json({ ...rows[0], games });
}));

// 7. Recent games from everyone (newest first). ?username= narrows it to one player.
app.get("/api/scores", safe(async (req, res) => {
  const username = req.query.username ? cleanName(req.query.username) : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const { rows } = await db.query(
    `SELECT score_id, username, mode, correct, rounds, points, passed, badge, played_at
       FROM scores WHERE ($1::text IS NULL OR username = $1)
      ORDER BY played_at DESC LIMIT $2`,
    [username, limit]
  );
  res.json(rows);
}));

// 8. Health check: is the database reachable and are the tables there?
// Shows counts only, never connection details.
app.get("/api/health", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT current_database() AS database,
              (SELECT COUNT(*) FROM scenarios)::int AS scenarios,
              (SELECT COUNT(*) FROM leaderboard)::int AS players,
              (SELECT COUNT(*) FROM scores)::int AS games`
    );
    res.json({ ok: true, ...rows[0] });
  } catch (err) {
    console.error("Health check failed:", err.message || err.code || err);
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PhishSense running at http://localhost:${PORT}`);
  prepareDatabase();
});
