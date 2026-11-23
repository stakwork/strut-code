# strut-code

Your team's repos on Stadeum: add them, group them into workspaces, and
agents keep up with every new commit.

A private repository is read as a person, with their own token for its
host: the admin who adds it, and for the scheduled `check` the `check`
workflow's owner. Strut picks the token by the address's host and hands it
to git for that host alone; the package never sees it, and names no forge,
host or secret.

## What it ships

| Part | What |
| --- | --- |
| `graph/Repository.yaml`, `graph/Workspace.yaml` | The two graph types, and the `Workspace -[INCLUDES]-> Repository` link |
| `concepts/Repositories.md` | The `Repositories` page: the contract another package reads these nodes by (each field, the link, how to read a workspace main first, a workspace's page) |
| `concepts/Code Change.md` | The `Code Change` page, a kind of job under strut's `Job`: how a change to one of the box's repositories is made and how it ends (below) |
| `concepts/Codebase.md` | The `Codebase` page, a root: short, and it stays as it is. Under it go a page for each workspace that has been baked, and later a page for each repository and each feature |
| `apps/code/` | **Code**, every person's app: the repositories by workspace, each with its branch and when it was last checked, and a link to each baked workspace's page in the Knowledge app. For an admin it also adds a repository by its https address, removes one, puts one in one workspace or several, and names each workspace's main one. Opened with an address (`add`), it fills an admin's Add field with it (`src/input.ts`) |
| `workflows/add.yaml` | The admin's Add: `add`, then `ingest` once |
| `workflows/check.yaml` | Every 15 minutes (`schedules:` in `strut.yaml`): `heads`, then `ingest` on each repository whose head is not ingested |
| `workflows/ingest.yaml` | Takes a repository in at its head. Today it only records the commit: a parser plugs in here, before `record` |
| `steps/repositories.ts` | The job agent's tool (`job: tools:`) and the app's read: every repository and workspace the box holds, and each workspace's page |
| `strut.yaml` `job:` | The job agent's tools: `repositories`, and strut's own `git/push`, which pushes a small change to a new branch as the job's person |
| `steps/add.ts`, `remove.ts`, `place.ts`, `main.ts` | The admin's changes, each refused to anyone else |
| `steps/heads.ts` | `check`'s pass: strut's `git/remote-head` on each remote, four at a time, as the run's person |
| `steps/record.ts` | `ingest`'s step: the head, recorded as ingested |
| `steps/_code.ts` | What the steps share |

How it holds together:

- **Admin-only actions in an app everyone opens.** Strut's app door names a
  page's app from the identity it signed for the page (`ctx.app.name`) and
  marks the call `ctx.app.admin` when its viewer is an admin; every run the
  page launches carries both. `repositories` tells the page (`admin`), which
  draws the admin's controls; `add`, `remove`, `place` and `main` change the
  list only on an admin's call from this package's own Code app
  (`stadeum/code/code`, not a builder's preview of it). Any app may list
  these steps among its grants, so an admin's call from another app is
  refused and says where the list is changed, as strut gives a package's
  admin scope to its own app alone. A member's call, the job agent and a
  workflow nobody launched from the Code app change nothing.
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
- **A remote is asked through strut, as a person.** `add` and `check` ask
  for a repository's default branch and head with strut's `git/remote-head`
  (one `git ls-remote --symref <url> HEAD`, no clone), run from the step's
  own context as the graph steps are. Strut reads it with the run's token
  for the address's host (`github.com`'s `GITHUB_TOKEN`, or the secret a
  forge's package serves that host with, `provides.git`): the person's own,
  as each person connects their account. An admin's Add runs as that
  admin; the scheduled `check` runs as its workflow's owner. The token goes
  to git for that host alone, never to the package; a public repository
  needs none. The package runs no git of its own.
- **A refusal says what a person can do.** From strut's error: no access
  (the person has not connected an account for that host, or it cannot read
  the repository), no repository there, unreachable, or no commits yet.
  `check` keeps it on the repository's node (`problem`), naming the
  workflow's owner it ran as, so whoever opens the Code app sees whose
  account is missing; Add says it to the admin.
- **Opened with an address to add.** Only this app changes the list, so
  another app that finds a repository (stadeum/github's picker) opens it
  with the address: `appLink("stadeum/code/code", { add: "<https
  address>" })`. For an admin the app puts it in the Add field and adds
  nothing: the admin still presses Add, and `add` checks the address
  then exactly as one typed. For a member, or an `add` that is not an
  https address, the app is as it is with no input.
- **A repository is always in a workspace.** A new one gets its own, named
  after it (then after its owner and name, then numbered, when the name is
  taken). Removing a repository takes it out of every workspace; a
  workspace left empty goes, its page with it, and one whose main left
  takes its next repository as main.
- **A workspace's page is a Concept, not a field.** The `Workspace` node
  keeps its `name`, `main` and `INCLUDES` links alone. What its systems
  are and how they connect is the Concept `<workspace> workspace` (`hive
  workspace`), which `stadeum/pods` writes at the bake, under `Codebase`
  and `Pod`: a Mermaid diagram, the system in words, how to run it. The
  bare name is the main repository's page. `repositories` finds each
  workspace's page by that name (`graph/find`) and gives it as `page`;
  the Code app links to it in strut's Knowledge app (`appLink(
  "strut/knowledge", { node: <its ref_id> })`) and shows nothing when
  there is none. The step that deletes an empty workspace deletes its
  page first, through strut's `graph/delete-node` like the node (soft:
  the history keeps it, and a later bake writes it again).

It requires no secret of its own, and a strut with the `git/remote-head`
step (stakwork/strut#798, 2026-11-20) and the grant of strut's own steps
with `git/push`'s guards (stakwork/strut#800 and #802, strut's `main` from
a116207d). Strut has no way yet for a package to say which strut it
needs: on one without `git/remote-head`, `add` and `check` fail with a
sentence that names the missing step.

## A Code Change job

A job's `kind` names a page under strut's `Job`, and every turn of the
job opens with that page (strut's `job` workflow). Strut's orchestrator
lists the kinds by their descriptions and picks `Code Change` for a
request to change the code of one of the box's repositories; a question
about the code is not one. The page tells the job's agent, in the order
it acts:

1. **Find the repository** with `repositories`: its address, its default
   branch and its workspaces. With several and none named, it asks.
2. **Small or deeper.** One test: can a person tell whether the change is
   right from its diff alone? A colour, a size, a label or wording is
   small. Anything only running it can judge is deeper.
3. **A small change needs no pod and no tests** (the owner's rule, as
   Hive works): `git_checkout` into the job's directory, the edit, then
   `git_push` from the absolute path the checkout returned, to a new
   branch, as the person. Then a pull request, with the pull-request tool
   the box has for the repository's host (`github_create_pr`, which the
   `stadeum/github` package grants, for github.com). With none, the reply
   says the branch is pushed and where, and that the box has no tool to
   open the pull request. One that turns out deeper moves to a pod, and
   the reply says why.
4. **A deeper change goes on a pod** from `stadeum/pods`, claimed for the
   repository's workspace. The page doesn't restate how to work in a pod:
   it sends the agent to the pods package's `Pod` page, another kind
   under `Job`, which it opens by name (`graph_graph_get`, as every job
   turn's prompt says). The app and its tests run there, and the pod's
   `git` pushes and opens the pull request. A workspace never set up (a
   bare pod, no image) is set up on the way, as `Pod` says, its `.pod/`
   in a pull request of its own. Without the pods package, or when the
   claim fails, the change is made in the checkout, and the reply says
   plainly that nothing was run here.
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
type with every `/` and `-` made `_` (`git/push` is `git_push`,
`stadeum/code/repositories` is `stadeum_code_repositories`).

The page carries no claims or cases yet. Strut records the `claims:` of
its own pages at boot, not a package's at install, and a case for this
page would be a coding job, which a trial doesn't run.

**The push.** The package grants the job agent strut's own `git/push`
(`job: tools: [repositories, git/push]`), which needs a strut where a
package's `job:` may name strut's steps (stakwork/strut#800); an older
strut refuses the install. Strut's `git/push` holds its own lines for
every caller (stakwork/strut#802): it never pushes the remote's default
branch, cannot force, and pushes only a working copy `git/checkout` made
for the run or its job, by its absolute path. It pushes as the job's
person, with their own token for the repository's host. It does not ask
first (no `approve:`): the pull request opened on the branch is the
person's review, and a push waiting on their yes would end the turn
before the pull request could be opened. The pull-request step is a
forge's, granted by that forge's package; this one names none.

## Versions

- **0.6.1** `Code Change` §4 says what a pod is for:
  - A tool the build needs that the pod can run goes in the workspace's
    image (`.pod/`'s `Dockerfile`, then bake), not one job's shell.
  - An app a pod doesn't run (a phone app; a platform or an architecture
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
drives it as the Code app (an admin and a member), the schedule and the job
agent do. It launches a job of the kind `Code Change` and checks that the
turn opens with the page and holds `git_push`; the model is stood in for
(strut's `registerModelWrapper`), so no key is needed. For a small change
the stand-in is scripted (strut's mock model) along the page's path: it
lists the repositories, checks the private one out into the job's
directory, edits and stages it, is refused its default branch, and
pushes a new branch with the person's own token. The Code app's Add field
is read from a link as stadeum/github's picker makes it, for an admin, a
member and inputs that are not https addresses. A workspace's page is
written under `Codebase` as pods writes it at the bake: `repositories`
gives it to the app, a member and the job agent, never the bare-named
page, and removing the workspace's last repository deletes it. Uninstalling
drops the `Code Change` page and the grant; `Codebase` stays while a page
that is not the package's hangs under it (strut's rule).
It reaches github.com, adding public repositories. A private one is served
from the test's own machine over http behind a token, its https address
pointed there by git's `insteadOf` (strut's `test-util/git-remote.ts`), and
a stand-in forge package serves that host's token: added with the admin's
own token and refused without it, then checked as the `check` workflow's
owner, with a `problem` naming them when they have none. No real token is
read.

```bash
STRUT_DIR=../strut npm test
```

`STRUT_DIR` is a strut checkout with its install (`yarn install
--frozen-lockfile --ignore-scripts`, and the same in `kit/`).
`.github/workflows/checks.yml` runs it on every pull request and push to
`main`, against strut's `main`.

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
