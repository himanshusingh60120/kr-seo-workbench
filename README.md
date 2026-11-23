# Kings Research SEO Workbench

One tool for the whole report pipeline: **Keywords → RD → Content → DM → Publish Check → Live Tracker**, with every step logged to the Google Sheet **KR-Process**. Nothing runs on a schedule: every action starts when someone clicks a button.

- **How it works, visually:** open `/how-it-works.html` on the tool's address (or click **How it works** at the top right of the tool). It shows how data moves through each step.
- **For developers and AI assistants:** read `PROJECT_CONTEXT.md` first. It explains every file, where all data lives, and how to make and ship a change.

## Sign-in

- Everyone signs in with their **@kingsresearch.com** email before the tool opens. The session lasts until the browser tab is closed (12 hours at most).
- **First time:** the password is the starting password (`FIRST_PASSWORD`, default `1234`). The tool then makes the person set their own password (at least 6 characters).
- **How it works**, **Change password** and **Sign out** are beside the name box at the top right. The name box shows the signed-in email, and everything saved to the sheet is logged against it.
- **Forgotten password:** delete that person's row in the sign-in accounts (see below). Their next sign-in uses the starting password again.
- Until someone has signed in for the first time, anyone who knows their email and the starting password could claim their account. Ask the team to sign in once, soon after deployment.

### Where sign-in accounts are kept

Passwords are never stored as text, only as salted hashes.

- **Recommended: a private sheet.** Create a Google Sheet that only hsingh@kingsresearch.com owns, share it with the service account (`kr-workbench@crawlseo-503406.iam.gserviceaccount.com`) as Editor and nobody else, and set `USERS_SHEET_ID` in Vercel to its ID. Then nobody else can see the accounts at all. Delete the old "Users" tab from KR-Process afterwards; everyone signs in once more with the starting password.
- **Without `USERS_SHEET_ID`:** the accounts sit in a "Users" tab in KR-Process, which the tool hides and edit-locks so only hsingh@kingsresearch.com and the tool can change it. Other people who can open KR-Process could still unhide the tab and read it.

## Who can do what

| Role | Who | Can |
|---|---|---|
| Everyone | Any @kingsresearch.com email | Use the Keywords and DM tabs, and **read** every check in **Check results** |
| Check team | hummer@, ssengupta@, mmaniyar@, hsingh@, atale@, sb@ (`CHECKERS`) | **Run** RD, Publish and Live checks, and mark RD issues as "not an error" |
| Credit viewers | sb@, hsingh@, atale@ (`CREDIT_VIEWERS`) | See the **API credits** tab |
| In-house keyword editors | mmaniyar@, hummer@ (`INHOUSE_EDITORS`) | Add hand-picked keywords to the pipeline |
| Managers | hummer@, hsingh@ (`MANAGER_EMAILS`) | Approve or reject keyword groups, with the manager PIN |
| Accounts owner | hsingh@ (`USERS_OWNER`) | The only person who can edit the sign-in accounts |

People outside the check team see no run buttons on the RD, Publish Check and Live Tracker tabs, and the server refuses check actions from them. Approval uses the account you are signed in with; there is no email box on the approval screen.

## What each tab does

