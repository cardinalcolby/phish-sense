-- PhishSense database setup (Vultr Managed PostgreSQL, database "appdb")
-- server.js runs this file every time it starts. It is safe to run again:
-- tables are only created if missing and existing scenarios are never changed.
-- You can also run it yourself: psql "$DATABASE_URL" -f setup.sql

-- Table 1: every scenario (our 20 backups + whatever Gemini makes)
CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id  SERIAL PRIMARY KEY,
  source       TEXT NOT NULL,              -- 'sheet' (backup) or 'gemini'
  channel      TEXT NOT NULL,              -- 'email' or 'sms'
  difficulty   TEXT NOT NULL,              -- 'easy', 'medium', 'hard'
  sender       TEXT NOT NULL,
  subject      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  link         TEXT NOT NULL DEFAULT '',
  game_answer  TEXT NOT NULL,              -- 'Phish' or 'Legit'
  red_flags    TEXT NOT NULL DEFAULT '',
  explanation  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 2: the leaderboard
CREATE TABLE IF NOT EXISTS scores (
  username     TEXT PRIMARY KEY,
  total_score  INTEGER NOT NULL DEFAULT 0,
  badges       TEXT[] NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Load the 20 backup scenarios from the Google Sheet
INSERT INTO scenarios
  (scenario_id, source, channel, difficulty, sender, subject, body, link, game_answer, red_flags, explanation)
VALUES
  (1, 'sheet', 'email', 'easy', 'prince.adewale.estate@freemail-inbox.net', 'Request for Financial Assistance', 'Hello, I am Prince Adewale Okonkwo. My late father left a trunk containing eighteen million US dollars. I need your help to access the funds and will share a portion with you if you assist me. Please reply with your full name and bank details.', '', 'Phish', 'too good to be true; stranger asking for help; requests bank details; free email account', 'Classic advance-fee scam: a stranger promises millions and asks for your bank details. No real inheritance works this way.'),
  (2, 'sheet', 'email', 'easy', 'rewards@summer-wellness-offers.biz', 'You Have Been Selected!', 'Congratulations! You have been selected for a FREE summer wellness package worth $500. Claim it before September 1 by entering your name, address, and card number to cover shipping.', 'http://summer-wellness-offers.biz/claim', 'Phish', 'prize you never entered; free gift that needs your card number; deadline pressure; unknown sender', 'You can''t win a contest you never entered. A "free" prize that needs your card number is a scam to steal payment info.'),
  (3, 'sheet', 'sms', 'easy', '(404) 555-0147', '', 'WINNER! A luxury watch is reserved in your name. Pay only $4.99 shipping within 12 hrs to claim: luxwatch-outlet-store.net/winner', 'http://luxwatch-outlet-store.net/winner', 'Phish', 'text from an unknown number; prize you never entered; small fee to claim; 12-hour deadline', 'A surprise prize from a random number is a scam. The small "shipping fee" is how they get your card number.'),
  (4, 'sheet', 'email', 'easy', 'alert-center@insurance-verify-now.info', 'URGENT!!! Your Health Insurance Will Be CANCELED', 'Dear Customer, your health insurance policy will be CANCELED TODAY due to missing informations. To keep your coverage you must verify your Social Security number imediately at the link below or call our verification line at (312) 555-0123.', 'http://insurance-verify-now.info/verify', 'Phish', 'ALL CAPS urgency; generic "Dear Customer"; spelling mistakes; asks for Social Security number; unknown domain; callback number in a scam email', 'Real insurers never cancel coverage by surprise email or ask for your Social Security number through a link. Don''t call numbers from suspicious emails either. Use the number on your insurance card.'),
  (5, 'sheet', 'email', 'easy', 'events@bayline-energy.com', 'Jazz Workshops Resume', 'Good morning, everyone. Jazz performance workshops resume this Tuesday at 5:00 p.m. in the staff lounge after a two-week break. Workshops will continue every Tuesday until the end of the year.', '', 'Legit', '', 'Routine internal announcement from the company address with specific details and no links or requests.'),
  (6, 'sheet', 'email', 'easy', 'marcus.reed@bayline-energy.com', 'Dinner Meeting', 'Daniel, dinner on the 18th works best for me. I sent an outline of the budget proposal and look forward to hearing from you. Best, Marcus.', '', 'Legit', '', 'Normal back-and-forth between coworkers about a planned meeting. No links, no urgency, nothing requested.'),
  (7, 'sheet', 'email', 'easy', 'jordan.lee@bayline-energy.com', 'IT Ticket Update', 'Hi Carlos, your laptop repair is complete. You can pick it up at the IT help desk on the 2nd floor after 1 p.m. Questions? Call the help desk at (404) 555-0100, ext. 2. Thanks, Jordan.', '', 'Legit', '', 'Comes from the company domain, uses the company''s main number, and asks you to pick up your laptop in person. No links, nothing to log in to.'),
  (8, 'sheet', 'sms', 'easy', '(404) 555-0110', '', 'Hi Priya, it''s Elena from the marketing team. Reminder to send your slides for Thursday''s presentation when you get a chance. Thanks!', '', 'Legit', '', 'A friendly reminder from a coworker about a known task. No link, no pressure, and nothing sensitive requested.'),
  (9, 'sheet', 'email', 'medium', 'records-dept@secure-payment-verify.com', 'Confirm Your Information', 'We reviewed your record and need you to confirm your details to receive a guaranteed payment. Call our records department at (305) 555-0139 within 24 hours or submit your information at the website below.', 'http://secure-payment-verify.com/confirm', 'Phish', 'vague "your record"; guaranteed payment; 24-hour deadline; asks for your info by phone or website', 'No company name, a promised payment, and a rush to give your info by phone or website. Scammers use phone numbers too, so a number doesn''t make it real.'),
  (10, 'sheet', 'email', 'medium', 'notifications@connectpro-members.net', 'You Have a New Connection Request', 'You have 1 new connection request on ConnectPro. Sign in to see who wants to connect with you and view their profile.', 'http://connectpro-members.net/signin', 'Phish', 'curiosity bait; sign-in link; domain is connectpro-members.net, not connectpro.com', 'Curiosity bait that leads to a fake sign-in page. The real site would be connectpro.com. Open the app or site yourself instead of signing in from a link.'),
  (11, 'sheet', 'sms', 'medium', '(678) 555-0182', '', 'TechHub: Payment failed for your order of a 15-inch laptop. Update your billing info within 48 hrs to avoid cancellation: techhub-orders-support.com/billing', 'http://techhub-orders-support.com/billing', 'Phish', 'order you didn''t place; 48-hour deadline; asks for billing info; lookalike store domain; random phone number', 'If you didn''t order anything, there''s nothing to fix. This text uses a fake failed payment to get your card details. Check orders in the store''s real app or website.'),
  (12, 'sheet', 'email', 'medium', 'it-support@bayline-energy-it.com', 'Required Software Update', 'Your copy of Office Suite is out of date and your license will expire today. Download the required update from the link below to keep your files accessible. Need help? Call the IT hotline at (404) 555-0198.', 'http://bayline-energy-it.com/office-update.exe', 'Phish', 'lookalike company domain (bayline-energy-it.com, not bayline-energy.com); download link to an .exe file; urgent license threat; phone number is not the company line (404) 555-0100', 'It looks like your IT team, but the domain is bayline-energy-it.com and the phone number isn''t the company''s real number. Real IT updates come through company tools, not .exe links in email.'),
  (13, 'sheet', 'sms', 'medium', '(404) 555-0115', '', 'Hi, it''s Rachel from operations. Can you hold Thursday, March 9, 11:30 to 5 for a planning meeting? I''ll send the room and agenda by email. Let me know if that works!', '', 'Legit', '', 'A normal scheduling text from a coworker. It only asks for your availability and says details will come through company email.'),
  (14, 'sheet', 'email', 'medium', 'corporate.events@bayline-energy.com', 'Company Talk Invitation', 'Please join us on September 5 at 10:00 a.m. Central time for a talk with Dana Brooks, President and CEO of Bayline Energy. She will share company updates and answer questions.', '', 'Legit', '', 'An event invite from the company''s own domain with a specific date, time, and speaker. No link, no login.'),
  (15, 'sheet', 'email', 'medium', 'facilities@bayline-energy.com', 'Parking Lot Update', 'The north parking lot will be repaved this Friday. Please use the south lot for the day. No other action is needed. Questions? Call Facilities at (404) 555-0100, ext. 5.', '', 'Legit', '', 'A simple building update from the company domain with the company''s main phone number. It asks nothing of you.'),
  (16, 'sheet', 'email', 'hard', 'alerts@newsnow-alerts-mail.com', 'NewsNow Custom News Alert', 'NewsNow Alerts: Here is a story from your custom news alert. Read the full story through the link below, or manage your alert preferences.', 'http://newsnow-alerts-mail.com/story?id=48213', 'Phish', 'sender domain is not newsnow.com; link goes to the same lookalike domain; generic alert with no story details', 'It looks like a real news alert, but it''s not from newsnow.com. A familiar brand name isn''t proof. Go to the site directly instead of clicking.'),
  (17, 'sheet', 'sms', 'hard', '(470) 555-0164', '', 'NewsNow Alerts: Watch special NBA highlight videos and read the full story here: newsnow.com.alerts-center.net/nba-videos. Reply STOP to unsubscribe.', 'http://newsnow.com.alerts-center.net/nba-videos', 'Phish', 'subdomain trick: the real domain is alerts-center.net; random phone number instead of an official alert; fake unsubscribe option to look real', 'Sneaky subdomain trick: "newsnow.com" appears first, but the real domain is alerts-center.net. The "Reply STOP" line is there to look official.'),
  (18, 'sheet', 'email', 'hard', 'hr@bayline-energy.com', 'Benefits Enrollment Form', 'Hi Tanya, please complete the benefits election form. Otherwise, your current core benefits will remain in place. You can pick up a paper form from HR or send the completed form to hr@bayline-energy.com. Questions? Call HR at (404) 555-0100, ext. 3.', '', 'Legit', '', 'HR form requests are a common phishing theme, but this one comes from the company domain, uses the company''s main number, has no link or login, and makes no threat.'),
  (19, 'sheet', 'email', 'hard', 'mark.ellis@bayline-energy.com', 'Invoice Follow-Up', 'Derek, Ana Torres is handling the invoices. I have been forwarding them to the accounting office as requested. Please let me know if you have any questions. Thanks, Mark.', '', 'Legit', '', 'Invoices are a classic scam topic, but this message asks for nothing: no payment, no bank change, no link. It just explains who handles invoices.'),
  (20, 'sheet', 'email', 'hard', 'nadia.patel@bayline-energy.com', 'Timesheet Summary Request', 'Derek, following up on Monday''s team meeting: could you upload last month''s timesheet summary to the team shared drive? I need it to finish the project budget. Thanks, Nadia.', '', 'Legit', '', 'A request for work data can look like a scam, but this one is from the company domain, mentions a real meeting, and uses the internal shared drive instead of asking you to email files. When unsure, confirm in person or by phone.')
ON CONFLICT (scenario_id) DO NOTHING;

-- Make Gemini scenarios start at #21
SELECT setval('scenarios_scenario_id_seq', (SELECT MAX(scenario_id) FROM scenarios));

-- Check: you should see easy 8, hard 5, medium 7
SELECT difficulty, COUNT(*) FROM scenarios GROUP BY difficulty ORDER BY difficulty;
