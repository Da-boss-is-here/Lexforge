# Launch hand-off

Steps that need your GitHub login. Nothing here has been run. Delete this file, `docs/issue-drafts/`, and `docs/release-v1.0.md` after launch if you don't want them in the repo.

## 1. About description (160 chars max)

```
A vocabulary trainer that won't mark a word known until you can write it. Free, offline, single HTML file.
```

```bash
gh repo edit Da-boss-is-here/Lexforge --description "A vocabulary trainer that won't mark a word known until you can write it. Free, offline, single HTML file."
```

## 2. Topics

Current topics (read from the GitHub API on 2026-10-05): active-recall, english-language, english-learning, fsrs-6, javascript, learning-science, learning-sciences, machine-learning, offline-first, offline-first-app, open-source, open-source-project, sat, toefl, toefl-ibt, toefl-prep, toefl-words, vocabulary, vocabulary-learning, vocabulary-trainer.

Target set (14, under GitHub's limit of 20): active-recall, english-learning, learning-science, offline-first, open-source, spaced-repetition, fsrs, vocabulary, vocabulary-learning, vocabulary-trainer, productive-vocabulary, writing, exam-prep, javascript.

- `machine-learning`: the app has no ML (FSRS is a fixed scheduling model), so it's removed as you asked.
- `sat`, `toefl`, `toefl-ibt`, `toefl-prep`, `toefl-words`: the app has no exam-specific content, so they aren't defensible in one sentence. Remove them, or keep them if you'd rather target that search traffic.
- `english-language`, `fsrs-6`, `learning-sciences`, `offline-first-app`, `open-source-project`: near-duplicates of topics in the target set.
- `javascript` is kept: the app is written in it.

```bash
gh repo edit Da-boss-is-here/Lexforge \
  --add-topic spaced-repetition,fsrs,productive-vocabulary,writing,exam-prep \
  --remove-topic machine-learning,sat,toefl,toefl-ibt,toefl-prep,toefl-words,english-language,fsrs-6,learning-sciences,offline-first-app,open-source-project
```

## 3. Social preview image

No CLI for this. Repo → Settings → General → Social preview → Edit → Upload `assets/social-preview.png` (1280×640, 61 KB).

The page's `og:image` tags point at `https://da-boss-is-here.github.io/Lexforge/assets/social-preview.png`, which only resolves after this branch is merged and Pages rebuilds. After merging, check the link preview with a fresh share of the URL (platforms cache previews).

## 4. File the issue drafts

```bash
for f in docs/issue-drafts/0*.md; do
  title=$(sed -n 's/^Title: //p' "$f"); body=$(sed '1,2d' "$f")
  gh issue create --title "$title" --body "$body" --label "good first issue"
done
```

Create the `good first issue` label first if it doesn't exist (`gh label create "good first issue"`; GitHub usually provides it by default).

## 5. Merge, then release

```bash
gh pr merge --squash   # after you've reviewed the PR; or merge it in the web UI
gh release create v1.0 --title "LexForge v1.0" --notes-file docs/release-v1.0.md
```

`CHANGELOG.md` calls the first release `1.0.0`. If you want the tag to match, use `v1.0.0` in the command above.
