# Cause List Finder

Find your cases in Calcutta High Court cause lists.

Save your case numbers once, then upload the day's cause list PDFs (daily, supplementary, monthly). For each case you get the court, item number, time and judges. You also see the court's notes for that bench ("not sitting", "today matters will be taken up serially") and a link to the bench's video hearing, plus a clear list of cases that are not listed. A **Copy for WhatsApp** button turns the result into a message.

Everything runs in the browser. The PDF never leaves the device, and the case list is saved only in that browser.

## Use it

Open `index.html` in a browser. It is a single self-contained page that loads pdf.js from cdnjs. It can also be served as is, for example with GitHub Pages.

## What it handles

- Daily, supplementary, monthly and warning lists from the Appellate Side, Original Side, and the Jalpaiguri and Port Blair circuit benches. On the Original Side this includes rows that start with the application (`IA NO. GA/1/2026 … In WPO/329/2026`).
- Case numbers typed any way, including hyphenated types such as `AO-COM` and `FMAT-IPD`: `mat 1451 of 2026`, `WPA (P) 156/25`, `W.P.A./4410/2026`, `CAN 2/2024 in WPST/71/2015`, `CPAN. No. 2041 of 2024`, old `WP 5120(W)/2019`.
- Rows tagged "with" the item above, and `in …` rows (the main case under a contempt or application), searchable like any other case.
- A fallback for every case number printed anywhere in the PDF, so a number that is not part of a regular row is still reported with its page.
- "New since last check" for listings that appeared after your previous check of the same date.

On the October 2026 monthly list (1,567 pages) it reads 30,295 listings in about 4 seconds. On the 13 October daily list (632 pages) it reads 10,758 in about 2. In both, every printed case number is accounted for.

## Develop

```bash
npm install
npm test          # parser tests on real cause lists in tests/fixtures
npm run build     # src/template.html + src/parser.js + src/example.json -> index.html
npm run parse -- path/to/list.pdf    # read any cause list and run the coverage check
npm run watch                        # one check of the court website (see watcher/README.md)
npm run report                       # what the watcher has seen
```

- `src/parser.js` turns pdf.js text items into case entries, with bench, court notes and VC link. It also holds the case number normaliser and the search. It runs unchanged in the browser and in Node.
- `src/template.html` is the page; `tools/build.js` inlines the parser into it.
- `tools/read-list.js` reads a PDF in Node with the same parser; `tools/parse.js` is the command-line check.

## Watcher

`watcher/` checks the court website on a schedule (GitHub Actions or `npm run watch -- --loop`), reads every new list and logs the results in `data/`. This is Phase 0 of the plan: no users yet, just proof that nothing is missed. See `watcher/README.md`.

## Plan

`docs/PLAN.md` covers automatic alerts: watching the court website, parsing each new list, and messaging users. It includes the measured publishing times (daily lists around 21:00 the evening before; supplementary lists on the same day between 10:00 and 15:00).

## Sign-in and the owner's page

The hosted site is for invited people only: they sign in with Google, and every API call checks the
sign-in. Set these in Vercel (Project → Settings → Environment Variables), then redeploy:

| Variable | What |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID (Google Cloud Console → APIs & Services → Credentials → Web application; add each site address as an authorised JavaScript origin) |
| `ADMIN_EMAILS` | the owner(s): always allowed in, and can open `/admin.html` |
| `ALLOWED_EMAILS` | optional: people who are always allowed in |
| `SESSION_HOURS` | how long a sign-in lasts (default 168 = 7 days) |
| `CHECKS_PER_HOUR` | checks allowed per person per hour (default 60) |

Everyone else is invited or removed on the owner's page (`/admin.html`): an overview, people with
their last activity, the watcher's health, and the full activity log with filters and CSV downloads.
Every sign-in, refused sign-in, sign-out, page open, check and invite is logged (who, when, IP, device,
how many cases; not the case numbers). Users never see the log.

**Moving to your own domain:** add the domain in Vercel (Settings → Domains), add it as another
authorised JavaScript origin on the Google OAuth client, and point the cron-job.org job at it (or leave
it on the vercel.app address, which keeps working). Invites and logs stay; people sign in once again.
