# PROJECT_CONTEXT: Kings Research SEO Workbench

Read this first. It is written for anyone who picks this project up later, including an AI assistant given only
this Drive folder: what the tool is, how it works, every file, where every piece of data lives, how changes are
made and shipped, and what is still open. Last updated 2026-11-23.

---

## 1. What the tool is

An internal web tool for the Kings Research (kingsresearch.com, a market research publisher) SEO and content team.
It covers the whole life of a report page:

1. **Keywords**: find report topics competitors rank for and Kings Research does not (Mangools keyword gap against
   5 competitors), decide New report / Revamp / Similar report against our reports sitemap, prioritise, give every
   topic its **must-use secondary keywords**, send to an analyst for verification, then a manager approves them into
   the **Research List**. In-house editors can add hand-picked keywords. **Keyword ideas** explores Mangools data
   (related keywords with trends, the keywords a page ranks for, the Google top 10) in plain words.
2. **RD**: the analyst pastes the Report Description (RD) draft; the tool highlights keyword use, requires the
   primary and must-use keywords, and finds data, grammar, structure and fact problems.
3. **Content**: reserved for the content team (empty).
4. **DM**: turns the final text into CMS-ready HTML (H2/H3 chosen from the content itself, segmentation table, images
   with alt text, internal links, meta title and description built from the content's own figures).
5. **Publish Check**: checks the preview page before publishing (including the report's keywords).
6. **Live Tracker**: syncs the reports sitemap to detect when approved reports go live, then checks the live page,
   including its Report Snapshot and Table of Contents tabs.
7. **Check results**: everyone can read every saved RD, Publish and Live check. Only the **check team** can run checks.
8. **API credits**: the API credit counter, shown only to the credit viewers.

Every step logs to one Google Sheet, **KR-Process**. Nothing runs on a schedule; everything starts on a click.
Everyone signs in with a @kingsresearch.com email.

A visual explainer is at `public/how-it-works.html` (served at `/how-it-works.html`).

## 2. People

| Person | Email | Role |
|---|---|---|
| Himanshu Singh | hsingh@kingsresearch.com | Owner and builder. Deploys the tool, owns the sign-in accounts, approves keywords, check team, credit viewer. |
| (Manager) | hummer@kingsresearch.com | Manager: approves keywords, adds in-house keywords, check team. |
| (Editor) | mmaniyar@kingsresearch.com | Adds in-house keywords, check team. |
| | ssengupta@kingsresearch.com | Check team. |
| | atale@kingsresearch.com | Check team, credit viewer. |
| | sb@kingsresearch.com | Check team, credit viewer. |
| habi@kingsresearch.com | | Former manager address, no longer used. |

The owner's GitHub account is `himanshusingh60120`. He works on Windows, in VS Code with PowerShell, in
`C:\Users\T-86\Desktop\HimanshuTools\kr-seo-workbench`.

What the owner cares about (learned over many sessions): checks must report **only real problems** (false alarms
erode trust), cost must stay very low (prefers free options), explanations in plain words, and confirmation of
exactly what changed and how to ship it.

## 3. Where everything lives

| Thing | Where |
|---|---|
| Source code (master copy) | Google Drive folder `kr-seo-workbench`, id `1LrgPOPQWtfN9Yq7kM4ftmylPy5QSm828` |
| Subfolders | `api` `1onT8RxnOUXrTejcwsaG2rrwkCsRg8kvW`, `lib` `15LOMPMGFt8h-0lIfK8cjsGSNRPxapUrw`, `public` `1RMZlQIo3E-wCLxJjdAUxG1Slfg-pXe6z`, `public/js` `1_HnPeBU42Ywo-PPUVjNT4HFkorkfHKN0` |
| Replaced file versions | Drive folder `_superseded (safe to delete)`, id `11Dxy2EOJlggkIBrL1ifi6EwjscJOBIFk` (not part of the project) |
| Parent Drive folder | id `1IEFcuEBnrIrF6h_vSsnSjR0AxV4fJnTF` |
| Git repository | GitHub `himanshusingh60120/kr-seo-workbench` (private), branch `main` |
| Hosting | Vercel, project imported from that repo (Framework "Other"), redeploys on every push to `main` |
| Data | Google Sheet **KR-Process**, id `1NDDgdv4DGNpO8aYzq9VTtyD10O0rfn2Foa0lNobUzjM` |
| Sign-in accounts | A private sheet if `USERS_SHEET_ID` is set (recommended), otherwise a hidden, edit-locked "Users" tab in KR-Process |
| Google service account | `kr-workbench@crawlseo-503406.iam.gserviceaccount.com` (Google Cloud project `crawlseo-503406`), must be Editor on KR-Process and on the private accounts sheet |
| Secrets | Only in Vercel environment variables. Never in the code, the sheet or this folder. |

Outside services: Mangools API (keywords, SERP, lookups left), OpenAI API (gpt-4.1-mini), Jev by TypeSafe AI (cheap
yes/no and choice judgments, through TypeSafe or Vercel AI Gateway), Tavily (web search, 1,000 free a month),
optionally Serper (backup search), kingsresearch.com sitemaps (reports, blogs, press releases).

## 4. How a request flows

```
Browser (public/index.html + public/js/*.js)
   |  POST /api/<endpoint>   body: { action, ...data, _token }
   v
Vercel serverless function (api/<endpoint>.js), Node, 60 s limit
   |  lib/http.js handler(): checks the session token (except api/auth.js), checks the check team for check
   |  actions, routes by "action", counts every paid call and logs the totals to "API Usage"
   v
lib/* -> Google Sheets API / Mangools / OpenAI / Jev / Tavily / kingsresearch.com pages and sitemaps
```

- **One npm dependency: `cheerio`** (declared in `package.json`, used by `lib/page.js` and `lib/outline.js` to read
  HTML pages). Everything else uses Node's built-in `fetch`, `crypto` and `async_hooks` (the Google service-account
  JWT is signed with `crypto`). Do not remove cheerio; do not add other packages without a good reason.
- Long jobs are split by the browser into many short calls (each server call must finish within 60 s).
- Sign-in: `api/auth.js` checks the password (scrypt hash with a per-user salt) and returns a session token signed
  with HMAC (`AUTH_SECRET`, or a secret derived from `GOOGLE_PRIVATE_KEY`, `MANAGER_PIN` and `OPENAI_API_KEY`, so
  changing one of those signs everyone out), valid 12 hours. The browser stores it in sessionStorage and sends it as
  `_token` in every request. A first sign-in with the starting password returns a "limited" token that can only
  change the password. Status 419 tells the browser to show the sign-in screen.
- **Check team:** `lib/http.js` holds `CHECKER_ONLY` = the check actions per endpoint (`rd`: review, claims, verify,
  links, save, decide; `pagecheck`: extract, check, save). The endpoint name comes from the request path. Anyone not
  in `CHECKERS` gets 403. `api/history.js` (open to everyone signed in) serves the saved results.
- **API credit counter:** `handler()` runs each action inside an `AsyncLocalStorage` store. `lib/openai.js`,
  `lib/jev.js`, `lib/search.js` and `lib/mangools.js` call `track()` after every successful paid call. When the
  request ends (success or failure) one row is appended to the "API Usage" tab. Logging is best effort: a sheet
  error never fails the user's request.
- The signed-in email (`req.user`) is what gets logged as "Checked By", "Writer", "Created By", "Scanned By",
  "Analyst", issue decision "By", DM "User" and the approver. No server action takes a name from the browser.

## 5. Every file

### Root
| File | Purpose |
|---|---|
| `README.md` | Guide for the team: tabs, roles, sign-in, checks, must-use keywords, credit counter, costs, deploy and update steps. |
| `PROJECT_CONTEXT.md` | This file. |
| `package.json` | Project info. One dependency: cheerio. |
| `vercel.json` | Vercel settings (function limits, `public` as the output folder). |
| `.gitignore` | Keeps local files such as `.env` out of git. |
| `.env.example` | Every environment variable with its default and a comment. |

### api/ (one serverless endpoint per file; the browser calls `POST /api/<file>` with an `action`)
| File | Actions |
|---|---|
| `auth.js` | `login`, `changePassword`. Open endpoint (no session needed). Writes the Users tab. |
| `keywords.js` | `gap`, `opportunities`, `lastScan`, `rank` (priority via Jev or OpenAI, plus a one-line market reason from OpenAI and a data line), `saveScan`, `mustHave` (must-use secondary keywords: one Mangools keyword-imports lookup for the standard report searches of up to 60 topics), `inhouseInfo` / `inhouse` (preview: volume, scope, must-use keywords, reason) / `inhouseAdd` (editors only), `serp`, `pageTerms`, `volumes`, `addRows`, `saveGroups`, `repair`, `list`, `verify` (with the Must Use tick), `decide` (managers only, signed-in email + `MANAGER_PIN`; writes the must-use keywords to the Research List), `research`. |
| `explore.js` | Keyword ideas: `ideas` (related keywords with trend), `pageKeywords` (keywords a URL or domain ranks for), `serp` (Google top 10 with website strength and our position). |
| `history.js` | `me` (email, check team, credit viewer), `list` / `get` (saved RD, Publish and Live checks for "Check results"), `credits` (the API credit counter, credit viewers only; reads "API Usage" and the live Mangools limits). |
| `rd.js` | `review` (rules + AI review, findings tested against the text), `decisions` / `decide` (the "not an error" log), `claims` (facts to check, with Fact Cache hits), `verify` (lite or deep engine, saves to Fact Cache), `links`, `save`. Also used by Publish and Live for facts. Check actions are check-team only. |
| `dm.js` | `links` (KR sitemaps for interlinking), `headings` (AI chooses H2 / H3 from the pasted blocks), `interlink` (AI picks anchors), `meta` (AI meta options; options with a number not in the content are dropped), `save`. |
| `pagecheck.js` | `extract` (read a report page), `check` with kinds `data`, `faq`, `language`, `image`, `meta`, `links`, `snapshot`, `toc`, and `save` (Publish Check / Live Check tabs, updates the Research List). Check-team only. |
| `sitemap.js` | `sync`: reads the reports sitemap into the Sitemap tab and marks Research List items live. |
| `setup.js` | `status` (settings shown in the Setup dialog), `init` (create / repair sheet tabs, lock the Users tab). |

### lib/ (shared server code)
| File | Purpose |
|---|---|
| `http.js` | `handler()` (routing, session check, check-team check, usage logging), session tokens (`signToken`, `verifyToken`), people (`checkers`, `isChecker`, `creditViewers`, `isCreditViewer`), `track()` for the credit counter, helpers: `nowIST`, `today`, `dayOf`, `fetchWithTimeout`, `pool`, `cap`, `slugify`, `titleCase`, `hostOf`, `competitors`, `isCompetitor`, `toList`. |
| `sheets.js` | Google Sheets access. `TABS` defines every tab and its header row (columns are matched by position; **only ever add columns at the end**). `ensureTabs` creates missing tabs/headers, hides and protects the Users tab (or uses `USERS_SHEET_ID`). `readTab`, `appendRows`, `updateCells`, `rewriteTab`. |
| `openai.js` | `chatJSON` (JSON chat completions, vision; temperature 0 and a fixed seed for gpt-4 models so reruns match), `webSearchJSON` (Responses API with web search, used by the deep fact-check). Counts tokens and estimated cost. |
| `jev.js` | `decide(state, questions)` for Jev: `choice` and `yesno` questions, via TypeSafe (`TYPESAFE_API_KEY`) or Vercel AI Gateway (`AI_GATEWAY_API_KEY`). `optionProb`. Counts calls. |
| `search.js` | Web search: Tavily first, Serper as backup. Drops market-report press releases from results. Counts searches. |
| `factcheck.js` | The fact-check engine: sentence splitting, candidate rules, Jev triage (public fact / own estimate / general), claim description (OpenAI), Fact Cache read/write, `verifyLite` (search + Jev), `verifyByLink` (read the sentence's own link + Jev, used when search is unavailable), `verifyDeep` (OpenAI web search), engine choice (`FACT_ENGINE`). |
| `checks.js` | Exact rules (CAGR maths, share against total, figures against the Overview, lint: spacing, full stops, MEA, the US, region and abbreviation forms, majority, repeated words), keyword coverage, key companies list, and the filters every AI finding must pass: `normIssues`, `isNonIssue`, `real`, `grounded`. |
| `prompts.js` | Every AI prompt: `HOUSE_RULES`, `NEVER` (limits that stop false alarms), `NUMBER_RULES`, and the task prompts for each check, the DM headings (`headingsSystem`, `headingsTask`) and meta options (`metaTask`). Tune wording here. |
| `mangools.js` | Mangools API calls (gap analysis, SERP, keyword imports up to 700 keywords, related keywords, competitor keywords, limits), the 12-month trend from the search history (`trendOf`), pacing notes and retries. Counts lookups (not the free limits call). |
| `topics.js` | Groups gap keywords into report topics, matches topics to our sitemap, cleans secondaries, heuristic priority, the OpenAI ranking prompt. |
| `seo.js` | SEO Check for keywords (Link instead / Duplicate / Low value / OK) and the RD section a keyword belongs in. |
| `outline.js` | Reads the top-10 ranking pages (title, meta, headings, opening text) for "More keywords". Uses cheerio. |
| `sitemap.js` | Fetches and parses the KR sitemaps (report, blog, press). |
| `page.js` | Fetches and parses a KR report page: description, FAQs, images, links, meta, and the Report Snapshot and Table of Contents tabs. Uses `KR_COOKIE` if preview pages need a login. Uses cheerio. |
| `linkcheck.js` | Checks URL status codes. |

### public/ (the browser side)
| File | Purpose |
|---|---|
| `index.html` | Page structure for every tab (including Keyword ideas, Check results and API credits) and the Setup dialog. Loads `js/core.js`, `blocks.js`, `checks-ui.js`, `keywords.js`, `rd.js`, `dm.js`, `live.js`, `main.js`. |
| `styles.css` | Brand styles. |
| `how-it-works.html` | Animated explainer of the data flow. Stand-alone, no sign-in needed, contains no secrets or emails. |
| `js/core.js` | The `KR` namespace: `KR.api()`, progress lists, tabs, toasts, icons, Setup dialog. |
| `js/blocks.js` | Paste handling: turns pasted Google Docs / Word / web / sheet content into paragraphs, lists, headings and tables without gluing paragraphs together. |
| `js/checks-ui.js` | Issue lists, the fact-check pipeline in the browser (Fact Cache reuse, verify batches, Deep check button), the Publish/Live page-check runner (with the report keyword check against the Research List, shown under "Meta, SEO & keywords") and results view. |
| `js/keywords.js` | Keywords tab: scan, rank, must-use keywords when sending, send to verification, analyst verification (Must use tick), manager approval (PIN only), Research List. Holds the shared Mangools pacing (`KR.mgPaced`) and the difficulty labels (`KR.kdLabel`, `KR.kdHtml`). |
| `js/explorer.js` | Keywords → Keyword ideas (loaded by `main.js`). |
| `js/inhouse.js` | In-house keyword panel (loaded by `main.js`, shown only to editors). |
| `js/rd.js` | RD tab: keyword highlights (primary, must use, secondary), missing required keywords as errors, faint-red problem shading, click-to-jump, saved results for an unchanged RD, automatic save to the RD sheet after each check. |
| `js/review.js` | The "Error" tick box on every RD issue and the Issue Decisions log (loaded by `main.js`). |
| `js/dm.js` | DM tab: AI headings with the Headings editor, figures read from the content for the meta boxes. |
| `js/live.js` | Publish Check and Live Tracker tabs. |
| `js/results.js` | Check results tab and roles (`KR.applyRoles` hides run buttons for people outside the check team and shows the API credits tab to credit viewers). Loaded by `main.js`. |
| `js/credits.js` | API credits tab (loaded by `main.js`). |
| `js/auth.js` | Sign-in screen, first-time password change, account bar (How it works, Change password, Sign out), adds `_token` to every request (loaded by `main.js`). |
| `js/main.js` | Start-up. Holds `CHECKS_VERSION`: **change it whenever the checks change**, so results saved in browsers by older checks are thrown away. Loads `auth.js`, `review.js`, `inhouse.js`, `results.js`, `credits.js`, `explorer.js`, requires sign-in, asks `history.me` what the person may do, then starts every tab. |

## 6. The Google Sheet (KR-Process)

Headers are written by the tool. Columns are matched by position: never reorder them; new columns go at the end.

| Tab | Columns |
|---|---|
| Opportunities | Scanned At, Scanned By, Location, Report Title, Action, Priority, KR Status, KR URL, Primary Keyword, Primary Volume, Total Volume, KD, Competitors Ranking, Best Position, Score, AI Reason, Secondary Keywords, In Pipeline |
| Keywords | ID, Group ID, Created At, Created By, Report Name, Seed Keyword, Location, Keyword, Type, Search Volume, KD, CPC, PPC, Competitor Pages, Source, AI Reason, Suggested Placement, Status, Analyst, Analyst Verdict, Analyst Reason, Verified At, Manager, Manager Note, Decision At, Action, Existing URL, SEO Check, **Must Use** |
| Research List | Group ID, Report Name, Primary Keyword, Secondary Keywords, Primary Search Volume, Primary KD, Analyst, Approved By, Approval Date, Live Status, Live URL, Report ID, Live Date, Detected On, Last Live Check, Live Check Summary, Action, Existing URL, **Must-use Keywords** |
| RD | Checked At, Writer, Report Name, Primary Keyword, Word Count, Keywords Found, Keywords Missing, Data Consistency, Language & Style, Structure, Fact Check, External Link Suggestions, Issue Count |
| Content | Date, Writer, Report Name, Notes |
| DM | Optimized At, User, Keyword, Image URL, Image Alt, Meta Title, Meta Description, Interlinks, H2 Count, H3 Count, Word Count |
| Sitemap | URL, Report ID, Slug, Name, Lastmod, First Seen, Last Seen, In Sitemap |
| Live Check, Publish Check | Checked At, URL, Report Name, Checked By, Status, Total Issues, Data Consistency, Facts, FAQs, Image, Spelling & Grammar, Meta & SEO, Links, Snapshot, TOC |
| Fact Cache | Key, Sentence, Claim, Anchor, Date, Verdict, Correction, Source URL, Source Title, Note, Engine, Confidence, Checked At, Report |
| Issue Decisions | At, By, Report, Decision, Section, Severity, Problem, Quote, Key (rows are only added; the latest row per Report + Key is the current decision) |
| Users | Email, Salt, Password Hash, Must Change, Created At, Updated At, Last Login (private sheet, or hidden and protected tab) |
| **API Usage** | At, User, Endpoint, Action, OpenAI Calls, OpenAI Input Tokens, OpenAI Output Tokens, OpenAI Web Searches, OpenAI Cost USD, Jev Calls, Jev Cost USD, Tavily Searches, Serper Searches, Mangools Lookups, Total Cost USD (one row per request that used a paid service) |

"Sheet1" in KR-Process is unused. RD, Publish Check and Live Check rows store each finding as one line,
`N. [severity] Section: problem -> fix | "quote"`; `public/js/results.js` reads that format back for "Check results",
so keep it if those columns change. The report keyword findings of Publish and Live are stored in "Meta & SEO".

Keyword statuses: Pending Verification → Verified → Approved / Excluded / Rejected. Live statuses on the Research
List: Not live, Revamp pending, Live.

## 7. Environment variables (set in Vercel)

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | (required) | |
| `MANGOOLS_API_KEY` | (required) | |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | (required) | |
| `GOOGLE_PRIVATE_KEY` | (required) | The private_key from the service-account JSON, with `\n` kept. |
| `MANAGER_PIN` | (required) | PIN for approving keywords. |
| `TYPESAFE_API_KEY` or `AI_GATEWAY_API_KEY` | none | Jev. Without it, triage and priority fall back to OpenAI and facts use the deep engine. |
| `TAVILY_API_KEY` | none | Free web search for the lite fact-check. |
| `SERPER_API_KEY` | none | Backup search. |
| `CHECKERS` | hummer@, ssengupta@, mmaniyar@, hsingh@, atale@, sb@ | The check team: only they can run RD, Publish and Live checks. |
| `CREDIT_VIEWERS` | sb@, hsingh@, atale@ | Who sees the API credits tab. |
| `MANAGER_EMAILS` | hummer@, hsingh@ | Approvers. `MANAGER_EMAIL` (older) is added to the list. |
| `INHOUSE_EDITORS` | mmaniyar@, hummer@ | In-house keyword editors. |
| `USERS_SHEET_ID` | none | Private sheet for sign-in accounts (recommended). |
| `USERS_OWNER` | hsingh@kingsresearch.com | Only editor of the Users tab when it is in KR-Process. |
| `FIRST_PASSWORD` | 1234 | Starting password. |
| `LOGIN_EMAIL_DOMAIN` | kingsresearch.com | |
| `AUTH_SECRET` | derived | Signs sessions; changing it signs everyone out. Set it before rotating other keys. |
| `FACT_ENGINE` | auto | `lite` (search + Jev), `deep` (OpenAI web search), `both` (compare). Auto = lite when a Jev key is set. |
| `FACT_MIN_CONFIDENCE` | 0.8 | Jev confidence needed for a verdict to stand. |
| `FACT_CACHE_DAYS` | 180 | |
| `FACT_TRIAGE`, `DECISION_ENGINE` | jev | Set to `openai` to stop using Jev for those jobs. |
| `JEV_MODEL`, `JEV_GATEWAY_MODEL` | jev-latest, typesafe-ai/jev | |
| `OPENAI_PRICE_IN`, `OPENAI_PRICE_OUT` | 0.40, 1.60 | USD per million tokens, for the credit counter. |
| `OPENAI_WEB_SEARCH_PRICE` | 0.01 | USD per OpenAI web search (estimate), for the credit counter. |
| `JEV_PRICE_PER_CALL` | 0 | Optional Jev cost per call for the credit counter. |
| `TAVILY_MONTHLY_LIMIT` | 1000 | Free Tavily searches per month, shown as a bar. |
| `OPENAI_MONTHLY_BUDGET` | 0 | Optional monthly OpenAI budget in USD, shown as a bar. |
| `GOOGLE_SHEET_ID` | KR-Process id | |
| `TEAM_ACCESS_KEY` | none | Extra shared key, older than sign-in; normally unset. |
| `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_SEARCH_MODEL` | gpt-4.1-mini | |
| `OPENAI_WEB_SEARCH` | true | |
| `COMPETITORS` | marketresearchfuture.com, futuremarketinsights.com, marketsandmarkets.com, precedenceresearch.com, persistencemarketresearch.com | |
| `MANGOOLS_LANGUAGE_ID` | 0 | |
| `SITE_BASE` | https://www.kingsresearch.com | |
| `APP_TIMEZONE` | Asia/Kolkata | |
| `KR_COOKIE` | none | Only if preview pages need a login. |

As of 2026-11-23 it is not confirmed whether `TAVILY_API_KEY`, `TYPESAFE_API_KEY` and `USERS_SHEET_ID` have been
added in Vercel. The Setup dialog in the tool shows which keys are set.

## 8. How the main features work

**Keyword opportunities.** Mangools gap analysis (kingsresearch.com against each competitor, one lookup each, paced
about 11 s apart because Mangools allows 3 calls per 30 s) → `topics.groupGap` turns keywords into report topics
(primary is always "<topic> market") → matched against the reports sitemap (exact = Revamp, close = Similar report
exists, none = New report) → priority: search volume and competitor counts (`heuristicPriority`), adjusted by Jev's
judgment of commercial demand, plus Jev decides whether a topic is a sellable report and whether a similar report is
the same market → reason: one OpenAI-written line on why the market is worth a report (numbers banned so nothing is
invented) + "Data: <searches>; <competitors>; KD". The top High-priority topics are sent to analyst verification
automatically. Scans are saved to Opportunities and the last scan reloads.

**Must-use secondary keywords.** When topics are sent to verification, the browser calls `keywords.mustHave` once
(paced like every Mangools call). The server builds ten standard report searches per topic (`VARIANTS`: size, share,
growth, trends, forecast, analysis, report, industry, companies, global ... market), gets their volumes with one
keyword-imports lookup and picks (`pickMustUse`): every variant with at least 10 searches a month, plus the three
best-searched competitor variants the topic already has; if fewer than five, the core searches (size, share, growth,
trends, forecast) fill up. `groupObjects` → `withMustUse` guarantees every saved group has must-use rows even when the
lookup failed. The analyst can change "Must use" per keyword (at least one Good secondary must stay must-use). On
approval the must-use list goes to the Research List ("Must-use Keywords"). The RD tab fills them in; the RD, Publish
and Live checks report a missing primary or must-use keyword as an error. In-house keywords get the same must-use
keywords from the same lookup as their volume.

**Keyword ideas.** `api/explore.js` calls Mangools related keywords (`ideas`), competitor keywords for a URL
(`pageKeywords`) and the SERP (`serp`). Each keyword gets a 12-month trend (last 3 months against the same months a
year earlier: rising ≥ +20%, falling ≤ -20%), and flags for questions, report-style wording, single countries,
brands/junk and the SEO check. The browser shows difficulty in Mangools' words (very easy < 15, easy < 30, possible
< 50, difficult < 70, hard < 85, very hard). Ticked keywords go to a pending group through `keywords.addRows`.

**In-house keywords.** Editors paste keywords; "Check keywords" returns volume, scope (sitemap match + pipeline
status), must-use keywords and a reason, without saving; "Add selected" creates one keyword group per report
(Source "In-house") with its must-use keywords, waiting for analyst verification.

**RD check.** Keyword highlight and counts happen in the browser (primary, must use, secondary). The server runs
exact rules (`checks.js`) and one AI review (`prompts.rdReviewTask`); AI findings are kept only if their quote is in
the text and they pass `real()` / `isNonIssue()`. Language-type items filed under consistency are moved to language.
Missing primary or must-use keywords are errors in "Keyword requirements" (saved under Structure). Problems are
shaded faint red in the text. Results for an unchanged RD are cached in the browser for 24 hours (cleared when
`CHECKS_VERSION` changes). Every finished check is saved to the RD sheet automatically.

**Fact-check.** Rules pick candidate sentences (month-year date or event word) → Fact Cache lookup by a hash of the
normalised sentence → Jev keeps public facts → OpenAI writes a one-line claim and the anchor for new facts →
verify: lite (Tavily search, Jev judges each result as confirms / conflicts / unrelated), falling back to the
sentence's own link when search is unavailable; deep (OpenAI web search) only via `FACT_ENGINE` or the Deep check
button → verdicts (Supported, Partially supported, Contradicted, Unverifiable, Check manually) saved to the Fact
Cache. Follow-on sentences with no date or proper name are not checked. Competitor sites, report sellers and
market-report press releases are never sources.

**Not an error.** Each RD issue has an "Error" tick box (`js/review.js`, check team only). Unticking appends a row to
Issue Decisions (By = signed-in email). Issues are matched by report name + the letters and digits of the quote. On
the next check of the same report the issue is faded with "<email> marked this as not an error on <date>".

**DM.** The browser summarises every pasted block (SHORT line, LONG paragraph, LIST item, TABLE, HEADING) and
`dm.headings` asks the AI which SHORT/HEADING blocks are H2 (main sections) or H3 (topics inside them), with an
optional clearer wording for vague headings that may only use words from the text. If the AI fails or finds no H2,
the standard section names are used (the old rules). Each H2's section (overview, highlights, dynamics,
segmentation, segmental, regional, competitive, methodology, faq) is recognised from its words, so lists, the
segmentation table and interlink eligibility keep working. The Headings table lets the user change any level
(H2 / H3 / Text) or wording, and apply the suggestions. Images: first = infographic, alt text only in the alt
attribute, caption lines that repeat the alt text are removed. Internal links from the three sitemaps with an AI
step. **Meta:** `figuresFrom` reads the market size by year, the CAGR and the forecast period from the text before
the first section, the Overview and the highlights (or the whole text if none there) exactly as written; the title
and description are built from those figures, and the figures are shown above the boxes. "More options (AI)"
passes the figures to the AI and the server drops any option with a number that is not in the content.

