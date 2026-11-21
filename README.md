# Kings Research SEO Workbench

One tool for the whole report pipeline: **Keywords → RD → Content → DM → Publish Check → Live Tracker**, with every step logged to the Google Sheet **KR-Process**. Nothing runs on a schedule: every action starts when someone pastes something or clicks a button.

## What each tab does

| Tab | What it does | Sheet tab |
|---|---|---|
| **Keywords** | 1) Research: Mangools KWFinder (related keywords), SERPChecker (who ranks, KD), keywords that competitor pages rank for (MarketsandMarkets, MRFR, FMI, Precedence, Persistence), then AI picks one primary and 8-15 secondary keywords with a reason why each helps our page. 2) Analyst marks each Good / Not good with a reason. 3) Manager (habi@kingsresearch.com + PIN) approves; approved keywords go to the Research List with the approval date. | Keywords, Research List |
| **RD** | Paste the written RD: secondary-keyword coverage, data consistency (CAGR maths, repeated figures, "majority" < 50%), grammar and house style, structure, web fact-check of dated claims, external link suggestions with anchor texts (from the sources found), status of existing links. | RD |
| **Content** | Empty, reserved for the Content team. | Content |
| **DM** | Enter the keyword, paste the content, add the infographic URL, click **Optimize**: H2/H3 tags in the house format, segmentation table, lists, internal links from the live sitemaps (KR-Interlinker logic), infographic with alt text (drag it in Preview), standard methodology images, then copy the source code, meta title and meta description. | DM |
| **Publish Check** | Paste a `/preview/report/...` URL: checks data consistency, facts, FAQs (incl. key players vs key companies), infographic (reads the text in the image), spelling and grammar, meta and headings, links, Report Snapshot and Table of Contents. | Publish Check |
| **Live Tracker** | **Sync reports sitemap** records every report URL and lastmod, detects new reports and marks Research List reports as live (with live date). **Run live check** runs the same checks on the live page; issues are written one column per category. | Sitemap, Live Check, Research List |

All sheet tabs are created automatically the first time the tool writes (or via **Setup → Create / repair sheet tabs**).

## Deploy (download → GitHub → Vercel)

1. **Download** this `kr-seo-workbench` folder from Google Drive (right-click → Download) and unzip it. Keep the structure:
   ```
   kr-seo-workbench/
   ├── api/            serverless functions (setup, keywords, rd, dm, sitemap, pagecheck)
   ├── lib/            shared server code
   ├── public/         the web app (index.html, styles.css, js/)
   ├── package.json
   ├── vercel.json
   ├── .env.example
   └── .gitignore
   ```
   If your unzip tool hides dot-files, check that `.gitignore` and `.env.example` are there.
2. **GitHub**: create a new private repository and upload the folder contents (or `git init && git add . && git commit -m "KR SEO Workbench" && git push`). Never commit a real `.env`.
3. **Vercel**: Add New Project → import the repository → Framework preset **Other** → leave build settings empty → add the environment variables below → **Deploy**.

## Environment variables (Vercel → Settings → Environment Variables)

Required:

| Name | Where to get it |
|---|---|
| `OPENAI_API_KEY` | platform.openai.com → API keys |
| `MANGOOLS_API_KEY` | mangools.com/api-token (free account works; paid plans give more lookups) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` from the service-account JSON (see below) |
| `GOOGLE_PRIVATE_KEY` | the `private_key` from the same JSON, pasted as-is including `-----BEGIN PRIVATE KEY-----` |
| `MANAGER_PIN` | any PIN you give to habi@kingsresearch.com for approvals |

Optional: `GOOGLE_SHEET_ID` (defaults to KR-Process), `MANAGER_EMAIL` (default habi@kingsresearch.com), `TEAM_ACCESS_KEY` (locks the tool behind a shared key), `OPENAI_MODEL` / `OPENAI_VISION_MODEL` / `OPENAI_SEARCH_MODEL` (default `gpt-4.1-mini`), `OPENAI_WEB_SEARCH` (`false` to skip web fact-checks), `COMPETITORS`, `MANGOOLS_LANGUAGE_ID`, `SITE_BASE`, `APP_TIMEZONE`, `KR_COOKIE` (only if preview pages need a login). See `.env.example`.

After changing variables, redeploy.

## Google Sheet access (one time)

1. Google Cloud Console → create (or pick) a project → **APIs & Services → Enable APIs** → enable **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account** → open it → **Keys → Add key → JSON**. Copy `client_email` and `private_key` into Vercel.
3. Open the **KR-Process** sheet → **Share** → add the service-account email as **Editor**.
4. Open the tool → **Setup** → **Create / repair sheet tabs**. Setup also shows which variables are missing.

## Daily workflow

1. **Researcher**: Keywords → Research → enter report name → Run → adjust → Save for analyst verification.
2. **Research analyst**: Keywords → Analyst verification → Good / Not good + reason → Submit.
3. **Manager (habi@kingsresearch.com)**: Keywords → Manager approval → enter email + PIN → Approve. The report lands in the Research List with the date.
4. **RD writer**: RD → pick the report (keywords fill in) → paste the RD → Verify content → fix → Save to RD sheet.
5. **DM**: DM → keyword, content, image URL → Optimize → Preview (move image) → Source code & meta → copy into the CMS → Save to DM sheet.
6. **Before publishing**: Publish Check → paste the preview URL → fix what it reports.
7. **After publishing**: Live Tracker → Sync reports sitemap → Run live check (or "Check all live reports not yet checked").

## Notes and limits

- **Mangools pacing**: the API allows about 3 calls per 30 seconds, so the browser waits ~11 s between calls and retries automatically on rate limits. Each lookup uses your Mangools quota (identical lookups within 24 h are free).
- **Live date**: the sitemap has no publish date, so "Live Date" is the sitemap `lastmod` at the moment the report was first detected, and "Detected On" is the sync time. The first sync is a baseline; reports that appear in later syncs are flagged as new.
- **Fact-checking** uses OpenAI web search. If web search is unavailable on your OpenAI account the tool falls back to model knowledge and says so on screen. Kings Research's own estimates (market size, CAGR, shares) are never "fact-checked" against the web; they are checked for internal consistency.
- **Preview pages** must be reachable by the server. If they require a login, set `KR_COOKIE`.
- **Timeouts**: each server call is limited to 60 s (works on the Vercel Hobby plan). Long checks are split into many small calls by the browser.
- The infographic check sends the image URL to OpenAI vision; the image must be publicly reachable (app.kingsresearch.com uploads are).
- Internal links come from `sitemap-reports.xml`, `sitemap-blogs.xml` and `sitemap-pr.xml`; the page never links to itself or to competitor domains.

## Local development

```
npm i -g vercel
cp .env.example .env.local   # fill in the values
npm install
vercel dev                   # http://localhost:3000
```
