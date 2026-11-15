# PhishSense 🎣

**Don't get hooked.**

PhishSense uses Gemini to create endless realistic scams, then reveals the red flags you missed. Learn to protect yourself by joining the club and level up from Minnow to Master.

Built at **Emory Hacks 2026** by Abigail, Bryan, Ismahan, and Yusra.

**Live site:** [phishsense-livid.vercel.app](https://phishsense-livid.vercel.app/)

---

## Why we built it

Phishing is one of the most common ways attackers get in, but most security training is a slideshow people click through without learning anything. The same example emails get reused until everyone memorizes them. PhishSense turns training into a game that never repeats, so players build real instincts instead of memorizing answers.

## How it works

1. **Pick a mode:** Easy, Medium, or Hard. Each run is 5 rounds.
2. **Read the message:** an email or a text message at a fictional company, Bayline Energy.
3. **Make the call:** Phish or Legit?
4. **See the red flags:** right or wrong, the game explains what to catch, like lookalike domains, fake urgency, or a phone number that isn't the company's real line.
5. **Earn the badge:** get 4 of 5 right.

| Mode | Badge | What you face |
|---|---|---|
| Easy | 🐟 Minnow | Obvious scams: prizes you never entered, typos, ALL CAPS urgency |
| Medium | 🎣 Angler | Realistic scams: lookalike domains, fake failed payments, fake company IT |
| Hard | ⚓ Captain | Subtle tricks like subdomains, plus real emails that only look scary |
| All three | 🏆 PhishSense Master | Earn every badge to top the leaderboard |

## No sign-up, on purpose

Players just enter a name and play. We don't collect emails, passwords, or any personal information. A security training app shouldn't create new data that needs protecting, and it means anyone can start learning in seconds.

## Safe by design

- **Fictional only:** every company, brand, and person in the game is made up. The company players "work at" is Bayline Energy (`@bayline-energy.com`, main line (404) 555-0100).
- **No real phone numbers:** every number uses the reserved 555-01xx range.
- **No live links:** links are shown as plain text and are never clickable.
- **No peeking:** the correct answer stays on the server until the player guesses.
- **No secrets in the code:** API keys and the database password live in a `.env` file that is never committed.

## How it's built

| Piece | What it does |
|---|---|
| **Game screens** (`public/`) | HTML, CSS, and JavaScript. Inbox-style emails and phone-style texts. |
| **Backend** (`server.js`) | Node.js and Express. Serves scenarios, checks answers, saves scores. |
| **Gemini API** | Writes a brand-new scenario every round, matched to the difficulty. |
| **Vultr** (PostgreSQL) | Stores scenarios and the leaderboard. |
| **Vercel** | Hosts the live site. |
| **Entire** | Our team's git workflow. |

### Gemini + backup scenarios

Every scenario lives in one `scenarios` table, with a `source` column:

- `sheet`: 20 hand-written, hand-checked scenarios (8 Easy, 7 Medium, 5 Hard; 15 emails and 5 texts).
- `gemini`: new scenarios Gemini writes during play, saved automatically.

When a round starts, the backend asks Gemini for a new scenario and shows it two of our backups as style examples. If Gemini is slow (over 6 seconds) or fails, the game quietly uses a backup instead, so players never see an error.

## Run it yourself

### Option 1: Practice mode (no setup)
Open `public/index.html` in a browser, or right-click it in VS Code and choose **Open with Live Server**. The game runs on the 20 backup scenarios, and the leaderboard saves in your browser.

### Option 2: Full app (Gemini + database)
1. **Database:** create a Vultr Managed Database (PostgreSQL). Connect to it with a SQL tool such as psql or pgAdmin, using the connection details from Vultr, then run `setup.sql`. The last result should show easy 8, hard 5, medium 7.
2. **Keys:** copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL`: your Vultr database connection string
   - `GEMINI_API_KEY`: from Google AI Studio
   - `GEMINI_MODEL`: the current Gemini Flash model name
3. **Run:** `npm install`, then `npm start`, and open http://localhost:3000

The full app also works without a Gemini key. It just uses the backup scenarios.

### API routes

| Route | What it does |
|---|---|
| `GET /api/scenario?mode=easy` | Returns a message (Gemini first, backup if needed). Never includes the answer. |
| `POST /api/answer` | `{ scenario_id, guess }` returns whether it was right, the red flags, and the explanation. |
| `POST /api/score` | `{ username, points, badge }` saves a finished run. |
| `GET /api/leaderboard` | Top 50 players. |

## Project files

```
phish-sense/
  public/
    index.html      Game screens
    style.css       Look and feel
    app.js          Game logic
    mock-data.js    Backup scenarios for practice mode
    logo-badge.svg  Logo
  server.js         Backend
  setup.sql         Database setup + 20 backup scenarios
  .env.example      Template for keys (copy to .env)
```

## What's next

- **Accounts (optional):** save progress across devices, without collecting more data than needed.
- **Scam Library:** search every scenario and red flag instantly, typos and all, powered by Typesense.
- **More formats:** QR code phishing, voicemail transcripts, and fake login pages.
- **Team mode:** let companies run phishing training with their own dashboards.
- **Personal practice:** focus each player on the red flags they miss most.

## Team

| Name | Role |
|---|---|
| Abigail | Team lead, game screens, pitch |
| Bryan | Backend, Gemini, deployment |
| Ismahan | Database setup |
| Yusra | Leaderboard and data |
