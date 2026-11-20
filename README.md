# strut-code

The `stadeum/code` package for [strut](https://github.com/stakwork/strut):
the repositories a box works on, the workspaces they are grouped in, and
the Code app where they are set up. It names no forge: any https git
remote works the same, and a GitLab or Forgejo package would use it whole.

This version reads public repositories only. A private one is refused, with
the reason, until strut finds a person's git credentials by a remote's host.

## What it ships

| Part | What |
| --- | --- |
| `graph/Repository.yaml`, `graph/Workspace.yaml` | The two graph types, and the `Workspace -[INCLUDES]-> Repository` link |
| `concepts/Repositories.md` | The `Repositories` page: the contract another package reads these nodes by (each field, the link, how to read a workspace main first) |
| `apps/code/` | **Code**, every person's app: the repositories by workspace, each with its branch and when it was last checked. For an admin it also adds a repository by its https address, removes one, puts one in one workspace or several, and names each workspace's main one |
| `workflows/add.yaml` | The admin's Add: `add`, then `ingest` once |
| `workflows/check.yaml` | Every 15 minutes (`schedules:` in `strut.yaml`): `heads`, then `ingest` on each repository whose head is not ingested |
| `workflows/ingest.yaml` | Takes a repository in at its head. Today it only records the commit: a parser plugs in here, before `record` |
| `steps/repositories.ts` | The job agent's tool (`job: tools:`) and the app's read: every repository and workspace the box holds |
| `steps/add.ts`, `remove.ts`, `place.ts`, `main.ts` | The admin's changes, each refused to anyone else |
| `steps/heads.ts` | `check`'s pass: `git ls-remote --symref <url> HEAD` on each remote, four at a time |
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
- **An address is checked before it is stored, and reaches git as one
  argument.** Only `https://<host>/<owner…>/<name>`, with no credentials,
  query or `#`, each part letters, digits, `.`, `_` and `-`. It is written
  one way (lowercase host, no trailing slash or `.git`), so the same
  repository added twice is one node. Git runs through strut's shell, which
  starts no shell: no credential helper, no prompt, none of the server's git
  configuration.
- **A repository is always in a workspace.** A new one gets its own, named
  after it (then after its owner and name, then numbered, when the name is
  taken). Removing a repository takes it out of every workspace; a
  workspace left empty goes, and one whose main left takes its next
  repository as main.

It requires no secret, and `git` on the server.

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
agent do. It reaches github.com, adding public repositories.

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