**Publish and Live checks.** `page.extract` reads the page; the browser runs each check kind in parallel; then it
finds the report in the Research List (by URL, else by name) and checks the primary and must-use keywords on the
page (H1, meta title, description, FAQs); results are saved to Publish Check or Live Check. Report Snapshot and Table
of Contents only run in Live. Every AI finding is grounded (quote must be in the right source: TOC findings must
quote the TOC, Snapshot findings the Snapshot).

**Check results.** `history.list` reads the RD, Publish Check and Live Check tabs and returns the newest 300 (filter
by type, report, URL or person); `history.get` returns one row's text columns, which `js/results.js` turns back into
issues. Rows from people outside the check team (from before the rule) are marked.

**API credits.** See section 4 for the counting. `history.credits` adds up the "API Usage" rows for this month,
today, each person, each feature and the last 30 days, and calls Mangools `/kwfinder/limits` (free) for the keyword
and SERP lookups left.

## 9. Check rules agreed with the owner

- Report only real problems. No "consistent / no conflict" notes, no "please confirm / double-check" items, no
  wording-taste advice, no invented house style, never change company names.
- Do not flag masked numbers (X.XX%, XX.X%). Infographic items only when they contradict the content.
- A region or segment value is part of the market: never compare it with the market total. Check share × total
  instead (example from a real page: 35.43% of USD 2,280 million is USD 807.8 million, but the page said USD 830.6
  million, which is 36.43%; that is a real error).
