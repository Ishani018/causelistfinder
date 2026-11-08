# Automatic cause list alerts: plan

Goal: a lawyer or clerk saves their case numbers once. Whenever the Calcutta High Court publishes a list that names one of them, they get a message with the court, item, time and any court note. Nobody uploads anything.

## What the court website actually does

Measured on 8 November 2026 from 400 cause-list notices (31 Aug – 7 Oct 2026) and the download archive.

| List | Where it appears | When it appears |
|---|---|---|
| Daily list, Appellate Side | Archive: `/downloads/old_cause_lists/AS/cla<DDMMYYYY>.pdf`, plus a notice | Evening before. Median 21:09, earliest 16:35, latest 22:03 (38 lists) |
| Daily list, Original Side / Jalpaiguri / Port Blair | Same archive with `OS/cl…`, `J/clj…`, `PB/clpb…`, plus a notice | Evening before, about 20:00–21:00 |
| Supplementary lists | Mostly **only as notices** (`/Notice-Files/CL/<id>`), one PDF per court. The archive's `supplementary/` folder has almost none | **Same day, during court hours.** 184 of 189 were for the same day; 160 were uploaded between 10:00 and 14:59 |
| Monthly list | Archive: `monthly/AS/cla<DDMMYYYY>.pdf` | Before the month starts; not a fixed hearing date |
| Vacation bench lists | Notices | Can be the same morning (8 Nov list uploaded 8 Nov 10:21) |

The notices list is at `/Notices/CL?page=N`, 10 per page, newest first. Each item has a title (list type, date, side, court number) and an `Uploaded:DD-Mon-YYYY HH:MM:SS` stamp. The site has no robots.txt.

**What this means:** a once-a-night check is not enough. Supplementary lists land while the lawyer is already in court, for matters heard that same day. This is where cases get missed, and where an alert is worth the most.

## How it would work

```
 every 5 min (07:00–23:00 IST), every 30 min otherwise
 ┌───────────┐   new notice / new archive file   ┌──────────┐   entries   ┌─────────┐   matches   ┌───────────┐
 │  Watcher  │ ────────────────────────────────▶ │  Parser  │ ──────────▶ │ Matcher │ ──────────▶ │  Alerts   │
 └───────────┘   (download PDF, keep a copy)      └──────────┘             └─────────┘             └───────────┘
       │                                         same parser.js             saved case lists        WhatsApp / Telegram
       └─ heartbeat: "daily list not seen by 22:30" ─────────────────────────────────────────────────▶ email
```

1. **Watcher.** Fetches `/Notices/CL` page 1 (and page 2 if every item on page 1 is new). Separately checks the archive URLs for the next working day. Remembers notice ids and file sizes it has seen, so a re-uploaded (corrected) list is treated as new. That is roughly 200–300 small requests a day: identify it with a clear user agent and keep it gentle.
2. **Parser.** `src/parser.js`, the code the page already uses, runs in Node via `tools/read-list.js`. Every run also does the coverage check (every case number printed in the PDF is either a listing, a connected case or an IA). If that check fails or a list has zero cases, alert us, not the users.
3. **Matcher.** Matches parsed entries against each user's saved case numbers, with the same normalisation as the page. Remembers what was already sent, so a user is told once per listing and again only if the court, item or time changes.
4. **Alerts.**
   - Evening (when the daily list lands): "Tomorrow, Tue 13 Oct: 3 cases listed. MAT/1451/2026, Court 11, Item 1, 10:30 AM…"
   - Daytime, urgent: "SUPPLEMENTARY list just published. WPA/24251/2023, Court 25, Item 1, TODAY."
   - Court notes on matched benches: "Court 18 not sitting from 28.09 to 09.10".
   - Morning, optional: a 7:30 AM recap of the day.
5. **Heartbeat.** If it's a working day and no daily list has been seen by 22:30, tell users plainly: "Tomorrow's list isn't on the court site yet. We'll message when it is." Silence must never look like "no cases listed".

## Choices to make

| Decision | Recommendation | Why |
|---|---|---|
| Alert channel for the pilot | **Telegram bot or email** | Free and needs no approval. Good enough for 3–5 pilot users |
| Alert channel for launch | **WhatsApp Business API** (through Meta's Cloud API or an Indian provider) | It's what lawyers and clerks use all day. It needs a verified business and pre-approved message templates, and every message costs money; check current Meta pricing for India "utility" messages |
| Hosting | A small always-on server in India (VPS or a container platform) + a small Postgres | The watcher must run every few minutes, all day. Indian hosting avoids any risk of the court site blocking foreign IPs (not tested) |
| Accounts | Phone number + OTP | No passwords; the phone is also the WhatsApp destination |
| What to store | Case numbers, phone, list of alerts sent. Keep copies of court PDFs for 30 days | Case lists are client information: keep them minimal, encrypted at rest, and never in a public repo. Read up on India's DPDP Act before taking paying users |

## Phases

**Phase 0: watch only (1–2 weeks of regular sittings). Built: see `watcher/README.md`.** Run the watcher with no users. Log every list and notice, run the parser and coverage check on each, and record upload times. Done when a full week shows zero unread case numbers and zero crashes on every list type, including Original Side, which hasn't been tested yet.

**Phase 1: pilot (3–4 weeks).** 3–5 users: the contact who gave the case list, plus clerks or juniors of busy advocates. Add their lists by hand. Telegram or email alerts. Each evening, the clerk compares our alert against their own manual check. Measure: missed listings (target zero), false alerts, and minutes from upload to alert.

**Phase 2: launch.** WhatsApp, self sign-up, payment. Keep the upload page as a free fallback.

**Phase 3: grow.** Other benches (Original Side layout, Jalpaiguri, Port Blair), then other High Courts. Each court needs its own watcher and parser checks; the matcher and alerts stay the same.

## Risks

- **The site changes its layout or URLs.** The coverage check and "zero cases" alarm catch this the same day; keep fixtures from every list type in `tests/`.
- **Late or corrected lists.** Handled by re-checking file sizes and notice ids, and by the heartbeat.
- **A missed alert costs a lawyer a hearing.** Say clearly that the official list is the authority. Show "last checked at 14:05" in every message, and alert us whenever a fetch fails.
- **Competition.** Provakil, Claw, Lawgger, Case Diary and others sell alerts, and the court itself has a paid subscription (introduced from April 2025; details not yet confirmed). The edge here is Calcutta-specific accuracy: same-day supplementary alerts, court notes, and connected-case matching.
- **Terms of use.** The lists are public, but read the court website's terms and keep request rates low.

## Research behind this

- Reddit couldn't be reached by the research tools; findings come from LawyersClubIndia/Kaanoon threads, eCourts app reviews, practitioner guides and competitors' own pages.
- Most missed matters are on supplementary lists, which are published late and taken up first.
- Name search is unreliable; it fails completely when the advocate's name isn't on the record (common for government counsel). Case number is the reliable key.
- eCourts app reviews complain of lists not loading and daily lists updated late.
