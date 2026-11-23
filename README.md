# strut-code

Your team's workspaces on Stadeum: pick the repos you work on together,
and agents keep up with every new commit and set each workspace up for
jobs.

A workspace is a set of the box's repositories, what a pod is claimed for.
A repository is the box's while it is in a workspace. A private one is
read as a person, with their own token for its host: whoever puts it in a
workspace, and for the scheduled `check` the `check` workflow's owner.
Strut picks the token by the address's host and hands it to git for that
host alone; the package never sees it, and names no forge, host or
secret.

## What it ships

| Part | What |
| --- | --- |
| `graph/Repository.yaml`, `graph/Workspace.yaml` | The two graph types, and the `Workspace -[INCLUDES]-> Repository` link |
| `concepts/Repositories.md` | The `Repositories` page: the contract another package reads these nodes by (each field, the link, a workspace's page) |
| `concepts/Code Change.md` | The `Code Change` page, a kind of job under strut's `Job`: how a change to one of the box's repositories is made and how it ends (below) |
| `concepts/Codebase.md` | The `Codebase` page, a root: short, and it stays as it is. Under it go a page for each workspace that has been baked, and later a page for each repository and each feature |
| `apps/code/` | **Code**, every person's app, about making workspaces: a card for each, with its repositories, each with its branch and when it was last checked, and a link to its page once it is baked. **New workspace** takes a name and repositories ticked from what the viewer's accounts reach (strut's `git/repositories`) or added by address. A card's menu adds repositories, renames and deletes; a repository is taken out with its ×. Opened with an address (`add`), it opens New workspace with it filled in (`src/input.ts`) |
| `workflows/check.yaml` | Every 15 minutes (`schedules:` in `strut.yaml`): `heads`, then `ingest` on each repository whose head is not ingested. It writes no workspace |
| `workflows/ingest.yaml` | Takes a repository in at its head. Today it only records the commit: a parser plugs in here, before `record` |
| `steps/repositories.ts` | The job agent's tool and the app's read: the workspaces and their repositories, each workspace's page, and what the forges reach as the caller |
| `steps/workspace.ts` | The job agent's tool and the app's New workspace and changes: make a workspace, or put repositories in one or take them out, as the caller |
| `steps/rename.ts`, `delete.ts` | The app's Rename and Delete |
| `steps/default-workspace.ts` | The suggested default workspace's **Set up**, a person's press in the Code app |
| `steps/heads.ts` | `check`'s pass: strut's `git/remote-head` on each remote, four at a time, as the run's person |
| `steps/record.ts` | `ingest`'s step: the head, recorded as ingested |
| `strut.yaml` `job:` | The job agent's tools: `repositories` and `workspace`, and strut's own `git/push` and `git/pull-request` |
| `steps/_code.ts` | What the steps share |

How it holds together:

- **Anyone makes workspaces, as themselves.** Any person the Code app is
  shown to makes and changes workspaces there, and the job agent does
  with the `workspace` tool, as the job's person. Each repository put in
  is asked for at its remote as that person first, so only one their own
  token reads goes in, and a refusal changes nothing. Whatever sets the
  workspace up runs as them too. The owner's rule (2026-11-23: *"anyone
  can make a workspace"*). It is one line, `MAKERS` in `steps/_code.ts`:
  `"anyone"` or `"admins"` (an admin, in the Code app, alone; the job
  agent's tool then refuses, as strut tells a step about an admin only on
  a page's call).
- **Only the Code app, or no page.** Strut's app door names a page's app
  from the identity it signed for the page (`ctx.app.name`). Any app may
  list these steps among its grants, so a change from another app, or a
  builder's preview of this one, is refused and says where workspaces are
  changed. A run that is nobody's changes nothing.
- **The graph through strut's own steps.** The steps write and read through
  `graph/find`, `graph/create-node`, `graph/edit-node`, `graph/delete-node`,
  `graph/create-triplet`, `graph/delete-edge` and `graph/graph-edges`, run
  from the step's own context (`ctx.registry`), so strut's rules for the
  graph hold as for any other caller.
- **An address is checked before it is stored.** Only
  `https://<host>/<owner…>/<name>`, with no credentials, query or `#`, each
  part letters, digits, `.`, `_` and `-`. It is written one way (lowercase
  host, no trailing slash or `.git`), so the same repository added twice is
  one node.
- **A remote is asked through strut, as a person.** `workspace` and `check`
  ask for a repository's default branch and head with strut's
  `git/remote-head` (one `git ls-remote --symref <url> HEAD`, no clone),
  run from the step's own context as the graph steps are. Strut reads it
  with the run's token for the address's host (`github.com`'s
  `GITHUB_TOKEN`, or the secret a forge's package serves that host with,
  `provides.git`): the person's own, as each person connects their
  account. The token goes to git for that host alone, never to the
  package; a public repository needs none. The package runs no git of its
  own.
- **What the forges reach, through strut.** New workspace lists strut's
  `git/repositories` (stakwork/strut#851): strut asks each forge package's
  `repositories` step, named on its `provides.git` entry, as the viewer.
  So GitHub, GitLab and Forgejo packages each fill it, and this one names
  none. Without the step, or with no forge package, a repository is added
  by its address.
- **A refusal says what a person can do.** From strut's error: no access
  (the person has not connected an account for that host, or it cannot read
  the repository), no repository there, unreachable, or no commits yet.
  `check` keeps it on the repository's node (`problem`), naming the
  workflow's owner it ran as, so whoever opens the Code app sees whose
  account is missing; New workspace says it to the person.
- **A repository is the box's while it is in a workspace.** A workspace
  holds one at least: emptying it is deleting it. A repository taken out
  of the last workspace it was in leaves the box, its node deleted.
  Deleting a workspace deletes its page and each of its repositories in no
  other. A workspace has no main repository: what runs it is its own setup,
  which the package that runs workspaces keeps on its node.
- **The default workspace waits for Set up** (the owner's rule,
  2026-11-23). While the box has no workspace, `repositories` gives a
  `suggested` one from what the viewer's forges reach: every repository
  picked on GitHub (`picked`, which a forge sets on a repository granted
  one by one), or the five most recently pushed when an org granted all
  of them, named after their owner. The Code app shows it with a **Set
  up** button, and nothing is written until someone presses it
  (`default-workspace`). It is then worked out again from what their own
  forges reach and written as them, so its setup runs as them; a
  repository whose remote refuses them is left out. No setup job starts
  unasked, and `check` writes no workspace.
- **Making a workspace is all Code does.** Setting it up is the package's
  that runs workspaces (`stadeum/pods`, on strut's `on: created:
  Workspace`), and a new repository's webhook is its forge package's (`on:
  created: Repository`). This package names neither.
- **A rename keeps the node.** The `Workspace` keeps its `ref_id`, so what
  other packages keep on it (pods' `.pod/`, as files on the node) stays,
  and its page takes the new name.
- **A workspace's page is a Concept, not a field.** The `Workspace` node
  keeps its `name` and `INCLUDES` links alone. What its systems are and
  how they connect is the Concept `<workspace> workspace` (`hive
  workspace`), which `stadeum/pods` writes at the bake, under `Codebase`
  and `Pod`: a Mermaid diagram, the system in words, how to run it. Only a
  baked workspace has one, so the `Code Change` page reads it as a sign
  that the workspace is ready. `repositories` finds each workspace's page
  by that name (`graph/find`) and gives it as `page`; the Code app links to
  it in strut's Knowledge app (`appLink("strut/knowledge", { node: <its
  ref_id> })`). The step that deletes a workspace deletes its page first,
  through strut's `graph/delete-node` like the node (soft: the history
  keeps it).
- **0.6's `main`.** A `Workspace` made by 0.6 or before may carry `main`.
  Nothing reads it, `check` clears it, and the type keeps it declared so
  those nodes read as before.

It requires no secret of its own, and a strut with the package seams of
stakwork/strut#851 (`git/repositories` and `git/pull-request`), besides
`git/remote-head` (stakwork/strut#798) and the grant of strut's own
steps with `git/push`'s guards (stakwork/strut#800 and #802). A strut
without `git/pull-request` refuses the install, since `job:` grants it. Do
not promote this to `stable` until #851 is merged and released: the
Software bundle follows `stable`.

## A Code Change job

A job's `kind` names a page under strut's `Job`, and every turn of the
job opens with that page (strut's `job` workflow). Strut's orchestrator
lists the kinds by their descriptions and picks `Code Change` for a
request to change the code of one of the box's repositories; a question
about the code is not one. The page tells the job's agent, in the order
it acts:

1. **Find the repository** with `repositories`: in a workspace, among what
   the person's accounts reach, or by the address they gave. With several
   and none named, it asks.
2. **Small or deeper.** One test: can a person tell whether the change is
   right from its diff alone? A colour, a size, a label or wording is
   small. Anything only running it can judge is deeper.
3. **A small change needs no pod, no tests and no workspace** (the
   owner's rule, as Hive works): `git_checkout` into the job's directory,
   the edit, then `git_push` from the absolute path the checkout returned,
   to a new branch, as the person. Then `git_pull_request`, which opens it
   with the step of the forge that serves the repository's host. With
   none, the reply says the branch is pushed and where. One that turns out
   deeper moves to a pod, and the reply says why.
4. **A deeper change goes on a pod** from `stadeum/pods`, claimed for a
   workspace: the smallest ready one (baked: it has a page) that holds the
   repository, else the smallest that holds it. When none does, the agent
   makes one with `workspace` and sets it up in the same job. Its first
   message names the workspace and why, so the person can correct it in
   words. The page doesn't restate how to work in a pod: it sends the agent
   to the pods package's `Pod` page, another kind under `Job`, which it
   opens by name. The app and its tests run there, and the pod's `git`
   pushes and opens the pull request. A workspace's setup (`.pod/`) is the
   workspace's, kept on the box at the bake: it goes in no pull request.
   Without the pods package, or when the claim fails, the change is made in
   the checkout, and the reply says plainly that nothing was run here.
5. **It ends in a pull request as the person**, on a new branch, never a
   push to the default branch; a later turn's change lands in the same
   pull request. When the branch can't be pushed (the person's account
   for that host isn't connected to the box, or can't push there), the
   reply says so in plain words and hands over the diff.
6. **The pull request's checks** run the change where nothing here can:
   an Android build on a pod without Android, or any change made without
   a pod. The agent reads them with the forge's tool (`github_pr_status`,
   which `stadeum/github` grants): still running, it says so and doesn't
   wait; failed, it reads why (`logs: true`, each failed job's log in a
   file it searches), fixes it on the same branch and pushes; passed, it
   says what they ran. What reviewers said is `github_fetch_pr`'s.

The page names each tool as the job agent sees it on a box: a step's
type with every `/` and `-` made `_` (`git/pull-request` is
`git_pull_request`, `stadeum/code/workspace` is `stadeum_code_workspace`).

The page carries no claims or cases yet. Strut records the `claims:` of
its own pages at boot, not a package's at install, and a case for this
page would be a coding job, which a trial doesn't run.

**The push and the pull request.** The package grants the job agent
strut's own `git/push` and `git/pull-request` (`job: tools: [repositories,
workspace, git/push, git/pull-request]`). Strut's `git/push` holds its own
lines for every caller (stakwork/strut#802): it never pushes the remote's
default branch, cannot force, and pushes only a working copy
`git/checkout` made for the run or its job, by its absolute path. It
pushes as the job's person, with their own token for the repository's
host. `git/pull-request` calls the pull-request step that the forge
package serving the repository's host names on its `provides.git` entry
(stakwork/strut#851), as the same person. Neither asks first (no
`approve:`): the pull request opened on the branch is the person's
review, and a push waiting on their yes would end the turn before the
pull request could be opened. This package names no forge.

## Versions

- **0.7.0** The Code app is about making workspaces (stadeum's
  `plans/software.md` §14.4, revised 2026-11-23):
  - New workspace, from what the viewer's forges reach or by address;
    add, take out, rename and delete on each workspace's card. Add a
    repository, Workspaces… and Make main are gone.
  - Anyone makes workspaces, as themselves (the owner's rule; `MAKERS`).
  - A workspace has no main repository. A repository is the box's while
    it is in a workspace.
  - While the box has no workspace, the Code app suggests the default
    one and writes it only when someone presses Set up (the owner's
    rule).
  - The `workspace` job tool. `repositories` also lists what the forges
    reach.
  - `Code Change` opens the pull request with `git_pull_request`, picks
    the smallest ready workspace for a deeper change or makes one, and
    says which in its first message.
  - Needs strut's package seams (stakwork/strut#851).
- **0.6.2** `Code Change` §6: checks still running when the turn ends
  aren't waited on. If they fail later, strut sends the job one turn to fix
  them, once per pull request (stakwork/strut#835's `job/pr-checks`, run by
  stadeum/github 0.3.0's schedule), and the page says so.
- **0.6.1** `Code Change` §4 says what a pod is for:
  - A tool the build needs that the pod can run goes in the workspace's
    image (`.pod/`'s `Dockerfile`, then bake), not one job's shell.
  - An app a pod can't run (a phone app; a platform or an architecture
    it lacks) is changed in a checkout, and the pull request's checks run
    it.
  
  The case behind it: a one-line Android change with a unit test went to
  a bare arm64 pod. The agent installed the SDK there, ran `aapt2` under
  qemu, then hit Robolectric's "not supported on Linux (aarch64)".
- **0.6.0** The `Code Change` page reads the pull request's checks after
  opening it: CI is where a change runs that nothing here can, so a
  failed check is the agent's to read and fix, and a change is called
  tested only on what it saw pass. The tools are `stadeum/github` 0.2.0's.
- **0.5.0** The `Codebase` root page. `Repositories` says that a
  workspace's page is the Concept `<workspace> workspace`, written by
  `stadeum/pods` at the bake. `repositories` gives each workspace's
  `page`, the Code app links to it in the Knowledge app, and a workspace
  that goes takes its page with it.
- **0.4.0** The job agent is granted strut's `git/push`, so a small
  change ends as a pushed branch and, where the box has a pull-request
  tool, a pull request. The `Code Change` page names each tool as the
  agent sees it, pushes from the checkout's absolute path, and says what
  to do with no pull-request tool. The Code app fills an admin's Add field
  from the `add` it is opened with.
- **0.3.0** Private repositories, read as the person through strut's
  `git/remote-head`.
- **0.2.0** The `Code Change` page.
- **0.1.0** The list, its workspaces, the Code app, `check`, `ingest` and
  the `repositories` tool.

## Installing it

A box follows the `stable` branch:

```text
git+https://github.com/stakwork/strut-code@stable
```

With the deployment key, as a subscription (it moves when `stable` does):

```bash
curl -X PUT $STRUT/packages/subscriptions/code -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"ref":"git+https://github.com/stakwork/strut-code@stable"}'
```

Or once, by a person, who then owns its workflows, so `check` runs as them:

```bash
curl -X POST $STRUT/packages/install -H "authorization: Bearer $KEY" -H "x-strut-actor: $ME" -H 'content-type: application/json' -d '{"ref":"git+https://github.com/stakwork/strut-code@stable"}'
```

It needs a strut with a graph (Neo4j, or a LadybugDB file): its types are
refused on a filesystem workspace. `check`'s schedule runs as the owner of
the `check` workflow; with none (a subscription's install, today), it runs
nothing until an admin gives the workflow an owner.

## Developing it

`package.test.ts` installs this directory into a strut started in the test's
own process from a checkout of stakwork/strut, on a LadybugDB file, and
drives it as the Code app (people making and changing workspaces, and an
admin's call from another app), the schedule and the job agent do. It
launches a job of the kind `Code Change` and checks that the turn opens
with the page and holds `stadeum_code_workspace`, `git_push` and
`git_pull_request`; the model is stood in for (strut's
`registerModelWrapper`), so no key is needed. For a small change the
stand-in is scripted (strut's mock model) along the page's path: it lists
the repositories, checks the private one out into the job's directory,
edits and stages it, is refused its default branch, pushes a new branch
with the person's own token, and opens the pull request through strut's
`git/pull-request`. The default workspace is suggested from what the
viewer's forges reach while the box has none, written only at Set up, as
the person who pressed it, and never by `check`. A workspace
is renamed in place (the same node, its page renamed) and deleted with
its page and the repositories in no other; a workspace's page is written
under `Codebase` as pods writes it at the bake.

It reaches github.com, for public repositories. A private one is served
from the test's own machine over http behind a token, its https address
pointed there by git's `insteadOf` (strut's `test-util/git-remote.ts`),
and a stand-in forge package serves that host: its token
(`provides.git`), its `repositories` step (what a person's token reaches
there, each `picked`) and its `pull_request` step. A private repository
goes in a workspace with the person's own token and is refused without
it, then is checked as the `check` workflow's owner, with a `problem`
naming them when they have none. No real token is read.

```bash
STRUT_DIR=../strut npm test
```

`STRUT_DIR` is a strut checkout with its install (`yarn install
--frozen-lockfile --ignore-scripts`, and the same in `kit/`), with the
package seams (stakwork/strut#851). `.github/workflows/checks.yml` runs
it on every pull request and push to `main`: against strut's `main` once
it has `git/repositories`, and until then against #851's branch,
`plan/package-seams`.

To try the app, install the checkout into a strut of your own:

```bash
curl -X POST $STRUT/packages/install -H "authorization: Bearer $KEY" -H "x-strut-actor: $ME" -H 'content-type: application/json' -d "{\"ref\":\"file:$PWD\"}"
```

## Releasing it

A merge to `main` changes no box. `stable` moves only when someone runs the
`promote` workflow with a commit on `main` whose checks passed; a rollback
is the same run with an older commit:

```bash
gh workflow run promote.yml -R stakwork/strut-code -f commit=<sha>
```

The first run makes `stable`.
