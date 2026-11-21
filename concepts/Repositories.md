---
name: Repositories
description: The box's repositories and the workspaces they are grouped in, kept by the stadeum/code package in the graph, and how another package reads them.
---
The repositories this box works on, and the workspaces they are grouped
in, are graph nodes kept by the `stadeum/code` package. People see and
change them in its app, **Code**. A job agent reads them with the
`repositories` tool (`stadeum_code_repositories`).

Every 15 minutes the package's `check` workflow asks each repository's
remote for the head of its default branch (as `git ls-remote <url> HEAD`
does) and records a head that moved. Then `ingest` takes each new head
in. Today `ingest` only records the commit.

A repository is reached by its https address, public or private. A
private one is read as a person, with their own token for its host: the
admin who adds it, then the `check` workflow's owner, whom its schedule
runs as. When that person has connected no account for the host, or theirs
cannot read the repository, its `problem` says so and names them.

## The contract

Another package reads these nodes without requiring `stadeum/code`. These
fields, the link and a workspace's page are what it may rely on. Only
`stadeum/code` writes the nodes and the link.

### `Repository`

Keyed by `url`.

| Field | Holds |
| --- | --- |
| `url` | The repository's address: `https://<host>/<owner…>/<name>`, lowercase host, with no credentials, query, trailing slash or `.git`. The same repository added twice is one node. |
| `name` | The last part of its address. |
| `branch` | The remote's default branch: where its `HEAD` points. |
| `head` | The commit at the head of that branch when it was last checked, as a full hex id. |
| `checked` | When its remote was last asked, ISO 8601 in UTC. |
| `ingested` | The commit `ingest` last took in. Absent until it ran once. A `head` that differs is waiting for `ingest`. |
| `problem` | Why its last check failed, in a sentence. Absent when it passed. |

### `Workspace`

Keyed by `name`.

| Field | Holds |
| --- | --- |
| `name` | Lowercase letters, digits, `.`, `_` and `-`, at most 63, starting with a letter or a digit: what a pod is claimed for. |
| `main` | The `url` of its main repository, always one of its own. |

### The link

`Workspace -[INCLUDES]-> Repository`, one edge for each repository in the
workspace. A repository can be in several workspaces, and is always in
one at least. A repository added to the list gets a workspace of its own,
named after it (or after its owner and its name, when that name is
taken). Removing a repository takes it out of every workspace, and a
workspace left with none is deleted, its page with it. When a workspace's
main repository leaves it, the next one by name becomes its main.

To read a workspace's repositories, main first: find the `Workspace` by
`name` (`graph/find`), take its `INCLUDES` neighbours
(`graph/graph-neighbors`), and put the one whose `url` is its `main`
first. No `Workspace` of that name means the box has none: the package is
not installed, or nobody made it.

### A workspace's page

A workspace that has been baked has a page: the Concept `<workspace>
workspace` (`hive workspace`), under `Codebase` and under `Pod`. The
`stadeum/pods` package writes it at the bake: a diagram of the
workspace's systems, each arrow a real connection labelled with the
setting that points it, then the system in words, then how to run it.
A workspace never baked has none.

It is a page, not a field on the `Workspace` node, which keeps only its
`name`, its `main` and its `INCLUDES` links. A page carries claims, cases
and tests, and the history keeps each edit with the run that made it.
It is not named with the bare name: a workspace is named after its main
repository by default, and the bare name is that repository's page.

To read it, open the Concept by that name (`graph_graph_get { node_type:
"Concept", name: "hive workspace" }`). The `repositories` tool gives a
workspace's `page` when it has one, and the Code app links to it in the
Knowledge app.