- North America is always "U.S., Canada, and Mexico" (no "Rest of North America").
- Superlatives are judged within one segmentation category.
- Do not expect company names in the TOC. "Table of Contents" spelling is standard; website tab labels are ignored.
- Combined regions are written "Middle East & Africa" and "South & Central America"; "MEA" is flagged.
- Every report has must-use secondary keywords, and a missing one is an error.

House rules given to the AI are in `lib/prompts.js` (`HOUSE_RULES`).

## 10. Costs (estimates, November 2026 prices)

- Exact rules, Fact Cache reuse: free. Tavily search: free up to 1,000 a month. Jev: under 1 cent per report.
- OpenAI (gpt-4.1-mini at USD 0.40 / 1.60 per million input/output tokens): about 5 to 10 cents per report across
  RD, publish and live. Deep check: 1 to 3 cents per click. DM headings: well under 1 cent per page.
- Total about 6 to 12 cents per report (it was about USD 1 to 1.50 before the Fact Cache, Jev and Tavily).
- The API credits tab now shows the real usage and estimated cost.
- Vercel: the Hobby plan is for non-commercial use only; business use needs Pro (about USD 20 a month).
- Mangools: covered by the plan; the API credits tab shows the lookups left.

## 11. How to make and ship a change

**For an AI assistant working through the Google Drive connector:**

