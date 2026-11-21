# strut-code

The `stadeum/code` package for [strut](https://github.com/stakwork/strut):
the repositories a box works on, the workspaces they are grouped in, and
the Code app where they are set up, and the `Code Change` page, which a job
that changes one of them follows. It names no forge: any https git remote
works the same, and a GitLab or Forgejo package would use it whole.

A private repository is read as a person, with their own token for its
host: the admin who adds it, and for the scheduled `check` the `check`
workflow's owner. Strut picks the token by the address's host and hands it
to git for that host alone; the package never sees it, and names no forge,
host or secret.

## What it ships

| Part | What |
| --- | --- |
| `graph/Repository.yaml`, `graph/Workspace.yaml` | The two graph types, and the `Workspace -[INCLUDES]-> Repository` link |
| `concepts/Repositories.md` | The `Repositories` page: the contract another package reads these nodes by (each field, the link, how to read a workspace main first) |
| `concepts/Code Change.md` | The `Code Change` page, a kind of job under strut's `Job`: how a change to one of the box's repositories is made and how it ends (below) |
| `apps/code/` | **Code**, every person's app: the repositories by workspace, each with its branch and when it was last checked. For an admin it also adds a repository by its https address, removes one, puts one in one workspace or several, and names each workspace's main one |
| `workflows/add.yaml` | The admin's Add: `add`, then `ingest` once |
| `workflows/check.yaml` | Every 15 minutes (`schedules:` in `strut.yaml`): `heads`, then `ingest` on each repository whose head is not ingested |
| `workflows/ingest.yaml` | Takes a repository in at its head. Today it only records the commit: a parser plugs in here, before `record` |
| `steps/repositories.ts` | The job agent's tool (`job: tools:`) and the app's read: every repository and workspace the box holds |
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
- **A repository is always in a workspace.** A new one gets its own, named
  after it (then after its owner and name, then numbered, when the name is
  taken). Removing a repository takes it out of every workspace; a
  workspace left empty goes, and one whose main left takes its next
  repository as main.

It requires no secret of its own, and a strut with the `git/remote-head`
step (stakwork/strut#798, 2026-11-20). Strut has no way yet for a package
to say which strut it needs: on an older one, `add` and `check` fail with a
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
   Hive works): strut's `git/checkout` into the job's directory, the
   edit, then a new branch pushed as the person (`git/push`) and a pull
   request (`github/create-pr`). One that turns out deeper moves to a pod,
   and the reply says why.
4. **A deeper change goes on a pod** from `stadeum/pods`, claimed for the
   repository's workspace. The page doesn't restate how to work in a pod:
   it sends the agent to the pods package's `Pod` page, another kind
   under `Job`, which it opens by name (`graph_graph_get`, as every job
   turn's prompt says). The app and its tests run there, and the pod's
   `git` pushes and opens the pull request. A workspace never set up (a
   bare pod, no image) is set up on the way, as `Pod` says, its `.pod/`
   in a pull request of its own. Without the pods package, or when the
   claim fails, the change is made in the checkout, and the reply says
   plainly that nothing was run.
5. **It ends in a pull request as the person**, on a new branch, never a
   push to the default branch; a later turn's change lands in the same
   pull request. When it can't be opened (the person's account for that
   host isn't connected to the box, or can't push there), the reply says
   so in plain words and hands over the diff.

The page carries no claims or cases yet. Strut records the `claims:` of
its own pages at boot, not a package's at install, and a case for this
page would be a coding job, which a trial doesn't run.

**What it needs from strut.** On strut's `main` the job agent is granted
`git/checkout` but not `git/push` or `github/create-pr`, and a package's
`job:` grants only its own steps. Until strut grants those two, a small
change ends with its diff handed over instead of a pull request. A
deeper change on a pod is not affected: the pod's `git` opens it.

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
turn opens with the page; the model is stood in for (strut's
`registerModelWrapper`), so no key is needed. Uninstalling drops the page.
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
