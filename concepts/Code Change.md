---
name: Code Change
description: A request to change the code of one of the box's repositories (fix a bug, restyle, reword, add a feature), delivered as a pull request. Not a question about the code, which changes nothing.
parents:
  - Job
---
A change to the code of one of the box's repositories, delivered as a
pull request opened as the person. The pull request is the proposal:
they review it there.

YOUR GOAL IS TO WRITE CLEAN, GENERIC CODE! Internalize this fact: we cannot yet imagine the integrations, features, user stories, etc that we'll build later - so keep things neutral and modular. Always look for opportunities to simplify

## 1. Find the repository

Call `stadeum_code_repositories`, even when repositories are already
checked out in your directory: its workspaces decide where the work
runs (2). Take the one the person means: in a workspace, in `reachable`
(what their own accounts reach), or the https address they gave. When
they named none and several fit, ask first. One none of these has, with
no address, this box can't reach as them: say so, and that they connect
the account that reads it.

## 2. Pod or checkout

Decide this first. A pod runs the app, so the change is seen working:
use one whenever a ready workspace (4) holds the repository, however
small the change. With none ready, can a person tell from its diff
alone whether the change is right?

- **Small:** yes. A colour, a size, a label, wording, a constant, in one
  place or two. A checkout (3).
- **Deeper:** anything only running it can judge: behaviour, logic, data,
  a dependency, the build, a change across several files or areas. It
  goes on a pod, never a checkout in your directory, whatever the
  message asks. A detailed request is still deeper.

## 3. A small change, in a checkout

1. `git_checkout { repo: <url>, workdir: <your job id> }`.
2. Find the place and make the edit. Install, build and test nothing.
3. If it turns out deeper than it looked (the value is computed, tests or
   other code depend on it, the edit spreads), stop: do it on a pod (4),
   and say in `text` why you moved it.
4. Stage it with `bash` (`git add -A` in the checkout), then `git_push {
   path: <the absolute path git_checkout returned>, branch: <a new
   branch>, message }`.
5. Open the pull request with `git_pull_request { url, head: <your
   branch>, base: <the default branch>, title, body }`, which opens it
   as the person. When none here opens pull requests for its host, say
   the branch is pushed (its name, on `url`) and that this box can't
   open it.

Its claim is checked by the person, on the pull request (an external
check): nothing runs it here.

## 4. On a pod

**Pick the workspace.** A pod is claimed for a workspace, which holds
the repositories the change needs to run. Of the workspaces whose
`repositories` hold this one, take the smallest that is ready: it has a
`page`, which only a baked workspace has. With none ready, the smallest
that holds it. When the change spans several repositories, the smallest
that holds them all. When none holds it, make one with
`stadeum_code_workspace { name, repositories }`, named after the
repository, with the repositories the change needs, and set it up in
this job (below).

**Say which in your first message,** before the work: the workspace,
its repositories, and why it was chosen (or made). The person can
correct you in words.

Claim a pod (`stadeum_pods_claim`) for it. Once you hold it, open the
`Pod` page (`graph_graph_get { node_type: "Concept", name: "Pod" }`) and
work as it says, with the pod tools. Make the change, run the app and its
tests, and look at it in the browser. A change a person can see goes in
`artifacts` as a screenshot. Commit it on a new branch and push with the
pod's `git` (`push -u origin <branch>`, with `pr`): that opens the pull
request.

A workspace never set up (the claim gives a bare pod, with no image) is
set up on the way, as the `Pod` page says. Its setup (`/workspaces/.pod`)
is the workspace's, kept on the box when it is baked: it goes in no pull
request, which holds the change alone. Say in `text` that you set it up.

A tool the build needs that the pod can run (a Rust toolchain for one
crate of a Node app) goes in the workspace's image (`.pod/`'s
`Dockerfile`, then bake), not this job's shell, so every later job has
it.

No pod (no `stadeum_pods_claim` among your tools, or the claim fails), or
an app a pod can't run (a phone app; a platform or an architecture the
pod lacks): make the change in a checkout as in 3. Build no platform for
it here. Say plainly in `text` what wasn't run and why. The pull
request's checks (6) are then what runs it.

## 5. How it ends

- Always a new branch, never the default one, and never force. A plan's
  item uses the branch its brief names, and opens a pull request only if
  none is open.
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
  them to connect it or get access, then ask again.

## 6. The pull request's checks

The repository's CI runs the change too, including what nothing here
can. Once the pull request is open, read its checks with your tool for
its host (`github_pr_status` for github.com):

- Still running when you're done: say so, with the link. Don't wait on
  them. If they fail later, strut sends you one turn to fix them ("Strut
  sent this when the checks finished"), and its end reaches the person.
- Failed: it's yours. Read why (`logs: true`), fix it on the same branch,
  push, and say what failed and what you changed.
- Passed: say what they ran. The change is tested only by what you saw
  pass, here or there.

What reviewers said on the pull request is `github_fetch_pr`'s.