1. Read the current file first (`read_file_content` with the file's id; find ids with `search_files` and
   `parentId = '<folder id>'`). Never edit from memory.
2. The text returned by `read_file_content` is markdown-escaped and JSON-encoded: a real backslash shows as several
   backslashes, and `_ # [ ] * < > !` show with a backslash in front. Write real code (for example `/\s+/g`), not the
   escaped form. `create_file` with `textContent` writes the text exactly as given (confirmed with a test file on
   2026-11-23).
3. The connector cannot overwrite a file's content. To update a file: create a new file with the same name in the
   same folder (`create_file` with `textContent`, the right `contentMimeType`, and
   `disableConversionToGoogleType: true`), then move the old file into `_superseded (safe to delete)`
   (`update_file` with `parentId: 11Dxy2EOJlggkIBrL1ifi6EwjscJOBIFk`). Keep exactly one copy of each file in the
   project folders.
4. Keep code comments in plain English and keep the existing style (no build step, `'use strict'`, no new npm
   packages; cheerio is the only one).
5. If a check changes, bump `CHECKS_VERSION` in `public/js/main.js`.
6. New sheet columns only at the end of a tab's header list in `lib/sheets.js`.
7. Code cannot be run inside a chat. Say clearly that changes are untested until deployed, and ask the owner for the
   tool's output after deploying.

