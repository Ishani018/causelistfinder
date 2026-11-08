# Watcher (Phase 0)

Checks the Calcutta High Court website for new cause lists, reads each one with the same parser as the page, and logs what it found. There are no users and no alerts to lawyers yet. The point is to prove, over a week or two of regular sittings, that every list is noticed quickly and read completely.

## What it does on each check

1. Reads the newest cause-list notices (`/Notices/CL`). Supplementary lists are published only there, one PDF per court, usually between 10:00 and 15:00 on the hearing day.
2. Every 30 minutes, also checks the archive (`/downloads/old_cause_lists/…`) for today's, tomorrow's and the next working day's daily lists for all four benches, and for today's supplementary lists.
3. Downloads anything new, or anything re-uploaded with a different size. Then it reads the PDF and runs the coverage check: every case number printed in the PDF must be a listing, a connected case or an IA.
4. Writes one line per list to `data/log.jsonl` and remembers what it has seen in `data/state.json`.
5. At 22:30 IST it checks that tomorrow's Appellate Side daily list has appeared, and logs a problem if not.

These count as **problems**: the site can't be reached (reported after 3 failures in a row), a list reads as zero cases, some printed case numbers aren't read, a list fails to download or parse, or tomorrow's list is missing at 22:30. Problems are always written to the log. If Telegram is set up, they are also sent to the operator.

## Run it

```bash
npm run watch                 # one check
npm run watch -- --loop       # keep running: every 5 min 07:00–23:00 IST, every 30 min otherwise
npm run watch -- --archive    # one check that also probes the archive now
npm run report                # summary of the last 7 days (add -- --days 14)
```

**It must run from India.** The court website doesn't answer GitHub's own runners in the US: connections time out (tested twice on 8 Nov 2026, while the same requests worked from India). Options:

- **This Mac:** `sh watcher/install-mac.sh` starts `--loop` in the background and restarts it at login. It only checks while the Mac is awake and online. Run it from a permanent folder, not a temporary one.
- **A small server in India** (any cloud's Mumbai/Hyderabad/Bangalore region): clone the repo and run `npm run watch -- --loop` under a process manager. Or register it as a GitHub self-hosted runner, set the repository variable `WATCH_RUNNER` to its label, and uncomment the schedule in `.github/workflows/watch.yml`. The workflow then commits the log back to the repo.

### Operator alerts on Telegram (optional)

1. Message `@BotFather` on Telegram and create a bot. It gives you a token.
2. Send your new bot any message, then open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id`.
3. Locally, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. On GitHub, add both as repository secrets (Settings → Secrets and variables → Actions).

## The court's certificate

The court's server doesn't send its intermediate TLS certificate. Browsers and curl fill the gap themselves, but Node doesn't. So the watcher runs Node with `globalsign-alphassl-ca-2025.pem` (the public GlobalSign GCC R6 AlphaSSL CA 2025 intermediate) added to the trusted chain. Certificate checking stays on. That intermediate is valid until May 2027. If the watcher starts reporting certificate errors, download the current one from the "CA Issuers" address in the site's certificate.

## Done when

Regular sittings for 1–2 weeks with:
- every daily list (all four benches) and every supplementary notice logged,
- zero "printed but not read" problems that are real (each one either fixed in `src/parser.js` with a test, or explained),
- a measured median time from upload to seen.
