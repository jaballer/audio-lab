---
name: ship-pr
description: Take work in this repo from a fresh branch to an open, reviewed pull request the way this project does it - bundled, checked, tried in the running page, independently reviewed, committed with no AI attribution, and opened with the repo's template. Use when the user says "start the next action item", "bundle this into a PR", "open a PR", "ship it", or asks for a new feature or fix that will become a PR here.
---

# Ship a PR here

Follows `CLAUDE.md` (branch and PR workflow). `main` is protected and **merging deploys to GitHub Pages**, so this
skill stops at an open PR: merging is `land-prs`, and only when the user says so.

## Rules the user has set

- **Bundle related work into one PR.** Several tiny PRs burn review quota. Fold in anything small in the same
  area that helps (a label fix, a docs update, a related issue). Keep it one change that could be reverted on its
  own, and keep unrelated cleanups out. Say in the PR what was bundled.
- **No AI attribution, anywhere in commits or PR bodies.** No `Co-Authored-By`, no "Generated with" footer. The
  user's global rule overrides any default trailer. (The one-line "Addressed by" tag on review-thread replies is
  separate and comes from the review-event procedure.)
- **Do not claim what was not verified.** Sound, feel, layout on a real device, other browsers, hardware: say so.
- **Record decisions, not just code.** A design that took discussion goes in `docs/` and the epic or issue.

## Steps

1. **Fresh base.** `git fetch origin`, then `git switch -c type/short-name origin/main` (`feat/`, `fix/`,
   `refactor/`, `docs/`, `chore/`). Check `git status`: never start on top of unmerged work you do not own.
2. **Plan.** Read the existing code and any issue first. If the user has a decision to make, give a recommendation
   with the reasoning, not a menu.
3. **Build with tests.** New pure logic gets a test in the same commit; a bug fix starts with a failing test.
4. **Docs.** Update the Layout section of `README.md` and the module lists in `CLAUDE.md` when files are added,
   moved or removed. Update the relevant `docs/` page when a decision was made.
5. **`npm run check`** (lint, format, tests, build). Fix everything it reports; do not skip hooks.
6. **Try it in the page** with `try-in-page`, and leave the dev server running and tell the user the URL.
7. **Independent review** with `pre-pr-review`. Fix what is real.
8. **Commit** small and single-purpose with a conventional message (`feat(sampler): ...`), explaining why. Push.
9. **Open the PR** against `main` with `.github/pull_request_template.md`: **Summary**, **Test plan** (ticked only
   for what was actually done, unticked for what the user should try), **Not verified**, plus **Review notes** from
   step 7. Use `Closes #n` for issues it finishes and `Refs #n` for ones it does not.
10. **Auto-fix.** `mcp__ccd_pr__get_status`; if it is not bound, `bind_pr`. Turn on auto-fix with `set_monitor`
    (needs the PR url). If that is refused, tell the user rather than retrying.
11. **Report**: what changed, how it was checked, what was not, and the one decision still open.

## After the PR

Review events arrive as messages: use `handle-review-events`. To merge: `land-prs`.