**For the owner (shipping):**

1. Download the `kr-seo-workbench` folder from Drive, copy its contents over the local project (keep `.git`).
2. In VS Code:
   ```
   git add .
   git commit -m "What changed"
   git push
   ```
3. Vercel redeploys. Hard-refresh the tool (Ctrl+Shift+R).
4. If the push is rejected, something was changed on the GitHub website (this happened when files were deleted
   there). Run `git fetch origin`, check `git log HEAD..origin/main --oneline --stat` (press q to exit), and if
   nothing there is worth keeping, `git push --force-with-lease origin main`.
5. After check changes, clear the rows in the "Fact Cache" tab (keep the header) if old verdicts should not be
   reused, and use Shift+click on "Verify content" to bypass the browser's saved RD results.
6. After a change that adds sheet tabs or columns, click Setup → Create / repair sheet tabs once.

## 12. Open items and known limits (as of 2026-11-23)

- **Untested changes of 2026-11-23:** check team and Check results, API credit counter, must-use keywords, Keyword
  ideas, DM headings from the content and meta from the content's figures. All written without running; check them
  after deploying (see the test list given to the owner).
- **Untested parts:** the Jev and Tavily integrations have not been confirmed working on the live tool (keys may not
  be set yet). The first live runs confirmed sign-in, the share check, the Fact Cache, and the AI-finding filters.
