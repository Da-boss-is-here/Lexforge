# LexForge

Knowing a word isn't the same as recognizing it.

Most vocabulary apps ask: **"Do you remember this word?"**  
LexForge asks: **"Can you actually use it?"**

[🚀 Try LexForge](https://da-boss-is-here.github.io/Lexforge/) · [View on GitHub](https://github.com/Da-boss-is-here/Lexforge)

<!-- TODO: docs/demo.gif — 10-15s loop:
     Dashboard → Add word → Teaching step →
     Recognition question → Cloze → Free production →
     Error diagnosis → Analytics → "Exam Ready"
     Capture from the live app at 1200px width,
     loop-friendly, under 3MB. -->
![LexForge demo](docs/demo.gif)

LexForge is a vocabulary trainer built around productive knowledge — 11 skill dimensions, diagnosed mistakes, adaptive spaced repetition, and writing-based mastery.

- ✍️ Mastery requires real production
- 🧠 11 dimensions of vocabulary knowledge
- 🔎 7 categories of mistake diagnosis
- 📈 FSRS-6 scheduling per skill
- 🔒 Fully local — no account, no server, no network

![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![offline-first](https://img.shields.io/badge/offline--first-yes-brightgreen) ![no build required](https://img.shields.io/badge/no%20build-required-brightgreen) ![tests: 163 passing](https://img.shields.io/badge/tests-163%20passing-brightgreen)

<!-- TODO: Upload a custom repository Social Preview in
     Settings → Social preview.

     Size: 1280×640
     Text:
       LEXFORGE
       Knowing a word
       ≠
       being able to use it.

     Subtext: "A vocabulary trainer built around productive
     recall."
     Visual: cropped practice screen on the right side. -->

## Why LexForge?

| Traditional flashcards | LexForge |
|---|---|
| "I recognized it" | "I produced it" |
| One card = one score | 11 skill dimensions |
| Correct / incorrect | Diagnosed error type |
| Review whenever | Adaptive scheduling per skill |
| Learn by seeing | Teach → retrieve → produce |
| Vocabulary stays in the app | Writing Audit tests real usage |

## Why I built this

I kept noticing a problem with vocabulary apps: recognizing a word feels like knowing it, but recognition and actual use are very different skills.

A student can recognize *substantiate* in a multiple-choice question and still fail to retrieve it, distinguish it from *prove*, use the wrong preposition, or avoid using it in writing entirely.

So I built LexForge around the idea that vocabulary mastery should end in production, not recognition.

The whole app is one HTML file, plus the libraries vendored alongside it. Open `index.html` and start.

## Highlights

A single-file vocabulary trainer that refuses to call a word mastered until you can write with it.

- Eleven skill dimensions per word, not one.
- Production is required for mastery, not optional.
- Every mistake is diagnosed into one of seven categories.
- FSRS-6 spaced repetition, scheduled per-skill.
- Teaching before retrieval — no word enters practice until it's been taught.

## Screenshots

![Dashboard](docs/screenshots/dashboard.png)
![Practice](docs/screenshots/practice.png)
![Analytics](docs/screenshots/analytics.png)

The screenshots use a synthetic data set generated for this README, not real study data.

For a full walkthrough with screenshots of every screen, see [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).

## Features

**Teaching phase**
- Guided eight-step flow for each new word: introduction, core meaning, contextual examples, guided processing, supported retrieval, constrained production, independent production, entering retrieval.
- Add words one at a time, or paste many at once in a pipe-delimited format. The app includes a prompt you can give an AI assistant to generate that format.

**Practice engine**
- Daily Session, Quick Review (due items only), and context/production drills.
- Question types cover recognition, cued recall, cloze, and free production.
- Each word is tracked across eleven dimensions: form recognition, form recall, meaning recognition, meaning recall, semantic discrimination, grammar, collocation, contextual comprehension, guided production, independent production, and novel application.
- Mastery stages are New, Learning, Unstable, Stable, and Exam Ready. Exam Ready requires successful independent production and novel application, not recognition alone.

**Scheduling (FSRS-6 + legacy ladder)**
- Recognition, meaning recall, and production are scheduled by FSRS-6 (via the vendored `ts-fsrs`), one card per word and skill.
- Production cards unlock once recognition stability passes a threshold.
- The other dimensions still use the original level-based ladder with fixed intervals. The two systems run side by side.
- An optional exam date compresses review intervals for words that are not yet Exam Ready.

**Writing Audit + Timed Exam**
- Weekly Writing Audit: paste your own writing and tag errors against words in your bank. Matched errors feed back into scheduling.
- Timed Exam: write to a prompt under a timer with target words, then mark which ones you used correctly.

**Analytics**
- Weekly activity versus the prior week, streaks, achievements, and a milestone list.
- Words added versus words reaching Stable, mastery distribution, upcoming review load, and a per-dimension coverage table.
- Scheduler diagnostics: prediction calibration, stability growth, retention by interval, and an activity heatmap.

**Privacy**
- All data lives in your browser's `localStorage`. There is no server and no account.
- Export and import (merge or replace) as a JSON file from Settings.
- Everything the app needs, including Chart.js and the FSRS library, is vendored in `lib/`. The app makes no network requests.

## Try it

- Live demo: https://da-boss-is-here.github.io/Lexforge/
- Run locally: open `index.html` in a browser. No server, no build, no install.

## Tests

```
node --test tests/*.test.js
```

Requires Node.js. The glob is needed; `node --test tests/` alone finds nothing.

## Project layout

- `index.html` — the whole app: markup, styles, and one inline script.
- `lib/` — FSRS scheduling and due-queue modules, shared by the app and the tests, plus the vendored `ts-fsrs` and Chart.js builds.
- `tests/` — unit and smoke tests. The persistence smoke test loads the real script out of `index.html`.
- `docs/` — the [walkthrough](docs/WALKTHROUGH.md) and the screenshots used by it and the README.

See [CONTRIBUTING.md](CONTRIBUTING.md) to work on it, and [CONTEXT.md](CONTEXT.md) for a file and function map.

## License

MIT. See [LICENSE](LICENSE).

The root MIT license covers the original code in this repository. The vendored ts-fsrs and Chart.js builds in `lib/` carry their own licenses — see `lib/fsrs.LICENSE`, `lib/chart.LICENSE`, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

## Acknowledgments

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) — the FSRS implementation behind the scheduler.
- [Chart.js](https://www.chartjs.org/) — analytics charts.

## Known issues

Open bugs found during code review are tracked in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
