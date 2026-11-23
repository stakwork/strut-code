---
name: Code Change
description: A request to change the code of one of the box's repositories (fix a bug, restyle, reword, add a feature), delivered as a pull request. Not a question about the code, which changes nothing.
parents:
  - Job
---
A change to the code of one of the box's repositories, delivered as a
pull request opened as the person. The pull request is the proposal:
they review it there.

## 1. Find the repository

Call `stadeum_code_repositories`. Each repository comes with its `url`,
its default `branch` and its `workspaces`. Take the one the person means.
When they named none and the box holds several, ask before anything else.
A repository that isn't listed isn't the box's: say so, and that an admin
adds it in the Code app.

## 2. Small or deeper

One test: can a person tell whether the change is right from its diff
alone?

- **Small:** yes. A colour, a size, a label, wording, a constant, in one
  place or two. No pod, no tests.
- **Deeper:** anything only running it can judge: behaviour, logic, data,
  a dependency, the build, a change across several files or areas. It
  goes on a pod, where the app and its tests run. A detailed request is
  still deeper.

## 3. A small change, in a checkout

1. `git_checkout { repo: <url>, workdir: <your job id> }`.
2. Find the place and make the edit. Install, build and test nothing.
3. If it turns out deeper than it looked (the value is computed, tests or
   other code depend on it, the edit spreads), stop: do it on a pod (4),
   and say in `text` why you moved it.
4. Stage it with `bash` (`git add -A` in the checkout), then `git_push {
   path: <the absolute path git_checkout returned>, branch: <a new
   branch>, message }`.
5. Open the pull request with your pull-request tool for the repository's
   host (`github_create_pr { repo: <url>, head: <your branch>, base: <the
   default branch>, title, body }` for github.com). With none, say the
   branch is pushed (its name, on `url`) and that this box has no tool to
   open the pull request.

Its claim is checked by the person looking at the pull request (an
external check): nothing runs it here.

## 4. A deeper change, on a pod

Claim a pod (`stadeum_pods_claim`) for a workspace the repository is in:
the one it is main of, unless the request is about another. Once you hold
it, open the `Pod` page (`graph_graph_get { node_type: "Concept", name:
"Pod" }`) and work as it says, with the pod tools. Make the change, run
the app and its tests, and look at it in the browser. Commit it on a new
branch and push with the pod's `git` (`push -u origin <branch>`, with
`pr`): that opens the pull request.

A workspace never set up (the claim gives a bare pod, with no image) is
set up on the way, as the `Pod` page says. Its `.pod/` goes in a pull
request of its own, then the change in another. Say so in `text`.

A tool the build needs that the pod can run (a Rust toolchain for one
crate of a Node app) goes in the workspace's image, not this job's shell:
`.pod/`'s `Dockerfile`, then bake, as the `Pod` page says, so every later
job has it.

No pod (no `stadeum_pods_claim` among your tools, or the claim fails), or
an app a pod doesn't run (a phone app; a platform or an architecture the
pod lacks): make the change in a checkout as in 3. Build no platform for
it here. Say plainly in `text` what wasn't run and why. The pull
request's checks (6) are then what runs it.

## 5. How it ends

- Always a new branch, never the default one, and never force.
- A later turn's change ("make it bigger") goes on the same branch, so it
  lands in the same pull request. If the checkout is gone, check that
  branch out (`ref`).
- List the pull request in `artifacts`: `{ id: "pr", kind:
  "pull_request", title, url }`.
- When the branch can't be pushed, say why in plain words, and hand over
  the change's diff as a file so nothing is lost.
- A push or pull request refused for want of the person's credentials
  (`no_push_permission:`, or a token that isn't set) means their account
  for that host isn't connected to this box, or can't push there: ask
  them to connect it, or to get access, then to ask again.

## 6. The pull request's checks

The repository's CI runs the change too, including what nothing here can
run (a build or a platform this box or the pod lacks). Once the pull
request is open, read its checks with your tool for the repository's host
(`github_pr_status` for github.com):

- Still running when you're done: say so, with the link. Don't wait on
  them; the person can ask you to look again.
- Failed: it's yours. Read why (`logs: true`), fix it on the same branch,
  push, and say what failed and what you changed.
- Passed: say what they ran. The change is tested only by what you saw
  pass, here or there.

What reviewers said on the pull request is `github_fetch_pr`'s.
