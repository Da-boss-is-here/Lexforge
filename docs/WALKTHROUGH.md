# LexForge — Walkthrough

A tour of every screen and every interaction, from adding a word through teaching, practice, and exam mode.

All screenshots were taken from a synthetic data set (43 words, about four weeks of study history), not from real study data. Dates and counts in the images reflect that data.

## Contents

- [The core idea](#the-core-idea)
- [1. Adding a word](#1-adding-a-word)
- [2. The Teaching Phase](#2-the-teaching-phase)
- [3. Practice](#3-practice)
- [4. Context / Production Drills](#4-context--production-drills)
- [5. Writing Audit](#5-writing-audit)
- [6. Timed Exam Deployment](#6-timed-exam-deployment)
- [7. Analytics](#7-analytics)
- [8. Settings & Data](#8-settings--data)
- [What's tracked](#whats-tracked)
- [What the app doesn't do](#what-the-app-doesnt-do)

## The core idea

Most vocabulary tools record one thing about a word: whether you recognised it. LexForge records eleven separate skills per word, from recognising its meaning to using it in a sentence you wrote yourself, and keeps a status for each.

Production is required. A word can reach Stable on retrieval alone, but it only counts as Exam Ready after you have successfully used it in your own independent sentences and in a novel application, with no recent errors. Recognition (picking a meaning from a list) is treated as a warm-up and is never counted as mastery on its own.

When you get something wrong, the app asks what kind of error it was, from seven categories: Meaning, Form, Spelling, Grammar, Collocation, Register, and Selection. That answer is linked to the matching skill, so the Errors tab and the analytics show which skills are weak instead of just a failure count.

Everything is stored in your browser's `localStorage`. There is no server and no account.

![Dashboard with 39 reviews ready, today's counts, and the mastery stage breakdown](screenshots/views/dashboard-populated.png)

The Dashboard is the home screen. The top card offers a Daily Session or a Quick Review of items that are due. Below it are today's counts (overdue, due today, awaiting teaching, recently failed), the mastery stages, and progress across the retrieval levels. A brand-new install starts empty:

![Empty Dashboard with an "Add a Word" button](screenshots/views/dashboard-empty.png)

## 1. Adding a word

Every word needs a full record, not just a definition: core meaning, form (part of speech and word family), grammar pattern, at least two collocations, a contrast with a confusable word, at least two typical contexts, and an example production sentence. A mnemonic, a pronunciation, a word type, and up to five cloze sentences are optional but used by teaching and practice.

**Manual entry.** The form validates the required fields before saving. The word type (general, concrete noun, abstract verb, polysemous, near-synonym, difficult spelling) changes how the word is taught; step 1 of teaching shows a type-specific note, and difficult-spelling words get an extra spelling check.

![Manual entry form, filled in with an example word](screenshots/views/add-word-manual.png)

![The lower half of the manual entry form: contexts, production sentence, mnemonic, cloze sentences, and the Save Word button](screenshots/views/add-word-manual-2.png)

**Paste import.** Paste one line per word in a pipe-delimited format. A single line is parsed and loaded into the manual form so you can check it before saving. Several lines are imported in one go: valid lines are added and any line that fails is reported with its line number and reason.

**AI generator prompt.** The Paste Import tab has a "Copy generator prompt for AI" button. It copies a prompt you can give to an AI assistant, which returns lines in the exact format the importer expects. The app itself makes no AI calls; you paste the result back in.

![Paste Import tab with one pasted line](screenshots/views/add-word-paste.png)

The Word Bank lists every word with its mastery stage, next review date, interval, and how many of the eleven dimensions have been achieved. Words can be edited, deleted, or expanded to show their example sentences.

![Word Bank listing words with mastery badges and review dates](screenshots/views/word-bank.png)

## 2. The Teaching Phase

A new word is not added to the review queue until it has been taught. Teaching is an eight-step flow, started from Practice → Teach New Words. The step you reach is saved, so you can leave and resume.

**Step 1 — Introduce the Word.** The word, its pronunciation, a speaker button for text-to-speech, and its part of speech and word family.

![Step 1: Introduce the Word](screenshots/teaching/01-introduce.png)

The word type adds a short note here. For a concrete noun, the app asks you to picture an example. For a polysemous word, it says the lesson covers one specific sense.

![Step 1 for a concrete noun, with the "picture an example" note](screenshots/teaching/01-note-concrete-noun.png)

![Step 1 for a polysemous word, with the "one specific sense" note](screenshots/teaching/01-note-polysemous.png)

**Step 2 — Core Meaning.** The meaning, and the contrast with a word it is often confused with.

![Step 2: Core Meaning with the contrast box](screenshots/teaching/02-core-meaning.png)

**Step 3 — Contextual Examples.** Typical contexts, the grammar pattern, collocations, and example sentences with the word in bold.

![Step 3: Contextual Examples](screenshots/teaching/03-context-examples.png)

**Step 4 — Guided Processing.** The first check. One of three tasks is chosen at random, so a word can be taught differently on a repeat visit.

Multiple choice: pick which of two sentences uses the word correctly.

![Step 4, multiple-choice variant](screenshots/teaching/04-guided-mcq.png)

A correct choice is confirmed and credits meaning recognition and contextual comprehension. A wrong choice shows the correct sentence and asks you to categorise the error.

![Step 4 MCQ, correct choice](screenshots/teaching/04-mcq-feedback-correct.png)

![Step 4 MCQ, wrong choice with the error-category picker](screenshots/teaching/04-mcq-feedback-wrong.png)

Explain: write the meaning in your own words, then compare it with the stored meaning and mark yourself right or not quite.

![Step 4, explain-in-your-own-words variant](screenshots/teaching/04-guided-explain.png)

Cloze: fill in the missing word in a sentence.

![Step 4, cloze variant](screenshots/teaching/04-guided-cloze.png)

If you answer wrong, you choose an error category and see its explanation. You can retry the step; after a second failure the app shows why the answer is correct and lets you continue.

**Step 5 — Supported Retrieval.** You are given the meaning or a context and must type the word from memory.

![Step 5: Supported Retrieval](screenshots/teaching/05-retrieval.png)

Each wrong attempt adds a hint, in order: a grammatical clue, a semantic clue, the first letter, a partial form, and finally the answer.

![Step 5 after one wrong attempt: the hint ladder](screenshots/teaching/05-hint-ladder.png)

If you get it right after needing hints, the app asks what kind of slip it was before it clicked. That is recorded as an error even though the step passed.

![Step 5, correct after a retry, asking for the type of slip](screenshots/teaching/05-feedback-correct.png)

For words marked "difficult spelling", step 5 starts with a spelling check: study the word, then type it from memory.

![Step 5 spelling check for a difficult-spelling word](screenshots/teaching/05-spelling-check.png)

**Step 6 — Constrained Production.** Write a sentence under a constraint, for example using the word together with one of its collocations. The app cannot grade a sentence, so it shows yours next to the grammar pattern and collocations and you mark whether it satisfied the constraint.

![Step 6: Constrained Production](screenshots/teaching/06-constrained.png)

**Step 7 — Independent Production.** Write an original sentence with no constraints, then self-check.

![Step 7: Independent Production](screenshots/teaching/07-independent.png)

**Step 8 — Entering Retrieval.** A summary of the eleven dimensions after teaching. Dimensions the teaching steps exercised typically show Developing; the others show Not assessed. The word is now due for retrieval practice.

![Step 8: Entering Retrieval, showing the dimension grid and Done button](screenshots/teaching/08-complete.png)

## 3. Practice

The Practice tab shows overdue and due counts for the older level-based schedule, the number of words awaiting teaching, and three buttons: Review Due/Overdue, Teach New Words, and Context / Production Drills.

![Practice home with no active session](screenshots/practice/practice-home.png)

Review Due/Overdue builds a queue of everything due, mixing the four question levels. Each card shows a badge for its level.

**Level 1 — Recognition.** Choose the meaning of a word from four options. This is a warm-up. It credits meaning recognition only.

![Level 1: Recognition](screenshots/practice/01-recognition.png)

Choosing wrongly marks your choice and the correct answer, then asks for an error category before you can continue.

![Recognition feedback after a wrong choice](screenshots/practice/recognition-feedback.png)

**Level 2 — Cued Recall.** Type the word, given a meaning, a context, or a collocation as the cue.

![Level 2: Cued Recall](screenshots/practice/02-cued-recall.png)

A wrong first answer offers one hint, the first letter with the rest masked, and one more try.

![Cued recall after one wrong attempt, with the first-letter hint](screenshots/practice/cued-recall-hint.png)

**Level 3 — Cloze.** Type the missing word in a sentence.

![Level 3: Cloze](screenshots/practice/03-cloze.png)

**Level 4 — Free Production.** You get a situation and a twist (a more formal register, a question, a collocation to include) and write a sentence. Then you reveal the self-check.

![Level 4: Free Production](screenshots/practice/04-production.png)

The reveal shows your sentence beside the word's meaning, collocations, grammar, and contrast, and asks whether you used it correctly and naturally.

![Self-check reveal after a production answer](screenshots/practice/self-check-reveal.png)

**Grading.** A correct answer asks how it felt: Hard (effortful) or Easy (fluent). A wrong answer asks for one of the seven error categories. For words scheduled by FSRS, those answers become the review grade. For words on the older ladder, a word moves up a level after two consecutive successes at its current level, and drops a level when recent accuracy falls below 50%.

![Error-category picker after a second wrong answer](screenshots/practice/error-category-picker.png)

**Going back.** The "← Back" button reopens the previous card read-only, showing your answer, the correct answer, the grade you gave, and the error category. It cannot change the grade.

![Review of the previous card](screenshots/practice/review-previous.png)

**Daily Session.** The Dashboard's "Start Daily Session" runs four phases in order: Retrieval Review, New Vocabulary, Context / Production, and Error Review. A row of four dots shows the current phase. When more than 25 reviews are due, phase 1 offers the 25 most urgent items or the full queue.

![Daily Session, phase 1 interstitial with the four-dot phase indicator](screenshots/practice/session-phase-nav.png)

## 4. Context / Production Drills

Practice → Context / Production Drills builds a short queue of production-level drills over words you have already practised. Each drill is self-graded and credits the novel application dimension. There are three kinds.

**Combine two words.** Write one natural sentence that uses the target word and a second word from your bank.

![Drill: combine two words](screenshots/practice/drill-combo.png)

**Distinguish confusables.** The contrast note is shown with the target word blanked out. Write one or two sentences that show the difference.

![Drill: distinguish confusables](screenshots/practice/drill-confusable.png)

**Rewrite in a new register.** Rewrite the word's example sentence for a different register or context.

![Drill: rewrite in a new register](screenshots/practice/drill-rewrite.png)

## 5. Writing Audit

The Writing tab has two sub-views. The Weekly Writing Audit starts from writing you did outside the app. Paste an essay or paragraph, select a weak or incorrect use of vocabulary, and tag it with an error category and a corrected version. "Create Review Items" then feeds each tag into the same error-diagnosis system and dimension tracking that Practice and Teaching use, so mistakes from real writing show up in the Errors tab and in scheduling.

![Weekly Writing Audit with one tagged error](screenshots/views/audit.png)

The Errors tab summarises all logged errors by category, lists recent ones, and has a Practice button per category that builds a session around that kind of mistake.

![Errors tab with categories and recent errors](screenshots/views/errors.png)

## 6. Timed Exam Deployment

The second Writing sub-view simulates exam conditions. You set a writing prompt (or draw a new one), a time limit of 15, 20, 30, or 45 minutes or a custom value, and the app picks target words from vocabulary that is Stable with no recent errors. You can reshuffle the words.

![Timed Exam configuration](screenshots/views/exam-config.png)

Once started, a countdown timer runs, the prompt and target words stay on screen, and the writing area is a plain text box. Target words are optional; the aim is to use them naturally. Your text is saved as you type, so a page refresh does not lose it. "Finish Now" ends the exam early after a confirmation.

![Timed Exam running with the timer and target words](screenshots/views/exam-running.png)

When time is up, the writing is locked and a review checklist appears. For each target word you mark Used correctly, Used incorrectly (with an error category), or Did not use. Not using a word is not counted as an error. Submitting records the results against each word's dimensions and the error log.

![Timed Exam review checklist](screenshots/views/exam-review.png)

## 7. Analytics

The Analytics tab reads from the review log, the daily activity record, and the words themselves. Every chart can be read against a sample of reviews, not a single result: the calibration and retention charts stay hidden until there are at least 20 usable reviews, and the stability chart needs 5 or more reviews in a dimension.

> The full Analytics page as a single image: [analytics.png](screenshots/analytics.png) (opens on GitHub; scroll to view the entire page).

The sections below are the same page in seven parts, from the top down.

![This Week: reviews, accuracy and new words against the previous week, with current and best streaks](screenshots/analytics/analytics-01-this-week.png)

**This Week** compares the last seven days with the seven before, and shows the current and best streaks.

![Study streak summary tiles and the Achievements row, with locked achievements showing progress bars](screenshots/analytics/analytics-02-achievements.png)

**Achievements** shows the streak, practice totals and retrieval accuracy, then each goal as unlocked or as a progress bar toward the target.

![Milestones list of words reaching Stable or Exam Ready, and the Personal Bests card](screenshots/analytics/analytics-03-milestones.png)

**Milestones** lists the first word and each word's first time reaching Stable or Exam Ready, followed by **Personal Bests** (longest streak, most reviews in a day, fastest word to mastery).

![Arm Comparison, FSRS-6 versus the legacy scheduler](screenshots/analytics/analytics-04-arm-comparison.png)

**Arm Comparison** puts the two scheduling methods side by side (mean attempts to first mastery, and mean interval at the last grade), with a note that the comparison is descriptive and not a causal result.

![Words Added vs. Learned, Current Mastery Distribution, Upcoming Review Load, and the Dimension Coverage table](screenshots/analytics/analytics-05-charts.png)

The main charts show **words added versus words learned** over time, the **current mastery distribution**, the **upcoming review load**, and the **Dimension Coverage** table with a Practice button per dimension.

![Learning Health: Prediction Calibration, Stability Growth by Dimension, and Retention by Interval, with the Consistency heatmap beside them](screenshots/analytics/analytics-06-learning-health.png)

**Learning Health** checks the scheduler against your own reviews: **Prediction Calibration** compares predicted and actual recall, **Stability Growth** shows how review spacing grows per dimension, and **Retention by Interval** shows success rate against days since the last review.

![Consistency heatmap, Retention Gaps, and First-Post-Teaching Retention](screenshots/analytics/analytics-07-consistency-retention.png)

The **Consistency** heatmap shows reviews per day over the last 84 days, **Retention Gaps** lists dimensions that were Achieved and later slipped back, and **First-Post-Teaching Retention** gives the share of taught words recalled on the first attempt.

In more detail, from the top:

- **This Week.** Reviews, accuracy, and new words for the last seven days, compared with the seven days before. The current streak and personal best streak are below.
- **Achievements.** Progress toward a small set of goals, such as teaching 10 words or getting one word to Exam Ready.
- **Milestones.** A log of the first word and each word's first time reaching Stable or Exam Ready.
- **Personal Bests.** Longest streak, most reviews in a day, and the fastest word to mastery.
- **Arm Comparison — FSRS-6 vs Legacy.** Descriptive comparison of the two scheduling methods that run side by side: mean interval at the last grade, and mean number of attempts before first mastery. The page itself says it is descriptive and cannot attribute progress to one method.
- **Words Added vs. Learned Over Time.** Cumulative words added compared with cumulative words that reached Stable or better. A widening gap means words are being added faster than they are being learned.
- **Current Mastery Distribution.** How many words are in each stage right now.
- **Upcoming Review Load.** Taught words due within the next 1, 3, 7, 14, and 30 days.
- **Dimension Coverage.** For each of the eleven dimensions: words assessed, percent achieved, percent developing, and total fails. A Practice button on each row starts a session on words that have failed that dimension.
- **Prediction Calibration.** FSRS predicts the chance you will recall each item; this compares predicted recall with what actually happened, and reports a Brier score (lower is better).
- **Stability Growth by Dimension.** Median memory stability, in days, at each successive review. A rising line means reviews are spacing out.
- **Retention by Interval.** Success rate against the number of days since the previous review.
- **Consistency.** A heatmap of reviews per day over the last 84 days.
- **Retention Gaps.** Dimensions that were Achieved once and later slipped back, with how many.
- **First-Post-Teaching Retention.** Of taught words, the share you got right on the first retrieval attempt after teaching.

## 8. Settings & Data

![Settings tab](screenshots/views/settings.png)

- **Appearance.** System, Light, or Dark theme.
- **Exam Date.** If set, scheduling favours getting words to Exam Ready before that date: words that are not yet Exam Ready have their next review pulled in so they do not fall due after the exam.
- **Backup & Restore.** Export writes all data to a JSON file named `vocab-trainer-backup-<date>.json`. Import reads one back, and offers to merge it with the current data or replace it.
- **Data.** Shows the word and error counts, and has Erase All Data.
- **About the method.** A short statement of the approach: generative retrieval over recognition, adaptive spacing instead of a fixed schedule, and mnemonics that fade once retrieval is reliable.

Because data lives only in the browser, exporting regularly is the only backup.

## What's tracked

Each word has a status for each of these eleven dimensions: Not assessed, Developing, or Achieved. The right-hand column lists what feeds each one, taken from how the app records results.

| Dimension | What it covers | Fed by |
|---|---|---|
| Form / Word-Family Errors | Knowing the right part of speech and word family | Form errors |
| Form Recall (Spelling) | Producing the exact written form from memory | Cued recall, step 5 retrieval and spelling check, Spelling errors |
| Meaning Recognition | Choosing the right meaning or sentence from options | Level 1 recognition, step 4 multiple choice and cloze |
| Meaning Recall | Recalling the word or meaning from a cue | Level 2 cued recall, step 4 explain, step 5 retrieval, Meaning errors |
| Semantic Discrimination | Telling the word apart from near-synonyms | Step 4 explain, Selection errors |
| Grammar | The patterns the word takes (prepositions, structure) | Step 6 constrained production, Grammar errors |
| Collocation | Natural word partners | Step 6 constrained production, Collocation errors |
| Contextual Comprehension | Understanding the word in context and register | Level 3 cloze, step 4, Register errors |
| Guided Production | Using the word in a sentence under a constraint | Step 6 constrained production |
| Independent Production | Using the word in an original sentence | Step 7 independent production, level 4 free production |
| Novel Application | Using the word in an unfamiliar situation | Context / production drills |

Mastery stages are computed from this and from recent history. New means taught but not yet practised. Learning means practised but not yet consistent. Unstable means recent mistakes. Stable means the last five answers were all correct, the word is at level 3 or above, and its review interval is 10 days or more. Exam Ready needs at least two successful independent productions and one novel application since the last reset, with the last three answers correct.

## What the app doesn't do

- **No server, accounts, or sync.** Data lives in one browser on one device. Clearing site data deletes it, and there is no cross-device copy unless you export and import a file yourself.
- **No automatic grading of writing.** Sentences in teaching, practice, drills, and exams are self-graded against the word's stored notes. The app does not check grammar or meaning.
- **No built-in word list.** You supply the words, by hand, by paste import, or by running the generator prompt in an AI tool of your choice.
- **Scheduling uses default FSRS parameters.** FSRS-6 is used with its default parameters; the app does not optimise them from your own history. Only recognition, meaning recall, and production are scheduled by FSRS; cloze, drills, and other levels use the older level-based schedule.
- **Analytics are descriptive.** The comparison between scheduling methods is not a causal result, and the diagnostic charts need a reasonable number of reviews before they say anything.
- **Text-to-speech depends on your browser.** The speaker buttons use the browser's built-in voices, which differ between browsers and systems.
- **Known bugs.** [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) lists the bugs found by code review and not yet fixed. The open ones are all rated P3: latent or hard to trigger.
