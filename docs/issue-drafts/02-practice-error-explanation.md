Title: Show the error-category explanation in Practice after picking a category
Labels: good first issue, UX

## Context

After a wrong answer in Practice, the app asks "What kind of error was this?" and the learner picks one of seven categories. In the Teaching flow, picking a category shows a short explanation (a `diag-box` using the `ERROR_EXPLANATIONS` text, e.g. "Collocation error. The word itself was right, but the natural word-partners around it were off."). Practice never shows it: the picked button just highlights and Continue enables.

The diagnosis is one of LexForge's main ideas, so the explanation should appear wherever the category is chosen.

## What to do

In `Views.handleGraded` (the `if(!correct){ ... }` branch that wires `.error-cats button`), show the `ERROR_EXPLANATIONS[category]` text under the picker when a category is picked, and update it if the learner changes their pick. Reuse the existing `.diag-box` / `.expl` styles from the Teaching flow so no new CSS is needed.

## Notes

- UI only. Don't change what gets logged (`WordModel.logAttempt` / `logError`), scheduling, or the save format.
- Check by hand: open `index.html`, click "Try with sample words", answer the production card, click "Reveal Self-Check" then "No, needs work", pick a category.
- Include a before/after screenshot in the PR.
- See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Done when

Picking each of the seven categories in Practice shows its explanation, and the existing tests still pass.
