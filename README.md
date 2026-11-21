# Kings Research SEO Workbench

One tool for the whole report pipeline: **Keywords → RD → Content → DM → Publish Check → Live Tracker**, with every step logged to the Google Sheet **KR-Process**. Nothing runs on a schedule: every action starts when someone clicks a button.

## What each tab does

| Tab | What it does | Sheet tab |
|---|---|---|
| **Keywords → 1 · Find opportunities** | Mangools keyword-gap analysis of kingsresearch.com against the 5 competitors, grouped into report topics and checked against our reports sitemap: not published → **New report**, published but not ranking → **Revamp**. AI prioritises topics; the top High-priority ones go to analyst verification automatically. Sort by priority, volume, all-variants volume, KD or competitors. **More keywords** reads the pages ranking in Google's top 10 for the topic and adds secondary keywords from them (with Mangools volumes). The last scan reloads from the sheet. | Opportunities, Keywords |
| **Keywords → 2 · Analyst verification** | Good / Not good + reason per keyword (secondaries sorted by volume, SEO warnings shown). **Suggest more secondary keywords** reads the top-10 pages and adds the ticked ones to the group. | Keywords |
| **Keywords → 3 · Manager approval** | habi@kingsresearch.com + PIN approves → Research List with the approval date. | Research List |
| **RD** | Paste the RD: every use of the primary and secondary keywords **highlighted in colour with a count**; plus data consistency, grammar, structure, fact-check, external link suggestions, link status. | RD, Fact Cache |
| **Content** | Reserved for the Content team. | Content |
| **DM** | H2/H3, segmentation table, internal links, **one or more images** (first = infographic; each draggable in Preview; alt text only inside each image's HTML `alt` attribute), CMS boxes for Meta Title, Meta Description and HTML. | DM |
| **Publish Check** | Preview URL → data consistency, facts, FAQs, infographic numbers vs content, spelling, meta, links. | Publish Check, Fact Cache |
| **Live Tracker** | Sync the reports sitemap → reports and revamps marked Live with their date → live checks (everything above **plus Report Snapshot and Table of Contents**). | Sitemap, Live Check, Research List, Fact Cache |

## Keeping the AI cost down

The fact-check used to be about 90% of the AI bill, because every run searched the web again for every claim. It now works like this:

1. **Each fact is checked once.** Every checked sentence is stored in the **Fact Cache** sheet tab with its verdict and source. When the same sentence appears again (second RD run, Publish Check, Live Check), the saved verdict is shown at no cost. A sentence that has been edited counts as new and is checked again. Verdicts are reused for 180 days (`FACT_CACHE_DAYS`).
2. **Only public facts are checked.** Plain rules pick the sentences that could hold an outside fact (a month-and-year date, or words such as announced, acquired, approved), and **Jev** labels each one: public fact, our own estimate, or general statement. Kings Research's own market numbers are not sent to the web; the data-consistency check covers them.
3. **Lite engine, free search.** A new fact gets one web search through **Tavily** (1,000 free searches every month), and Jev judges whether each result confirms it, conflicts with it, or is unrelated. Below the confidence threshold (`FACT_MIN_CONFIDENCE`, default 0.8) the claim is marked **Check manually**, with the best source found.
4. **If the search is not available** (no key, the month's free searches are used up, or the service is down), the tool does not switch to anything paid. It opens the page the sentence **already links to** and asks Jev whether that page backs the claim. A sentence with no source link is marked **Check manually** with "add a source link". This needs no search service, so it always works.
5. **Deep check button.** Every claim in the results table has a **Deep check** button that re-checks that one claim with OpenAI web search (about 1 to 3 cents). Nothing else in the lite engine spends money on search. Use it when the lite engine is unsure, or when you want a suggested correction.
6. **Unchanged RD.** If nothing has changed since the last "Verify content" (same content, keywords and links, within 24 hours, same browser), the saved results are shown. Hold **Shift** and click to force a full re-run.
7. **Topic priority.** With a Jev key, keyword topics are prioritised by search volume and competitor counts (plain maths) plus Jev's judgment of whether the topic is a sellable report and how strong the commercial demand is. Set `DECISION_ENGINE=openai` to go back to the chat model.

**What the lite engine cannot do:** it reads the title and summary of each search result (or extracts of the linked page), not everything, and it cannot write a correction. A "Contradicted" from it is therefore shown as a warning, not an error, until a Deep check confirms it.

**Comparing the two engines before trusting lite:** set `FACT_ENGINE=both`. Each new claim is then checked by the deep engine (at the old cost), and the lite verdict is shown beside it in the claims table. Run it on a few RDs you have already checked by hand, then remove the variable.

Still done by gpt-4.1-mini, because they need written fixes or image reading: RD review, language checks, data consistency, FAQ check, infographic check, Report Snapshot and Table of Contents checks, meta suggestions, internal links and "More keywords".

## Check rules (to keep false alarms out)

- Only real problems are reported; "consistent / no conflict" notes and vague "please confirm" items are dropped.
- North America is always "U.S., Canada, and Mexico" (no "Rest of North America").
- Superlatives are judged per segmentation category (the fastest deployment mode and the fastest technology can both be "fastest").
- FAQ answers that repeat the description word for word are never flagged; extra explanation in an FAQ is fine.
- Infographic: only numbers or statements that **contradict** the content are flagged. Masked values (XX.X%, X.XX%) and numbers the content doesn't mention are fine; styling is never flagged.
- Table of Contents: company names are not expected there; website labels such as "Table Of Content" are ignored.
- Fact-check: each claim is searched separately; competitor and other report-seller sites are never used as sources; a source must mention the organization (or a key term) of the claim, otherwise it is not used or suggested; in the deep engine a "correction" that repeats the claim counts as Supported; links on sites that block automated checks are not called broken.

## SEO Check in the Keywords sheet

Every saved secondary keyword gets an **SEO Check**: **Link instead** (main topic of another Kings Research report), **Duplicate** (same words in another order), **Low value** (country variant or "market research" phrasing) or **OK**.

## Deploy and environment

1. Copy the updated files into your local folder, then `git add .`, `git commit -m "..."`, `git push`. Vercel redeploys automatically.
2. Required Vercel variables: `OPENAI_API_KEY`, `MANGOOLS_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `MANAGER_PIN`.
3. Cost savers (recommended): ONE Jev key, either `TYPESAFE_API_KEY` (console.typesafe.ai) or `AI_GATEWAY_API_KEY` (Vercel AI Gateway), and `TAVILY_API_KEY` (tavily.com). `SERPER_API_KEY` is an optional backup search. Without a Jev key the tool uses OpenAI web search as before; the Fact Cache and the unchanged-RD saving still apply.
4. Optional: `FACT_ENGINE`, `FACT_MIN_CONFIDENCE`, `FACT_CACHE_DAYS`, `FACT_TRIAGE`, `DECISION_ENGINE`, `JEV_MODEL`, `TEAM_ACCESS_KEY`, `GOOGLE_SHEET_ID`, `MANAGER_EMAIL`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL`, `OPENAI_SEARCH_MODEL`, `OPENAI_WEB_SEARCH`, `COMPETITORS`, `MANGOOLS_LANGUAGE_ID`, `SITE_BASE`, `APP_TIMEZONE`, `KR_COOKIE`. See `.env.example`.
5. Share KR-Process with the service-account email as Editor; enable the Google Sheets API.
6. In the tool: **Setup → Create / repair sheet tabs** (this adds the **Fact Cache** tab), then **Fix existing keyword rows**. The Setup dialog shows which fact-check engine is active and whether the Jev and web search keys are set.

## Mangools lookups

- Find opportunities: one lookup per competitor per page.
- More keywords / Suggest more secondary keywords: two lookups (Google top 10 + volumes for the new keywords).
- Calls are paced ~11 s apart (Mangools allows 3 per 30 s) and retried on rate limits.

## Notes

- Live date = sitemap `lastmod` when first detected; revamps go Live when lastmod is on or after the approval date.
- Snapshot/TOC: the tool tries the link on the page, then the preview URL, then the live URL.
- Each server call is limited to 60 s; long jobs are split into many calls by the browser.
- A Deep check done after a Publish or Live check has been saved updates the Fact Cache, but not the row already written to the Publish Check or Live Check sheet.