| Tab | What it does | Sheet tab |
|---|---|---|
| **Keywords → 1 · Find opportunities** | Mangools keyword-gap analysis of kingsresearch.com against the 5 competitors, grouped into report topics and checked against our reports sitemap: not published → **New report**, published but not ranking → **Revamp**. Each topic gets a priority and a reason. Every topic sent to analyst verification (automatically or by hand) gets its **must-use secondary keywords** (see below). **More keywords** reads the pages ranking in Google's top 10 and adds secondary keywords from them. The last scan reloads from the sheet. | Opportunities, Keywords |
| **Keywords → Keyword ideas** | Mangools data in plain words. **Ideas for a keyword**: related searches with monthly volume, a 12-month trend line (rising, stable, falling), difficulty in words (very easy to very hard) and ad value; filters for report-style searches, questions (good FAQ headings), rising interest and easy keywords. **What a page ranks for**: the searches a competitor's page or domain ranks for. **Who ranks on Google**: the top 10, how strong those websites are, and where Kings Research ranks. Ticked keywords can be added to a group waiting for verification, optionally as must-use. | Keywords |
| **Keywords → in-house keywords** | Shown only to the in-house keyword editors. Paste keywords, click **Check keywords** to see each one's volume, scope, must-use secondary keywords and a reason, then **Add selected to the pipeline**. Nothing is saved before that click. | Keywords |
| **Keywords → 2 · Analyst verification** | Good / Not good + reason per keyword, and a **Must use** tick per secondary keyword (at least one Good secondary must be must-use). **Suggest more secondary keywords** reads the top-10 pages and adds the ticked ones to the group. | Keywords |
| **Keywords → 3 · Manager approval** | The signed-in manager enters the PIN and approves → Research List with the approval date and the must-use keywords. | Research List |
| **RD** | Paste the RD: every use of the primary, must-use and secondary keywords **highlighted in colour with a count**; a missing primary or must-use keyword is an **error**; the text of every problem **shaded faint red**; plus data consistency, grammar, structure, fact-check, external link suggestions, link status. Each finished check is **saved automatically** so the team can read it. Each issue has an **Error** tick box. | RD, Fact Cache, Issue Decisions |
| **Content** | Reserved for the Content team. | Content |
| **DM** | **Headings chosen from the pasted content itself** (AI reads the whole text and decides H2 and H3; the standard section names are only the fallback), with a **Headings** table to change any level or wording and AI wording suggestions; segmentation table, internal links, one or more images (alt text only inside each image's HTML `alt` attribute); CMS boxes where the **meta title and description are built from the content's own figures** (market size by year, CAGR, forecast period), with the figures shown so they can be checked. | DM |
| **Publish Check** | Preview URL → data consistency, facts, FAQs, infographic numbers vs content, spelling, meta, **the report's primary and must-use keywords**, links. | Publish Check, Fact Cache |
| **Live Tracker** | Sync the reports sitemap → reports and revamps marked Live with their date → live checks (everything above **plus Report Snapshot and Table of Contents**). | Sitemap, Live Check, Research List, Fact Cache |
| **Check results** | Every RD, Publish and Live check run by the check team, newest first, with all of its findings. Filter by type, report, URL or person. | reads RD, Publish Check, Live Check |
| **API credits** | Shown only to the credit viewers: estimated cost this month and today, OpenAI calls, Jev decisions, Tavily searches against the 1,000 free a month, **Mangools lookups left (live from Mangools)**, usage by person, by feature and by day. | API Usage |

## Must-use secondary keywords

Every report gets secondary keywords it must contain, so the page answers more of the searches people make:

1. When a topic is sent to analyst verification, one Mangools lookup checks the standard report searches for it: `<topic> market size`, `share`, `growth`, `trends`, `forecast`, `analysis`, `report`, `<topic> industry`, `<topic> companies` and `global <topic> market`. Each one with at least 10 searches a month becomes **must use**, together with the three best-searched variants competitors rank for.
2. Every report has at least five must-use keywords: if Mangools finds too few, the standard searches (size, share, growth, trends, forecast) fill the gap. If the lookup fails, the server adds them when the group is saved.
3. The analyst can change the **Must use** tick on each secondary keyword; at least one Good secondary must stay must-use.
4. On approval the must-use keywords go to the Research List (**Must-use Keywords** column). Groups approved without any marked must-use keyword get the best-searched approved secondaries, or the standard searches.
5. The RD tab fills them in when the report is picked, and the RD, Publish and Live checks report a missing primary or must-use keyword as an error.

## Marking an RD issue as "not an error"

- Every issue in the RD results has a ticked **Error** box. If the issue is not really an error, untick it (check team only).
- The tool saves a row in the **Issue Decisions** sheet tab: who (their sign-in email), when, which report, and the issue.
- When anyone checks the **same report** again (same report name), that issue is shown faded with the note "xyz@kingsresearch.com marked this as not an error on <date>", and its red shading is removed.
- Ticking the box again is saved too. Rows are only ever added, so the tab is a full history of who dismissed what.
- Issues are matched by report name and the quoted text. An edited sentence counts as a new issue.

## The checks

### Exact rules (same answer every run, no cost)

- The CAGR matches its own start and end values.
- A share matches its value and the market total for that year (for example 35.43% of USD 2,280 million must be USD 807.8 million).
- Every mention of the market size matches the Overview. A region or segment value is a part of the market and is never compared with the total.
- "Majority" is only used for more than 50%.
- No missing space after a full stop, no double spaces, no repeated words, every paragraph ends with a full stop.
- No "MEA" (write "Middle East & Africa"), no "the US" (write "the U.S."), and no region or abbreviation written two ways ("Asia Pacific" and "Asia-Pacific", "ARTS" and "ARTs").
- The primary keyword and every must-use keyword are in the text.

### AI review (gpt-4.1-mini)

Spelling and grammar, the same figure given two different values, missing sections and undiscussed regions, FAQ answers against the description, infographic numbers against the text, Report Snapshot and Table of Contents against the text.

Before an AI finding is shown it must pass these tests:

- The text it quotes must really be on the page.
- Its fix must change something.
- Notes that say there is no conflict, requests to "double-check", "appears only once" notes and wording advice are dropped.
- The AI may not invent style rules or change company names.
- The model gives its most likely answer every time (temperature 0), so a rerun on the same page matches.

The AI can still occasionally miss a typo or raise a wrong item. Use the **Error** tick box for those.

### Check rules agreed with the team

- North America is always "U.S., Canada, and Mexico" (no "Rest of North America").
- Superlatives are judged per segmentation category (the fastest deployment mode and the fastest technology can both be "fastest").
- FAQ answers that repeat the description word for word are never flagged; extra explanation in an FAQ is fine.
- Infographic: only numbers or statements that **contradict** the content are flagged. Masked values (XX.X%, X.XX%) and numbers the content doesn't mention are fine; styling is never flagged.
- Table of Contents: company names are not expected there; website labels such as "Table Of Content" are ignored.
- Fact-check: competitor sites, other report sellers and market-report press releases are never used as sources; a source must mention the organization (or a key term) of the claim.

## The API credit counter

- Every server request that uses a paid service adds one row to the **API Usage** sheet tab: who, when, which feature, OpenAI calls and tokens, OpenAI web searches, Jev decisions, Tavily and Serper searches, Mangools lookups, and the estimated cost.
- The **API credits** tab (credit viewers only) adds these up for this month, today, each person, each feature and the last 30 days, shows the Tavily free searches used against `TAVILY_MONTHLY_LIMIT` (1,000) and reads the Mangools lookups left live from Mangools (a free call).
- Costs are estimates from token counts at `OPENAI_PRICE_IN` / `OPENAI_PRICE_OUT` (gpt-4.1-mini by default). The OpenAI web-search price per search (`OPENAI_WEB_SEARCH_PRICE`) is an estimate. Jev is counted; set `JEV_PRICE_PER_CALL` to include it in the cost.
- Counting starts from the deploy that added the counter.

## Keeping the AI cost down

1. **Each fact is checked once.** Every checked sentence is stored in the **Fact Cache** sheet tab with its verdict and source, and reused for 180 days (`FACT_CACHE_DAYS`) at RD, Publish and Live. An edited sentence counts as new.
2. **Only public facts are checked.** Plain rules pick sentences with a month-and-year date or an event word; **Jev** labels each one (public fact, own estimate, general statement). Our own market numbers are never sent to the web.
3. **Free web search.** A new fact gets one **Tavily** search (1,000 free searches every month), and Jev judges each result. Below the confidence threshold (`FACT_MIN_CONFIDENCE`, default 0.8) the claim is marked **Check manually**.
4. **No search available** (no key, the month's free searches used up, service down): the tool reads the page the sentence already links to and Jev judges it. A sentence with no link is marked **Check manually**. Nothing paid is used automatically.
5. **Deep check button** on every claim: OpenAI web search for that one claim (1 to 3 cents), only when clicked.
6. **Unchanged RD:** if nothing changed since the last "Verify content" (within 24 hours, same browser), the saved results are shown. Hold **Shift** and click to force a full re-run. Saved results are cleared automatically whenever the checks are updated.

Estimated cost: about 6 to 12 cents per report across the RD, publish and live stages (November 2026 prices). The **API credits** tab shows the real figures.

## Deploy and environment

1. Required Vercel variables: `OPENAI_API_KEY`, `MANGOOLS_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `MANAGER_PIN`.
2. Cost savers (recommended): ONE Jev key, either `TYPESAFE_API_KEY` (console.typesafe.ai) or `AI_GATEWAY_API_KEY` (Vercel AI Gateway), and `TAVILY_API_KEY` (tavily.com). `SERPER_API_KEY` is an optional backup search.
3. People and sign-in (optional, defaults shown in `.env.example`): `CHECKERS`, `CREDIT_VIEWERS`, `MANAGER_EMAILS`, `INHOUSE_EDITORS`, `USERS_OWNER`, `USERS_SHEET_ID`, `FIRST_PASSWORD`, `LOGIN_EMAIL_DOMAIN`, `AUTH_SECRET`.
4. Credit counter (optional): `OPENAI_PRICE_IN`, `OPENAI_PRICE_OUT`, `OPENAI_WEB_SEARCH_PRICE`, `JEV_PRICE_PER_CALL`, `TAVILY_MONTHLY_LIMIT`, `OPENAI_MONTHLY_BUDGET`.
5. Other optional settings: `FACT_ENGINE`, `FACT_MIN_CONFIDENCE`, `FACT_CACHE_DAYS`, `FACT_TRIAGE`, `DECISION_ENGINE`, `JEV_MODEL`, `TEAM_ACCESS_KEY`, `GOOGLE_SHEET_ID`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_SEARCH_MODEL`, `OPENAI_WEB_SEARCH`, `COMPETITORS`, `MANGOOLS_LANGUAGE_ID`, `SITE_BASE`, `APP_TIMEZONE`, `KR_COOKIE`.
6. Share KR-Process with the service-account email as Editor; enable the Google Sheets API.
7. In the tool: **Setup → Create / repair sheet tabs** (adds Fact Cache, Users, Issue Decisions and API Usage, adds the new Must Use and Must-use Keywords columns, and locks the Users tab), then **Fix existing keyword rows**. The Setup dialog shows the fact-check engine, whether the Jev and web search keys are set, and where the sign-in accounts are kept.

## Updating the tool

1. Download the updated `kr-seo-workbench` folder from Drive and copy its contents over the local project (`C:\Users\T-86\Desktop\HimanshuTools\kr-seo-workbench`). Keep the hidden `.git` folder.
2. In the VS Code terminal:
   ```
   git add .
   git commit -m "What changed"
   git push
   ```
3. Vercel redeploys automatically. Hard-refresh the tool (Ctrl+Shift+R).
4. Never delete files on the GitHub website: it makes the next push fail. If that happens, run `git fetch origin`, check `git log HEAD..origin/main --oneline` (press q to leave the list), then `git push --force-with-lease origin main`.
5. After a change to the checks, delete the rows in the "Fact Cache" tab (keep the header) if old verdicts should not be reused.

## Mangools lookups

- Find opportunities: one lookup per competitor per page.
- Sending topics to analyst verification: one lookup for the must-use keywords of up to 60 topics.
- More keywords / Suggest more secondary keywords: two lookups (Google top 10 + volumes for the new keywords).
- In-house keywords: one lookup per check (volumes and must-use keywords together).
- Keyword ideas: one lookup per search (ideas, page keywords or Google top 10).
- The API credits tab reads the lookups left with a free call.
- Calls are paced ~11 s apart (Mangools allows 3 per 30 s) and retried on rate limits. Mangools does not count the same request again within 24 hours.

## Notes

- Live date = sitemap `lastmod` when first detected; revamps go Live when lastmod is on or after the approval date.
- Snapshot/TOC: the tool tries the link on the page, then the preview URL, then the live URL.
- Each server call is limited to 60 s; long jobs are split into many calls by the browser.
- A Deep check done after a Publish or Live check has been saved updates the Fact Cache, but not the row already written to the Publish Check or Live Check sheet.
- The "Issue Count" saved to the RD sheet counts every issue found, including ones marked "not an error"; the Issue Decisions tab shows which were dismissed and by whom.
- The report keyword check in Publish and Live finds the report in the Research List by its URL or its name (H1); pages that are not in the Research List are not keyword-checked. Its findings appear under "Meta, SEO & keywords".
