# Disruption scraper

`node scripts/scrape.mjs` reads news RSS (Google News searches in English and Malay, plus paultan.org),
keeps articles about the MRT Putrajaya Line that mention a disruption, extracts cause, stations and a
one-line summary, and writes `data/incidents.json` and `data/active.json`. The Disruptions tab loads both.

- With `GROQ_API_KEY` set it uses Groq (`GROQ_MODEL`, default `llama-3.3-70b-versatile`); without it, a keyword extractor.
- Records start at `MIN_DATE` (default 2025-07-01). Hand-curated records in `disruptions.js` always win over auto ones within a day.
- `--dry` prints without writing; `--fixture file.xml` parses a saved feed.
- `.github/workflows/scrape.yml` runs every 30 minutes and commits changes. Add the `GROQ_API_KEY` repo secret; the workflow only runs from the default branch.
- Limits: news lags the operator, stations are only matched from the nine tracked names, and a "back to normal" story only closes an incident already on file.

## Open data and door sides

`node scripts/build-open-data.mjs` writes `data/stations.json`, `data/headways.json` and `data/ridership.json` from data.gov.my (Prasarana GTFS Static and the `ridership_headline` catalogue).

Door side (which side the doors open) has no open dataset for KL rail. `data/doors.json` holds only verified entries:
`entries["LINE|STATION NAME|DIR"] = {"side": "L"|"R"|"B", "note": "source"}`, where DIR `A` is toward the last station of the line in `stations.json` and `B` toward the first; the side is as you face the front of the train.
Riders can save their own confirmations in the app (kept on the device); the Stations tab can copy them as JSON to be reviewed and added here.