- **Sheets write quota:** the credit counter adds one sheet write per paid request. Google allows about 60 writes a
  minute for the service account; if many people run checks at once some usage rows may be skipped (logged in
  Vercel), but no check fails because of it.
- **Inconclusive fact verdicts are cached:** lite "Unverifiable" and "Check manually" verdicts are kept in the Fact
  Cache for 180 days; only a Deep check replaces them.
- **Share check:** a share given against a region (for example "45% of the North America market") is compared with
  the global total and can be flagged wrongly. "Rest of North America" is not flagged by the rules, and the lint rule
  for ", Rest of ..." suggests ", and Rest of North America". Both found in the 2026-11-23 review; not yet fixed.
- **Sign-in:** no limit on failed attempts (600 ms delay only); the starting password defaults to 1234.
- **Sign-in accounts:** move them to a private sheet (`USERS_SHEET_ID`). Not yet done.
- **Rotate the Google service-account key:** the original key JSON was pasted into a chat early in the project.
  Set `AUTH_SECRET` first, then create a new key in Google Cloud (project crawlseo-503406), update
  `GOOGLE_PRIVATE_KEY` in Vercel, delete the old key.
- **AI review is not perfect:** it can still miss a typo or raise a wrong item now and then. The Error tick box
  exists for this in the RD tab; Publish Check and Live Tracker do not have it yet.
