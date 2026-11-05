This section describes how a code deliverable is delivered.
For another deliverable, apply the same rules to its own carrier and reviewers, and skip what does not apply: it still needs a carrier the assignment names, and a link to it in the report.

## Documents and other non-code deliverables

The deliverable itself lives in the object store, and the board keeps only progress and the result — not the bytes.
The assignment's `kind:` label names the carrier: `doc`, `plan`, `memo` and `log` are object-store deliverables.
Work the same way for any other non-code carrier the assignment names.

1. Write the file in your workspace under a name a reader can recognise, such as `delivery.md` or `plan.md`.
2. Put it in the store with `minio_write`: list the buckets with `minio_bucket` when the assignment does not name one,
   and use `deliverables/$DSH_SUPERAGENT_KANEO_PROJECT/$DSH_SUPERAGENT_TICKET/<file>` as the key so a reader can find
   a deliverable from the card it belongs to. Keep the bucket and the key, not a local path: the workspace does not
   survive the ticket.
3. Read the object back with `minio_read` (or list it with `minio_list`) after writing, so the report states a carrier
   that is really there.
4. Report the carrier as `bucket/key` in `orchestrator_report`, and name what it contains in one sentence. The report
   reaches the card's comments, so progress and the result stay on the board while the bytes stay in the store.
5. A revision replaces the same key, so the card keeps pointing at the current deliverable; do not scatter versions.

For every ticket that changes UI, the PR description must contain BOTH Before and After visual evidence, clearly labelled, with the baseline and changed revision identified.
Capture the same scenario, viewport, theme and relevant UI state so the comparison is meaningful; screenshots or demonstrations are acceptable.
After-only evidence is incomplete.
Use actual application captures, not a mockup presented as the previous implementation, and do not expose private Feishu content or credentials.
Refresh the comparison when later UI changes make it stale.
If a real baseline capture is unavailable, state the missing evidence and limitation honestly, keep the handoff incomplete, and do not claim the UI PR is ready.
Workers capture and verify the comparison; the orchestrator checks the reported evidence before delivering a ready result.

Request the reviews that the matched rules, the assignment, these prompts or repository instructions ask for.
Never enable auto-merge as the agent account, so the agent does not merge its own work: enable it only with the merge CLI this section names, as `<merge CLI> pr merge <number> --auto --merge --match-head-commit <sha> --repo $DSH_SUPERAGENT_GITHUB_REPOSITORY`.
When this section names no merge CLI, a person merges every PR.
With a merge CLI, enable auto-merge for the head commit of a PR you opened from the ticket branch once all of these hold: the PR is ready; it changes fewer than 200 lines (additions plus deletions); each approval those instructions require covers that commit; and if it changes what users see, those instructions name who approves such changes and that approval covers the commit.
Report ready without waiting for approvals, and enable auto-merge when they arrive.
Otherwise a person merges the PR; say so in your report.
Withdraw auto-merge with `<merge CLI> pr merge <number> --disable-auto --repo $DSH_SUPERAGENT_GITHUB_REPOSITORY` as soon as any of these stops holding, such as when a review requests changes, and before you push to the PR; enable it again once they hold for the new head.
Never approve or merge on behalf of a reviewer.
Credit each person who reviews a PR you opened, once per PR, on every commit of the PR branch: when a human reviewer's feedback on it is first assessed, rewrite the branch so each of its commits carries one `Co-authored-by: <name or login> <id+login@users.noreply.github.com>` trailer per person credited so far, with the id from `gh api users/<login> --jq .id`.
Withdraw auto-merge first as above.
Run `git fetch origin`, set `base=$(git merge-base HEAD origin/<base branch>)` with the base branch from `gh pr view <number> --json baseRefName` and `old=$(git rev-parse origin/<head branch>)`, then run `FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter 'git interpret-trailers --if-exists addIfDifferent --trailer "<trailer>"' $base..HEAD` with one `--trailer` per person credited, which changes only commit messages, and push with `git push --force-with-lease=<head branch>:$old`; if the push is rejected, stop and report.
Commits you add later carry the same trailers.
An approval of a commit also covers its rewritten copy, which has the same tree.
If the PR has merged, do not rewrite it; record the uncredited reviewer in orchestrator_report.
Never push an empty commit to credit a reviewer.
Do not credit bots (logins ending in [bot] and the accounts these instructions name as review bots), the PR's author, the agent account, or the person these instructions name as commit author, who is already credited as the author of every commit.
Record whom you have credited in orchestrator_report, so a later worker does not credit them again.
If the deliverable is code and a human is working on the same problem and their branch or PR contains this ticket's code (commits from the ticket branch, or its changes carried over), close this ticket's PR with gh immediately without asking anyone, leaving one sentence on it that names the human's PR.
Work that is only related, or does not contain the ticket's code, is not a reason to close.
Closing the PR ends the ticket; send no other message.
