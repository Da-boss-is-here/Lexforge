Title: Submit a written sentence with Ctrl/Cmd+Enter
Labels: good first issue, accessibility

## Context

Single-line answers (cued recall, cloze, retrieval) submit on Enter. The sentence boxes don't: free production in Practice (`#answerInput` textarea), and Teaching steps 6 and 7 (`#constrainedInput`, `#independentInput`) all require reaching for the mouse or Tab-ing to the button. Plain Enter must keep inserting a newline in a textarea, so the usual convention is Ctrl+Enter (Cmd+Enter on macOS).

## What to do

Add a `keydown` handler to those three textareas that clicks the same button the existing click handler is wired to when `(e.ctrlKey || e.metaKey) && e.key === 'Enter'`. Reuse the existing submit path rather than duplicating it, and ignore the shortcut when the textarea is empty only if the button's own handler does the same.

## Notes

- Each of the three submit handlers lives in `index.html` (`Views.renderPracticeCard`, `Teaching.wireStep6`, `Teaching.wireStep7`).
- Consider a small hint under the button ("Ctrl+Enter to submit"), but keep the change small.
- Don't change scoring or the self-check step. Free production stays self-checked.
- Check by hand with "Try with sample words" and the Teaching flow.
- See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Done when

All three boxes submit on Ctrl/Cmd+Enter, plain Enter still inserts a newline, and the existing tests pass.
