# Chillin' with Pras — Redesign Audit (PHASE 0)

Date: 2026-09-18
Source: https://www.chillinwithpras.com/

## 1. Platform observations

- Built with **Sandvox 2.10.8** (macOS static-site generator), theme *"Gnarled"*.
- Fixed-width legacy layout (`meta viewport width=765`), tables-era-ish floats, inline-styled Chalkduster font everywhere.
- Navigation rendered as a DD smooth drop-down menu with full submenu of every page.

## 2. Navigation map

| Label | Path (original) | Type |
|---|---|---|
| Home ("Observations of a Slacker") | `/` | cover |
| To Observe and Report (30 entries) | `/to-observe-and-report/` | section index |
| To Show and Tell (5 entries) | `/to-show-and-tell/` | section index |
| Footer | `© Prakoso Sastrowardoyo 2012` | credit |

No About page exists in source navigation. Do not invent one.

The original site also published an RSS feed (`/index.xml`). It is intentionally **not** carried over: the redesign has no feed, and `/index.xml` and `/rss.xml` are plain 404s.

### To Observe and Report (menu order = publication order)
1. The Wall — Apr 2012
2. Small Town Hospitality — May 2012
3. Fox on the Beach — Aug 2012
4. Detox Diet — An Exercise in Restraint — Sep 2012
5. My Guitar Gently Weeps — Sep 2012
6. The Long Goodbye — Dec 2012
7. Great White — Dec 2012
8. The Forbidden Fruit — Mar 2013
9. Life Cycle — Spring 2013
10. Game is No Walk in the Park — Jun 2013
11. Sat'day Nite Lites — Jun 2013
12. Fun Dining in The Big Apple — Jul 2013
13. Street Music — Jul 2013
14. An Introspection on Introversion — Sep 2013
15. Exhibit: Starman — Nov 2013
16. Mend My Broken Heart — Dec 2013
17. Comic-Conned — Jan 2014
18. Cross-Country Chillin' — Feb 2014
19. Creatures of Habit — Feb 2014
20. Bamboo Music — Jun 2014
21. Gone Fishing — Sep 2014
22. Of Golden Bridges, Longing Hearts, and Flowers in Thy Hair — Oct 2014
23. Frozen in Time — Dec 2014
24. South of South of the Border — Apr 2015
25. Artificial Worlds and Natural Wonders — Nov 2015
26. Morocco. Moments. — Mar 2016
27. Unfinished Business — Jun 2016
28. Finding Fado — Sep 2016
29. Focus on Havana — Dec 2016
30. Desert Life — Aug 2017

### To Show and Tell (menu order)
1. Carvin' Pumpkin
2. Windows to the World (nested folder on source)
3. Bringing Bagong Back
4. The Artist's Den
5. Food for Thought

Datelines above are taken *verbatim from article bodies* (final line), never invented.

## 3. Route inventory (source)

- `/` (home)
- `/to-observe-and-report/`
- `/to-observe-and-report/{slug}.html` (×30)
- `/to-show-and-tell/`
- `/to-show-and-tell/{slug}.html` (×4) + `/to-show-and-tell/windows-to-the-world/` (×1)
- `/favicon.ico`

Destination mapping (clean URLs):

- `/` → `/`
- `/to-observe-and-report/` → `/to-observe-and-report/`
- `/to-observe-and-report/{slug}.html` → `/to-observe-and-report/{slug}/`
- `/to-show-and-tell/` → `/to-show-and-tell/`
- `/to-show-and-tell/{slug}.html` → `/to-show-and-tell/{slug}/`

## 4. Content inventory

- 1 cover/home (Observations of a Slacker + Merriam-Webster "slacker" entry, exact text preserved)
- 2 section intros (Observe + Show) — exact copy preserved
- 30 observed stories (full body text preserved)
- 5 show-and-tell projects (full body text preserved)
- 215 unique photographs referenced in article bodies (all `_Media/*_med.*`; ~430px wide JPEG/PNG — these are the site's maximum published resolution; include one 706px class used for wide items)

## 5. Image inventory notes

- Source images are only published at `_med` size (~430-440px wide, 29 at 706px). No higher-resolution originals are publicly available; tried naming probes for originals/large variants → 404.
- Designs must therefore contain images at controlled editorial sizes — large enough to feel photographic, not so large they downscale and soften. Do not distort aspect ratios.
- Alt texts are generic Sandvox output ("image-1 copy"); not treated as captions. No invented captions.

## 6. Page-type map

| Original page | New page type |
|---|---|
| `/` | A — Home/Cover |
| Section indices | B — Section/Archive |
| 30 observe stories | C — Article/Story |
| 5 show projects | D — Show & Tell |

## 7. Typography / color observations (original)

- All display + body text used the macOS **Chalkduster** (a decorative chalk typeface) — charming, but the source of most of the "old software template" feeling.
- Colours: off-white paper body, dark charcoal links, blue-ish links on the "Gnarled" theme; category colour chips absent.
- The author's voice: casual, wry, self-deprecating, bilingual (Indonesian-English), loves puns. Preserve verbatim.

## 8. Build decision

- **Astro** static site (content-driven, zero-JS by default, built-in asset optimization).
- Content as structured JSON (this audit), rendered via reusable components.
- Fonts: Cormorant Garamond (editorial), Caveat (handwriting accent), Inter (utility/nav).
- Palette: warm paper `#F7F4ED`, ink `#26231F`, muted text `#716B63`, border `#D8D1C6`, accent `#6B6258`, restrained `#7A6655`.