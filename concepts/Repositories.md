---
name: Repositories
description: The box's workspaces and the repositories in them, kept by the stadeum/code package in the graph, and how another package reads them.
---
The box's workspaces, and the repositories in them, are graph nodes kept
by the `stadeum/code` package. People make and change workspaces in its
app, **Code**, picking repositories from what their own accounts reach,
or by address. A job agent reads them with the `repositories` tool
(`stadeum_code_repositories`) and makes one, or adds to one, with the
`workspace` tool (`stadeum_code_workspace`).

A repository is the box's while it is in a workspace. One taken out of
the last workspace it was in leaves the box. When the box has no
workspace, the `check` workflow makes the default one from what the
forges reach as its owner: every repository picked on GitHub, or the
five most recently pushed when an org granted all of its repositories,
named after their owner.

Every 15 minutes `check` asks each repository's remote for the head of
its default branch (as `git ls-remote <url> HEAD` does) and records a
head that moved. Then `ingest` takes each new head in. Today `ingest`
only records the commit.

A repository is reached by its https address, public or private. A
private one is read as a person, with their own token for its host: the
person who puts it in a workspace, then the `check` workflow's owner,
whom its schedule runs as. When that person has connected no account for
the host, or theirs cannot read the repository, its `problem` says so
and names them.

## The contract

Another package reads these nodes without requiring `stadeum/code`. These
fields, the link and a workspace's page are what it may rely on. Only
`stadeum/code` writes the nodes and the link. Another package keeps its
own things on a `Workspace` as files on the node (strut's files on a
node): they go with it when it is deleted.

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

A workspace has no main repository. What runs it is its own setup, kept
on the node by the package that runs workspaces, not any one
repository's. A node from 0.6 and before may still carry `main`: it
means nothing now, and `check` clears it.

A workspace renamed in the Code app stays the same node (its `ref_id`),
so what is kept on it stays. A reader that keeps a workspace's name
finds it by its `ref_id` after a rename.

### The link

`Workspace -[INCLUDES]-> Repository`, one edge for each repository in the
workspace. A workspace holds one repository at least, and a repository
is in one workspace at least: one taken out of its last leaves the box,
its node deleted. A repository can be in several workspaces. Deleting a
workspace deletes its page, and each of its repositories in no other.

To read a workspace's repositories: find the `Workspace` by `name`
(`graph/find`) and take its `INCLUDES` neighbours
(`graph/graph-neighbors`). No `Workspace` of that name means the box has
none: the package is not installed, or nobody made it.

### A workspace's page

A workspace that has been baked has a page: the Concept `<workspace>
workspace` (`hive workspace`), under `Codebase` and under `Pod`. The
`stadeum/pods` package writes it at the bake: a diagram of the
workspace's systems, each arrow a real connection labelled with the
setting that points it, then the system in words, then how to run it.
A workspace never baked has none, so a page is also how a reader tells a
baked workspace from one never set up.

It is a page, not a field on the `Workspace` node, which keeps only its
`name` and its `INCLUDES` links. A page carries claims, cases and tests,
and the history keeps each edit with the run that made it. It is not
named with the bare name, which is a repository's page.

To read it, open the Concept by that name (`graph_graph_get { node_type:
"Concept", name: "hive workspace" }`). The `repositories` tool gives a
workspace's `page` when it has one, and the Code app links to it in the
Knowledge app. Renaming a workspace renames its page.