- **how-it-works.html** still describes the roles before the check team and credit counter; update it.
- **Content tab:** empty, waiting for the content team's needs.
- **Paste handling:** a paste that lost paragraph breaks once produced dozens of false "missing space after full
  stop" warnings; `blocks.js` was rewritten to prevent it, and the source of that paste was never confirmed.
- **Vercel plan:** Hobby is non-commercial only; decide on Pro.
- The `_superseded (safe to delete)` folder can be emptied at any time (it also holds `_escape_test.js`).

## 13. Key decisions, in order

1. Built as a Vercel app with Google Sheets as the database (no separate database).
2. Keyword workflow: competitor gap → topics → analyst verification → manager approval → Research List. Single
   keyword research was removed. No separate keyword brief for writers: the RD tab highlights keyword use instead.
3. DM: alt text only inside the image tag, never as page text.
4. Cost cutting (from about USD 1.50 per report): Fact Cache, Jev for judgments, Tavily free search with a fallback
   to checking the sentence's own link. Multiple free Serper accounts were rejected (against Serper's terms).
5. Sign-in for everyone with a starting password, then their own; accounts hidden from the team.
6. "Not an error" decisions logged per person, so the team can see who dismissed what.
7. In-house keywords for named editors; a one-line market reason on every automated topic.
8. Checks hardened against false alarms: grounded quotes, no "no conflict" items, share maths instead of comparing
   parts with totals, temperature 0 for repeatable results.
9. (2026-11-23) Checks are run only by a named check team; everyone else reads the results in "Check results". RD
   checks are saved automatically so they can be read.
10. (2026-11-23) Every report has must-use secondary keywords (standard report searches with volume, at least five),
    required at RD, Publish and Live.
11. (2026-11-23) DM headings come from the content (AI), not a fixed list; meta boxes use the content's own figures.
12. (2026-11-23) An API credit counter for sb@, hsingh@ and atale@, counting every paid call per person and feature,
    with the Mangools lookups left read live.
13. (2026-11-23) Keyword ideas tab on Mangools related keywords, page keywords and SERP data, in plain words.
14. (2026-11-23) All names saved to the sheet come from the sign-in; the approval screen has no email box.
