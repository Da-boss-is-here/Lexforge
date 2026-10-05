# LexForge v1.0

A vocabulary trainer that won't call a word known until you can use it. Recognizing a word is the easiest part of knowing it, and most vocabulary apps stop there. LexForge makes you produce it.

**Try it:** https://da-boss-is-here.github.io/Lexforge/ (no account, no install). On the first screen, click **Try with sample words** for a recognition → production round in one click. Or download `index.html` and the `lib/` folder and open it locally.

## What's in 1.0

- **Teach → retrieve → produce.** A guided eight-step teaching flow for each new word, then recognition, cued recall, cloze, and free-production questions in a Daily Session, a due-only Quick Review, or targeted drills.
- **Eleven skill dimensions per word**, with mastery stages New, Learning, Unstable, Stable, and Exam Ready. Exam Ready requires successful independent production and novel application, not recognition alone.
- **Seven-category mistake diagnosis** (Meaning, Form, Spelling, Grammar, Collocation, Register, Selection), tied to the skill each one affects.
- **FSRS-6 scheduling** for recognition, meaning recall, and production, with production cards unlocking once recognition is stable. The other dimensions use the original level-based ladder, and the two run side by side.
- **Writing Audit and Timed Exam.** Paste your own writing and tag errors against words in your bank; write to a prompt under a timer.
- **Analytics** for activity, streaks, mastery distribution, review load, and scheduler diagnostics.
- **Try with sample words.** Five synthetic demo words that skip Teaching, flagged as sample data and removable from the Dashboard.
- Single HTML file plus vendored libraries, all data in your browser's `localStorage`, JSON export and import. No server, no account, no network requests.

## Things to know

- **Free production is self-checked.** The app shows your sentence next to the word's notes and you mark it right or wrong. There is no AI grading.
- **Data lives in one browser.** Clearing site data erases it; use Settings → Export to keep a backup. There is no sync.
- Open bugs found in code review are listed in [KNOWN_ISSUES.md](https://github.com/Da-boss-is-here/Lexforge/blob/main/KNOWN_ISSUES.md).
- Run the tests with `node --test tests/*.test.js` (Node.js, no install step).

## License

MIT. The vendored ts-fsrs and Chart.js builds in `lib/` keep their own licenses; see `THIRD_PARTY_NOTICES.md`.
