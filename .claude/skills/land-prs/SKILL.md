---
name: land-prs
description: Merge one or more approved pull requests in this repo in a safe order, resolve the conflicts the first merge causes in the next, then sync main, clean up merged branches and worktrees, and line up the next action items. Use when the user says "merge it", "merge 97 and 98", "land these", "sync main and prepare the next items". Merging deploys to GitHub Pages, so only when the user has said to.
---

# Land PRs and sync

Merging to `main` deploys. Only merge what the user named, and say what you did. Squash for one commit per PR
(rebase only for a deliberate commit series; merge commits are disabled).

## 1. Check each PR

```bash
gh pr view N --json state,mergeable,mergeStateStatus,headRefOid,statusCheckRollup
gh api repos/jaballer/audio-lab/commits/<headRefOid>/check-runs -q '.check_runs[]|"\(.name) \(.status) \(.conclusion)"'
```

The `check` job must be green **on the current head commit**, with no unresolved review threads (use the
GraphQL query in `handle-review-events`). Not green or not resolved: stop and say so.

## 2. Pick the order

Merge first the PR that is **larger, longer reviewed, or depended on**; the smaller one then takes any conflict,
which is cheaper to resolve. If one builds on the other, merge the base first. State the order and why.

## 3. Merge, then fix the next one

`gh pr merge N --squash --delete-branch`. Then re-read the next PR's `mergeStateStatus`. If it is
`CONFLICTING`: switch to its branch, `git fetch origin && git merge origin/main`, resolve keeping both sides'
intent, `npm run check`, commit, push (normal push, never force), confirm the check passed on the **new** head,
then merge it.

## 4. Sync

```bash
git fetch -p origin
git -C /Users/jabaltorres/Sites/audio-lab pull --ff-only      # the root checkout's main
git switch --detach origin/main                                 # in the worktree you are in
```

Delete a local branch only when its PR shows MERGED (`git branch -d`, or `-D` after confirming MERGED, since
squash merges look unmerged to git). Remove a worktree only if `git status` there is clean and its branch is
merged; **leave dirty worktrees and report them**. Never use bare `git stash`. Check that closed issues closed.

## 5. Prepare next items

List open PRs and issues (`gh pr list`, `gh issue list`). Group them, recommend the first, say what to bundle with
it, and ask the one decision that is the user's. Flag PRs that are not yours and have fallen behind `main`.
