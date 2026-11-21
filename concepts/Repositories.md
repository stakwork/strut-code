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
fields and the link are what it may rely on. Only `stadeum/code` writes
them.

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
workspace left with none is deleted. When a workspace's main repository
leaves it, the next one by name becomes its main.

To read a workspace's repositories, main first: find the `Workspace` by
`name` (`graph/find`), take its `INCLUDES` neighbours
(`graph/graph-neighbors`), and put the one whose `url` is its `main`
first. No `Workspace` of that name means the box has none: the package is
not installed, or nobody made it.
