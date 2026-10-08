# sportmapz weekend map (Premier League template)

## Set up (about 15 minutes)
1. Base map: Stamen Toner Lite served by Stadia Maps. Create a free Stadia account and add your Netlify domain (and your WordPress domain if you embed tiles there) under Authentication, or paste an API key in `CFG.stadiaKey` in `js/app.js`. Check Stadia's terms for commercial use.
2. The sportmapz logo is in `assets/sportmapz-logo.png`.
3. In `netlify.toml` replace `YOUR-WORDPRESS-DOMAIN` so only your site can embed the map.
4. Deploy to Netlify (drag the folder onto app.netlify.com/drop, or connect a Git repo).
5. The map is fully static: no live data or API keys are needed besides the base map.
6. WordPress: add a Custom HTML block on a new page:

```html
<iframe src="https://YOUR-SITE.netlify.app/" title="Premier League weekend map"
  style="width:100%;height:80vh;min-height:560px;border:0;border-radius:12px"
  allow="fullscreen" allowfullscreen loading="lazy"></iframe>
```

## Weekly update
Edit `data/premier-league.json` only: `matches` (home, away, kickoff with the UK offset) and the `table` snapshot (positions are static: they are the table before this round and never change).
Kick-off times use ISO format with offset: +01:00 until 25 Oct 2026, +00:00 after the clocks go back.
Always compare the times with premierleague.com before publishing; times change for TV.

## Other leagues
Copy `data/premier-league.json` to e.g. `data/serie-a.json`, set `league.code` (SA, PD, BL1, FL1), list the 20/18 clubs with stadiums, and point `dataUrl` at it
(or read it from a `?league=` URL parameter). The functions already accept those codes.

## Crests and photos
Team crests are off by default (monogram badges are used). If you obtain a licence, add `"crest": "https://..."` to a team and it is used automatically.
