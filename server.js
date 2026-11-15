// PhishSense backend
// Run: npm install, then npm start. Open http://localhost:3000
// Needs a .env file with DATABASE_URL, GEMINI_API_KEY, and GEMINI_MODEL (see .env.example)

import "dotenv/config";
import express from "express";
import pg from "pg";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());
app.use(express.static("public")); // serves the game (public/index.html)

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});
// A dropped idle connection must not crash the whole app.
db.on("error", (err) => console.error("Database pool error:", err.message));

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
    const { rows } = await db.query(
      `SELECT * FROM scenarios WHERE source = 'sheet' AND difficulty = $1 AND NOT (scenario_id = ANY($2::int[]))
        ORDER BY random() LIMIT 1`,
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

// 3. Save a finished run (adds points, and the badge if they earned it)
app.post("/api/score", safe(async (req, res) => {
  const username = String(req.body.username || "").trim().slice(0, 20);
  const points = Number(req.body.points) || 0;
  const badge = req.body.badge ? [req.body.badge] : [];
  if (!username) return res.status(400).json({ error: "Username required" });
  const { rows } = await db.query(
    `INSERT INTO scores (username, total_score, badges) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET
       total_score = scores.total_score + EXCLUDED.total_score,
       badges = ARRAY(SELECT DISTINCT unnest(scores.badges || EXCLUDED.badges)),
       updated_at = now()
     RETURNING *`,
    [username, points, badge]
  );
  res.json(rows[0]);
}));

// 4. Leaderboard (most badges first, then highest score)
app.get("/api/leaderboard", safe(async (req, res) => {
  const { rows } = await db.query(
    `SELECT username, total_score, badges FROM scores
      ORDER BY cardinality(badges) DESC, total_score DESC LIMIT 50`
  );
  res.json(rows);
}));

// 5. PhishSense Masters: every player with all three badges, highest score first
app.get("/api/masters", safe(async (req, res) => {
  const { rows } = await db.query(
    `SELECT username, total_score, badges FROM scores
      WHERE badges @> $1::text[]
      ORDER BY total_score DESC, updated_at ASC LIMIT 50`,
    [MODES]
  );
  res.json(rows);
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PhishSense running at http://localhost:${PORT}`));
