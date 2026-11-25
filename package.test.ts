/**
 * stadeum/code on a strut server, the way it runs on a box: installed from
 * this directory (`file:`) into a strut started in this process from a
 * checkout of stakwork/strut (`STRUT_DIR`, default `../strut`, with its
 * install), on a LadybugDB file. Then driven as the Code app's page drives
 * it (a person making and changing workspaces, an admin's call from another
 * app), as the schedule runs `check`, and as the job agent calls
 * `repositories` and `workspace`. A job of the kind `Code Change` is
 * launched too, to see its turn open with the package's page: the model is
 * stood in for through strut's hook on every model it builds, recording
 * what each turn gave it. For a small change it is scripted (strut's own
 * mock model): it checks the repository out, edits it, pushes a new branch
 * with strut's `git/push` as the job's person, is refused the default
 * branch, and opens the pull request with strut's `git/pull-request`.
 *
 * It needs a strut with the package seams of stakwork/strut#851:
 * `git/repositories`, `git/pull-request` and their `provides.git` fields.
 *
 * It reaches github.com: the public repositories it adds are this package's
 * own and stadeum/pods', and a missing one is refused as a private one is,
 * which GitHub answers the same way with no token. A PRIVATE repository is
 * served from this machine over http behind a token (strut's
 * `test-util/git-remote.ts`), and its https address is pointed there by
 * git's `insteadOf` in the shell strut is given: the token lookup and git's
 * credential helper both see the same host, `127.0.0.1:<port>`. Another
 * package stands in for a forge's, serving that host with `LAB_TOKEN`
 * (`provides.git`), with the steps that say what a person's token reaches
 * and open a pull request; each person's token is their own secret. No
 * one's real token is read: GITHUB_TOKEN is unset here.
 *
 *   STRUT_DIR=../strut npm test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { address, askRemote, defaultWorkspace, noteOf, reach, recentItems, refusal, remoteProblem, workspaceName, type Reach } from "./steps/_code.ts";
import { addressToAdd } from "./apps/code/src/input.ts";
import { chatAbout, lookForChat } from "./apps/code/src/chat.ts";
import { foldersOn, ordered, readFolder, shown } from "./apps/code/src/files.ts";

const STRUT = resolve(process.env["STRUT_DIR"] ?? "../strut");
// Nobody's token: not this machine's, not its git's. github.com is read with none.
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "LAB_TOKEN", "STRUT_GIT_LOCAL"]) delete process.env[k];
const from = async <T>(path: string): Promise<T> => (await import(pathToFileURL(join(STRUT, "src", path)).href)) as T;

const HERE = resolve(".");
const CODE = "https://github.com/stakwork/strut-code";
const PODS = "https://github.com/stakwork/strut-pods";
const MISSING = "https://github.com/stakwork/strut-code-no-such-repository-7f3a";
const APP = "stadeum/code/code";
const HEX = /^[0-9a-f]{40}$/;
const PAGE = "Code Change";

/** Another package, whose app a person may open, granting this package's
 *  steps: it must change nothing. It also stands in for a forge's package,
 *  serving the private repositories' host: what a person's token reaches
 *  there, and a pull request opened there. */
const OTHER_APP = "acme/other/console";
const OTHER: Record<string, string> = {
  "apps/console/app.yaml": [
    "title: Console",
    "grants:",
    "  steps: [stadeum/code/repositories, stadeum/code/workspace, stadeum/code/default-workspace, stadeum/code/rename, stadeum/code/delete]",
    "",
  ].join("\n"),
  "apps/console/src/App.tsx": "export default function App() { return <p>console</p>; }\n",
};

/** The private repositories' token, and one their host refuses. */
const TOKEN = `lab-${randomBytes(12).toString("hex")}`;
const WRONG = `wrong-${randomBytes(12).toString("hex")}`;

/** git on this machine with none of its own config: for the test's remotes. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    },
  }).trim();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("an address, a name and the default workspace", () => {
  it("is written one way, so the same repository typed twice is one address", () => {
    for (const typed of [CODE, `${CODE}/`, `${CODE}.git`, `${CODE}.git/`, "  HTTPS://GitHub.com/stakwork/strut-code  ", "https://github.com//stakwork/strut-code"]) {
      assert.equal(address(typed).url, CODE, typed);
    }
    assert.deepEqual(address("https://gitlab.example.com:8443/group/sub/app.git"), {
      url: "https://gitlab.example.com:8443/group/sub/app",
      host: "gitlab.example.com:8443",
      owner: "group/sub",
      name: "app",
    });
  });

  it("is refused before anything runs when it is not an https address of a repository", () => {
    const refused: Array<[string, RegExp]> = [
      ["", /its https URL/],
      ["git@github.com:stakwork/strut-code.git", /an ssh address/],
      ["ssh://git@github.com/stakwork/strut-code", /an ssh address/],
      ["http://github.com/stakwork/strut-code", /only an https address/],
      ["file:///etc/passwd", /only an https address/],
      ["--upload-pack=touch /tmp/x", /not an address/],
      ["https://user:token@github.com/stakwork/strut-code", /no user name or token/],
      ["https://github.com/stakwork/strut-code?x=1", /no \? or # part/],
      ["https://github.com/stakwork", /owner and its name/],
      ["https://github.com/stakwork/strut code", /is not a part/],
      ["https://github.com/stakwork/$(touch x)", /is not a part/],
      ["https://github.com/stakwork/..", /owner and its name|is not a part/],
      ["https://github.com/-x/strut-code", /is not a part/],
      [`https://github.com/${"a".repeat(300)}/b`, /over 300/],
    ];
    for (const [typed, why] of refused) assert.throws(() => address(typed), why, typed);
  });

  it("takes a workspace's name in lowercase, and refuses one that is not a name", () => {
    assert.equal(workspaceName(" Hive "), "hive");
    assert.throws(() => workspaceName("my workspace"), /not a workspace's name/);
    assert.throws(() => workspaceName("-x"), /not a workspace's name/);
    assert.throws(() => workspaceName("x".repeat(64)), /not a workspace's name/);
  });

  it("makes the default of every repository picked, or the five most recently pushed, named after their owner", () => {
    const r = (owner: string, name: string, pushed: string, picked?: true): Reach => ({ url: `https://github.com/${owner}/${name}`, name, pushed, ...(picked ? { picked } : {}) });
    // Picked on GitHub: every one, whatever another org granted whole.
    const picked = [r("Stakwork", "hive", "2026-11-01", true), r("stakwork", "stakgraph", "2026-10-01", true), r("acme", "app", "2026-11-20", true), r("other", "x", "2026-11-22")];
    assert.deepEqual(defaultWorkspace(picked), { name: "stakwork", repositories: ["https://github.com/Stakwork/hive", "https://github.com/acme/app", "https://github.com/stakwork/stakgraph"].sort() });
    // An org that granted all of them: the five most recently pushed.
    const all = ["a", "b", "c", "d", "e", "f", "g"].map((n, i) => r("stakwork", n, `2026-11-${String(10 + i).padStart(2, "0")}T00:00:00Z`));
    assert.deepEqual(defaultWorkspace(all)?.repositories, ["c", "d", "e", "f", "g"].map((n) => `https://github.com/stakwork/${n}`));
    assert.equal(defaultWorkspace(all)?.name, "stakwork");
    // A forge that says nothing of when: the first five, by name.
    assert.equal(defaultWorkspace(all.map(({ pushed: _p, ...x }) => x))?.repositories.length, 5);
    // An owner's name made a workspace's: lowercase, what a name takes.
    assert.equal(defaultWorkspace([r("Acme_Corp", "x", "2026-11-01")])?.name, "acme_corp");
    // A forge with groups: the group the repositories are in.
    assert.equal(defaultWorkspace([{ url: "https://gitlab.example.com/acme/platform/x", name: "x" }])?.name, "platform");
    assert.equal(defaultWorkspace([]), undefined);
  });

  it("lets anyone make workspaces, from the Code app or as the job's person, and never from another app or a call that is nobody's", () => {
    const code = { name: APP, version: "1" };
    assert.equal(refusal({ app: code, actor: "ada" }), undefined, "a person in the Code app");
    assert.equal(refusal({ app: { ...code, admin: true }, actor: "root" }), undefined, "an admin too");
    assert.equal(refusal({ actor: "ada", principal: "ada" }), undefined, "the job agent, as its person");
    assert.match(refusal({ app: { name: OTHER_APP }, actor: "ada" }) ?? "", /made and changed in the Code app \(stadeum\/code\/code\), not from acme\/other\/console/);
    assert.match(refusal({ app: { name: APP, version: "preview-3" }, actor: "ada" }) ?? "", /not from a preview of it/);
    assert.match(refusal({}) ?? "", /made as a person/);
  });

  it("says from strut's error what a person can act on, and whose access is missing", () => {
    const url = "https://git.example.test/team/app";
    const denied = `remote_denied: ${url} asks for a credential — it is private, or there is no repository there — and this run has no token for its host`;
    assert.equal(
      remoteProblem(url, denied, { you: true }),
      `${url} asks for a sign-in: it is private, or there is no repository there, and you have no access to it: you have not connected an account for git.example.test, or that account cannot read it. Connect one that can, then try again.`,
    );
    assert.equal(
      remoteProblem(url, `remote_denied: ${url} refused the run's token for git.example.test: it cannot read this repository, or there is none there`, { who: "Ada (ada)", scheduled: true }),
      `${url} asks for a sign-in: it is private, or there is no repository there, and Ada (ada), whom the check runs as (its workflow's owner), has no access to it: Ada (ada) has not connected an account for git.example.test, or that account cannot read it. Either Ada (ada) connects one that can, or an admin gives the check workflow an owner whose account can.`,
    );
    assert.match(remoteProblem(url, denied, { who: "ada" }), /and ada has no access to it: ada has not connected an account for git\.example\.test, or that account cannot read it\.$/);
    assert.equal(remoteProblem(url, `remote_not_found: no repository at ${url}`, { you: true }), `there is no repository at ${url} that you can see`);
    assert.equal(remoteProblem(url, `remote_not_found: no repository at ${url}`, { who: "ada", scheduled: true }), `there is no repository at ${url} that ada, whom the check runs as (its workflow's owner), can see`);
    assert.equal(remoteProblem(url, `remote_unreachable: ${url} did not answer in 30 s`), `${url} can't be reached: did not answer in 30 s`);
    assert.equal(remoteProblem(url, `remote_empty: ${url} has no commits yet: its remote names no head`), `${url} has no commits yet: its remote names no head`);
  });

  it("opens New workspace with the address the Code app is opened with, for a person who may make one, and makes nothing", async () => {
    const { appLink } = (await import(pathToFileURL(join(STRUT, "kit", "src", "links.ts")).href)) as { appLink: (name: string, input?: Record<string, string>) => string };
    const opened = (input: Record<string, string>) => Object.fromEntries(new URLSearchParams(new URLSearchParams(appLink(APP, input).slice(1)).get("input") ?? ""));
    assert.equal(addressToAdd(opened({ add: CODE }), true), CODE);
    assert.equal(addressToAdd({ add: `  ${CODE}.git\n` }, true), `${CODE}.git`, "trimmed, otherwise as given");
    assert.equal(addressToAdd(opened({ add: CODE }), false), undefined, "a viewer who may not make one");
    for (const input of [undefined, {}, { view: CODE }, { add: "" }, { add: 42 }, { add: [CODE] }, { add: "strut-code" }, { add: "git@github.com:stakwork/strut-code.git" }, { add: "http://github.com/stakwork/strut-code" }, { add: "javascript:alert(1)" }]) {
      assert.equal(addressToAdd(input, true), undefined, JSON.stringify(input));
    }
  });

  it("says plainly what an older strut lacks: the steps it asks a remote and the forges with", async () => {
    await assert.rejects(askRemote({ registry: {} }, CODE), /strut's git\/remote-head step, and this strut server has none: it needs a newer strut \(the step came with stakwork\/strut#798/);
    assert.deepEqual(await reach({ registry: {} }), {
      repositories: [],
      hosts: [],
      problem: "this strut lists no forge's repositories: that needs strut's git/repositories step (stakwork/strut#851). A repository can still be added by its address",
    });
  });

  it("keeps Set up's additional information as the person wrote it, trimmed, and none when they wrote nothing", () => {
    assert.equal(noteOf("  the UI is strut;\r\npeel is for reference\n"), "the UI is strut;\npeel is for reference");
    for (const none of [undefined, null, "", "  \n "]) assert.equal(noteOf(none), undefined, JSON.stringify(none));
    assert.equal(noteOf("x".repeat(4000)), "x".repeat(4000));
    assert.throws(() => noteOf("x".repeat(4001)), /4001 characters: at most 4000 go on a workspace/);
    assert.throws(() => noteOf(42), /a workspace's note is text/);
  });

  it("lists the workspaces for strut's Recent Work: the ones the person chatted about first, newest day first, then by name", () => {
    const list = {
      repositories: [],
      workspaces: [
        { ref_id: "w1", name: "alpha", repositories: ["https://github.com/a/one", "https://gitlab.example.com:8443/g/sub/two"] },
        { ref_id: "w2", name: "beta", repositories: ["https://github.com/a/three"] },
        { ref_id: "w3", name: "gamma", repositories: ["https://github.com/a/four"] },
        { ref_id: "w4", name: "delta", repositories: [] },
      ],
    };
    const chats = [
      { about: "w3", updatedAt: "2026-11-20T09:00:00.000Z" },
      { about: "w3", updatedAt: "2026-11-25T09:00:00.000Z" },
      // The same day: by name, so a later chat that day changes nothing strut shows.
      { about: "w2", updatedAt: "2026-11-24T23:00:00.000Z" },
      { about: "w1", updatedAt: "2026-11-24T01:00:00.000Z" },
      // About no workspace here, about nothing, or with no time: not one of these.
      { about: "elsewhere", updatedAt: "2026-11-26T00:00:00.000Z" },
      { updatedAt: "2026-11-26T00:00:00.000Z" },
      { about: "w4" },
    ];
    assert.deepEqual(recentItems(list, chats), [
      { name: "gamma", what: "you chatted about it; github.com/a/four", at: "2026-11-25T09:00:00.000Z" },
      { name: "alpha", what: "you chatted about it; github.com/a/one, gitlab.example.com:8443/g/sub/two", at: "2026-11-24T01:00:00.000Z" },
      { name: "beta", what: "you chatted about it; github.com/a/three", at: "2026-11-24T23:00:00.000Z" },
      { name: "delta", what: "on this server" },
    ]);
    // No chats (a run that is nobody's, a strut that can't say): every one, by name.
    assert.deepEqual(recentItems(list, []).map((i) => i.name), ["alpha", "beta", "delta", "gamma"]);
  });

  it("finds the viewer's chat about a workspace by its node, and none on a strut that doesn't know about", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const answering = (out: unknown) => async (type: string, config: Record<string, unknown>) => {
      assert.equal(type, "conversation/list");
      asked.push(config);
      if (out instanceof Error) throw out;
      return out;
    };
    const ws = "ref-ws";
    assert.deepEqual(await chatAbout(answering({ conversations: [{ id: "ada/1", title: "Set up team", about: ws }] }), ws), { session: "ada/1", title: "Set up team" });
    assert.deepEqual(asked.at(-1), { about: ws, limit: 1 }, "the newest about it");
    assert.deepEqual(await chatAbout(answering({ conversations: [] }), ws), { none: true });
    // A strut that ignores `about` answers every chat of the viewer's: none is about it.
    assert.deepEqual(await chatAbout(answering({ conversations: [{ id: "ada/2", title: "Lunch" }, { id: "ada/3", about: "another" }] }), ws), { none: true });
    // One that refuses a package's page, or answers nothing like a list: it can't say.
    const refused = await chatAbout(answering(new Error("conversation/* steps are not available to an app's page")), ws);
    assert.match("unsupported" in refused ? refused.unsupported : "", /not available to an app's page/);
    assert.ok("unsupported" in (await chatAbout(answering("nope"), ws)));
  });

  it("looks for the chat for a few seconds after Set up, and stops at once when strut can't say", async () => {
    let t = 0;
    const clock = { wait: async (ms: number) => void (t += ms), now: () => t };
    let calls = 0;
    const late = async () => (++calls < 4 ? { conversations: [] } : { conversations: [{ id: "ada/9", about: "ws" }] });
    assert.deepEqual(await lookForChat(late, "ws", { within: 12_000, every: 1_000, ...clock }), { session: "ada/9" });
    assert.equal(calls, 4, "found on the fourth look");
    t = 0;
    calls = 0;
    const never = async () => (calls++, { conversations: [] });
    assert.deepEqual(await lookForChat(never, "ws", { within: 12_000, every: 1_000, ...clock }), { none: true });
    assert.equal(calls, 13, "every second for twelve");
    calls = 0;
    const refused = async () => {
      calls++;
      throw new Error("refused");
    };
    assert.ok("unsupported" in (await lookForChat(refused, "ws", clock)));
    assert.equal(calls, 1);
  });

  it("reads the files packages keep on a workspace's node, each folder's versions with files, newest first, and none on a strut that can't say", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const answering = (out: unknown) => async (type: string, config: Record<string, unknown>) => {
      assert.equal(type, "node/files");
      asked.push(config);
      if (out instanceof Error) throw out;
      return out;
    };
    const v = (pkg: string, version: number, paths: string[], note?: string) => ({ package: pkg, version, at: `2026-11-2${version}T00:00:00.000Z`, bytes: paths.length * 10, paths, ...(note ? { note } : {}) });
    const listed = { versions: [v("stadeum/pods", 3, ["Dockerfile", "setup.sh"], "baked"), v("stadeum/pods", 1, ["Dockerfile"]), v("stadeum/pods", 2, []), v("acme/gone", 2, []), v("acme/gone", 1, ["x"]), v("acme/docs", 1, ["README.md"])] };
    assert.deepEqual(await foldersOn(answering(listed), "ws"), {
      folders: [
        { package: "acme/docs", versions: [{ version: 1, at: "2026-11-21T00:00:00.000Z", bytes: 10, paths: ["README.md"] }] },
        {
          package: "stadeum/pods",
          versions: [
            { version: 3, at: "2026-11-23T00:00:00.000Z", bytes: 20, paths: ["Dockerfile", "setup.sh"], note: "baked" },
            { version: 1, at: "2026-11-21T00:00:00.000Z", bytes: 10, paths: ["Dockerfile"] },
          ],
        },
      ],
    }, "by package; an empty version left out, and a folder whose newest is empty keeps nothing now");
    assert.deepEqual(asked.at(-1), { ref_id: "ws", list: true });
    assert.deepEqual(await foldersOn(answering({ versions: [] }), "ws"), { folders: [] });
    // A strut without the seam, or one that refuses the page: it can't say.
    const refused = await foldersOn(answering(new Error("node/files is not granted to stadeum/code/code")), "ws");
    assert.match("unsupported" in refused ? refused.unsupported : "", /not granted/);
    assert.ok("unsupported" in (await foldersOn(answering({ package: "strut", version: null, files: {} }), "ws")));

    const files = { Dockerfile: "FROM node:22\n", "bin/logo.png": { base64: "iVBORw==" } };
    assert.deepEqual(await readFolder(answering({ package: "stadeum/pods", version: 3, at: "t", note: "baked", files }), "ws", "stadeum/pods"), { package: "stadeum/pods", version: 3, at: "t", note: "baked", files });
    assert.deepEqual(asked.at(-1), { ref_id: "ws", package: "stadeum/pods" }, "the newest");
    await readFolder(answering({ package: "stadeum/pods", version: 1, at: "t", files: {} }), "ws", "stadeum/pods", 1);
    assert.deepEqual(asked.at(-1), { ref_id: "ws", package: "stadeum/pods", version: 1 });
    await assert.rejects(readFolder(answering({ package: "stadeum/pods", version: null, files: {} }), "ws", "stadeum/pods"), /stadeum\/pods keeps no files on it/);
    await assert.rejects(readFolder(answering(new Error("node_not_found: x")), "ws", "stadeum/pods"), /node_not_found/);

    assert.deepEqual(shown("FROM node:22\n"), { text: "FROM node:22\n" });
    assert.deepEqual(shown({ base64: "iVBORw==" }), { bytes: 4 });
    assert.deepEqual(shown({ base64: "iVBORw0K" }), { bytes: 6 });
    assert.deepEqual(ordered(["scripts/z.sh", "setup.sh", "Dockerfile", "a/b/c", "docker-compose.yml"]), ["docker-compose.yml", "Dockerfile", "setup.sh", "scripts/z.sh", "a/b/c"]);
  });
});

describe("stadeum/code on strut", { timeout: 300_000 }, () => {
  let root = "";
  // Strut's own types, loose: this test reads them from a checkout.
  let strut: any;
  let tools: any;
  let appIdentity: (name: string, version: string) => string;
  let STEP_RUN: string;
  const versions: Record<string, string> = {};
  let store: any;
  /** What the job agent's model was handed on each turn: the system prompt,
   *  the turn's prompt and its tools' names. */
  const turns: Array<{ prompt: string; system: string; tools: string[] }> = [];
  /** The model's answers for the next job's run, when it is scripted
   *  (strut's mock model); otherwise the turn ends once it is recorded. */
  let script: unknown[] | undefined;

  /** A call from an app's page (the Code app's unless named), as its viewer: `admin` when strut says so. */
  const page = (actor: string, admin = false, app = APP) => {
    const t = tools.buildAppTools({ apps: strut.apps, registry: strut.getRegistry(), services: strut.services, actor, admin, runStepDeps: { store, workspace: strut.workspace } });
    return async (type: string, config: Record<string, unknown> = {}): Promise<{ error?: string; result?: any }> =>
      t[STEP_RUN].execute({ type, config, app: appIdentity(app, versions[app]!) }, { toolCallId: "t", messages: [] });
  };
  const ada = () => page("ada");
  /** Another person's call from the Code app. */
  const member = (type: string, config: Record<string, unknown> = {}) => page("bob")(type, config);
  /** The Code app's New workspace, or a change to one, as `who`: its answer or why not. */
  const make = async (who: ReturnType<typeof page>, config: Record<string, unknown>) => who("stadeum/code/workspace", config);
  const made = async (who: ReturnType<typeof page>, config: Record<string, unknown>) => {
    const r = await make(who, config);
    assert.equal(r.error, undefined, r.error);
    return r.result;
  };
  const list = async (reachable = false) => {
    const r = await ada()("stadeum/code/repositories", { reachable });
    assert.equal(r.error, undefined, r.error);
    return r.result as { repositories: any[]; workspaces: any[]; reachable?: any[]; hosts?: any[]; may: boolean };
  };
  /** One step as a workflow of its own runs it: no page, no app, as `actor`. */
  const run = async (name: string, step: string, config: Record<string, unknown>, actor?: string) => {
    await strut.workspace.publishWorkflowByContent(`test/${name}`, `steps:\n  - id: s\n    type: ${step}\n    config: ${JSON.stringify(config)}\n`);
    return strut.run(`test/${name}`, {}, actor ? { actor, principal: actor } : {});
  };
  const once = async (name: string, step: string, config: Record<string, unknown>, actor = "root") => {
    const r = await run(name, step, config, actor);
    assert.equal(r.status, "success", JSON.stringify(r.error));
    return r.output.s ?? r.output;
  };
  /** A page's text as its file holds it, front matter left out. */
  const pageText = async (name = PAGE) => (await readFile(join(HERE, "concepts", `${name}.md`), "utf8")).replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const repo = async (url: string) => (await list()).repositories.find((r) => r.url === url);
  /** A workspace as the list gives it, its node's ref_id checked and left out. */
  const space = async (name: string) => {
    const found = (await list()).workspaces.find((w) => w.name === name);
    if (!found) return undefined;
    const { ref_id, ...w } = found;
    assert.equal(ref_id, await refOf("Workspace", { name }), "the workspace's own node");
    return w;
  };
  /** The runs `on: created: Workspace` started for a workspace's node,
   *  once each is over: the stand-in setup's, as the person who wrote it. */
  const setups = async (ref: string, want = 1) => {
    for (let i = 0; i < 400; i++) {
      const seen = [];
      for (const id of await store.listRuns("acme/other/setup")) {
        const s = await store.getRunSummary("acme/other/setup", id);
        if (s?.input?.ref_id === ref && s.status !== "waiting" && s.status !== "running") seen.push(s);
      }
      if (seen.length >= want) return seen;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no setup ran for ${ref}`);
  };
  /** A node's ref_id by type and key, or none. */
  const refOf = async (type: string, where: Record<string, string>) => (await once(`ref-${randomBytes(4).toString("hex")}`, "graph/find", { node_type: type, where })).nodes[0]?.ref_id as string | undefined;
  /** A Concept page by name, or why there is none. */
  const concept = (name: string) => once(`concept-${randomBytes(4).toString("hex")}`, "graph/graph-get", { node_type: "Concept", name });
  /** A page under `Codebase`, as stadeum/pods writes a workspace's at the
   *  bake (and the dream, later, a repository's). Its ref_id. */
  const bake = async (name: string) => {
    const made = await once(`bake-${randomBytes(4).toString("hex")}`, "graph/create-node", {
      node_type: "Concept",
      node_data: { name, description: `The ${name}: its systems and how they connect.`, docs: "```mermaid\nflowchart LR\n  app -->|API_URL| api\n```\n" },
    });
    const root = await concept("Codebase");
    await once(`bake-under-${randomBytes(4).toString("hex")}`, "graph/create-triplet", { source_ref_id: root.ref_id, target_ref_id: made.ref_id, edge_type: "PARENT_OF" });
    return made.ref_id as string;
  };

  /** The private repositories: bare ones served behind TOKEN, their https
   *  addresses, and a working copy that pushes a new commit to them. */
  let priv: { url: string; host: string; seen: Array<{ path: string; password?: string }>; close(): Promise<void> };
  let SECRET = "";
  let OTHER_SECRET = "";
  let work = "";
  const pushCommit = (message: string) => {
    git(work, "commit", "--quiet", "--allow-empty", "-m", message);
    for (const name of ["secret", "other"]) git(work, "push", "--quiet", join(root, "remotes", "team", name), "trunk");
    return git(work, "rev-parse", "HEAD");
  };
  /** A person's own secret, as the connect seam writes it. */
  const ownSecret = async (actor: string, name: string, value: string) => {
    const res = await strut.app.request(`/actors/${actor}/secrets/${name}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
    assert.equal(res.status < 300, true, await res.text());
  };
  const dropSecret = async (actor: string, name: string) => {
    await strut.app.request(`/actors/${actor}/secrets/${name}`, { method: "DELETE" });
  };
  /** The check workflow's owner: whom its schedule runs as. */
  const giveCheckTo = async (owner: string) => {
    const res = await strut.app.request(`/workflows/${encodeURIComponent("stadeum/code/check")}/owner`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }) });
    assert.equal(res.status, 200, await res.text());
  };
  /** "Run now" on check's schedule: the scheduler's own fire, as the
   *  workflow's owner. Then its run's summary, once it is over. */
  const fireCheck = async () => {
    const { automations } = await (await strut.app.request("/automations")).json();
    const schedule = automations.find((a: any) => a.package === "stadeum/code");
    const res = await strut.app.request(`/workflows/${encodeURIComponent("stadeum/code/check")}/automations/${encodeURIComponent(schedule.id)}/fire`, { method: "POST" });
    const body = await res.json();
    assert.equal(res.status, 202, JSON.stringify(body));
    const runId = body.runId ?? body.result?.runId;
    for (let i = 0; i < 1200; i++) {
      const summary = await store.getRunSummary("stadeum/code/check", runId);
      if (summary && summary.status !== "waiting") return summary;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`check's run ${runId} did not end`);
  };

  before(async () => {
    delete process.env["STRUT_API_KEY"];
    root = await mkdtemp(join(tmpdir(), "strut-code-test-"));
    // Two private repositories on this machine, on `trunk`, behind TOKEN.
    const { serveGit, insteadOf } = await from<any>("test-util/git-remote.ts");
    await mkdir(join(root, "remotes", "team"), { recursive: true });
    for (const name of ["secret", "other"]) git(join(root, "remotes"), "init", "--quiet", "--bare", "--initial-branch=trunk", join("team", name));
    work = join(root, "work");
    git(root, "init", "--quiet", "--initial-branch=trunk", work);
    pushCommit("first");
    priv = await serveGit(join(root, "remotes"), { token: TOKEN });
    SECRET = `https://${priv.host}/team/secret`;
    OTHER_SECRET = `https://${priv.host}/team/other`;
    store = new (await from<any>("store.ts")).MemoryRunStore();
    const { createStrut } = await from<any>("createStrut.ts");
    const { openGraphBackend } = await from<any>("graph/backend.ts");
    const { PRIVATE_NAMESPACE } = await from<any>("graph/ladybug/namespaces.ts");
    const { GraphWorkspaceStore } = await from<any>("graph/workspace-store.ts");
    const { kitForTests } = await from<any>("test-util/app-kit.ts");
    tools = await from<any>("apps/tools.ts");
    STEP_RUN = tools.STEP_RUN_TOOL;
    appIdentity = (await from<any>("auth.ts")).appIdentity;
    const graph = await openGraphBackend({ kind: "ladybug", path: join(root, "graph.lbug"), namespace: PRIVATE_NAMESPACE }, { embeddings: false });
    // The job agent's model, stood in for through strut's hook on every
    // model it builds: the call records what the model was handed, and
    // ends the turn there. A key that is no one's, so nothing reaches a
    // provider even if the stand-in were skipped.
    process.env["ANTHROPIC_API_KEY"] = "stand-in";
    delete process.env["ANTHROPIC_BASE_URL"];
    const { registerModelWrapper } = await from<any>("extensions.ts");
    const { mockModel } = await from<any>("privacy/testing/mock-model.ts");
    registerModelWrapper((model: object) => {
      const scripted = script ? mockModel({ turns: script }) : undefined;
      const handed = (k: "doGenerate" | "doStream") => async (options: { prompt: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string }> }) => {
        const text = (c: unknown) => (typeof c === "string" ? c : (c as Array<{ text?: string }>).map((p) => p.text ?? "").join(""));
        turns.push({
          system: options.prompt.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n"),
          prompt: text(options.prompt.find((m) => m.role === "user")?.content ?? ""),
          tools: (options.tools ?? []).map((t) => t.name),
        });
        if (scripted) return scripted[k](options);
        throw new Error("stand-in model: the turn is recorded");
      };
      return new Proxy(scripted ?? model, { get: (m, k) => (k === "doGenerate" || k === "doStream" ? handed(k) : Reflect.get(m, k, m)) });
    });
    strut = await createStrut({
      workspace: new GraphWorkspaceStore(graph, { materializeDir: join(root, "steps"), appsDir: join(root, "apps") }),
      dataDir: root,
      store,
      kit: await kitForTests(),
      serveUi: false,
      enableChat: false,
      autoResume: false,
      orchestrator: false,
      builder: false,
      systemWorkflows: false,
      browserWorkflows: false,
      privacyWorkflows: false,
      mediaWorkflows: false,
      views: false,
      // Strut's own pages, `Job` among them, which this package's page goes under.
      concepts: { personal: false, claims: false },
      stt: false,
      jamie: false,
      earnings: false,
      staff: false,
      worker: false,
      // A server: git gets no credential of this machine's, only the run's.
      git: { local: false },
      // The private repositories' https addresses, read from this machine
      // over http: the token's host and git's are one, 127.0.0.1:<port>.
      services: { shell: insteadOf({ [`https://${priv.host}/`]: `${priv.url}/` }) },
    });
    // Installed by a person, as a box's admin does with the deployment key
    // and their actor: they own its workflows, so its schedule runs as them.
    // Strut trusts `x-strut-actor` only beside its key, which is set for
    // the install alone.
    const install = async (dir: string) => {
      const key = `key-${randomBytes(8).toString("hex")}`;
      process.env["STRUT_API_KEY"] = key;
      try {
        const res = await strut.app.request("/packages/install", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-strut-actor": "root" },
          body: JSON.stringify({ ref: `file:${dir}` }),
        });
        const body = await res.json();
        assert.equal(res.status, 201, JSON.stringify(body));
      } finally {
        delete process.env["STRUT_API_KEY"];
      }
    };
    await install(HERE);
    const other = join(root, "acme-other");
    // A forge's package for the private repositories' host, as a GitLab one
    // would be: the secret its token is, the step that says what a
    // person's token reaches (each picked, one of them twice and one no
    // address), and the step that opens a pull request.
    const files = {
      ...OTHER,
      "strut.yaml": [
        "package: acme/other",
        "version: 0.1.0",
        "requires:",
        "  optional: [LAB_TOKEN]",
        "provides:",
        "  git:",
        `    - { host: "${priv.host}", secret: LAB_TOKEN, repositories: repositories, pull_request: pull-request }`,
        // A stand-in for the package that sets workspaces up (stadeum/pods):
        // it reads the workspace's node, its note on it, as pods' `setup` does.
        "on:",
        "  - { created: Workspace, workflow: setup }",
        "",
      ].join("\n"),
      "workflows/setup.yaml": [
        "description: Read a new workspace, as the package that sets workspaces up does.",
        "steps:",
        "  - id: node",
        "    type: graph/graph-get",
        "    config:",
        '      ref_id: "{{ input.ref_id }}"',
        "",
      ].join("\n"),
      "steps/repositories.ts": [
        'import { z, defineStep } from "strut";',
        "export default defineStep({",
        '  type: "acme/other/repositories",',
        '  description: "What the person\'s lab token reaches.",',
        '  effect: "read",',
        "  input: z.object({}),",
        "  output: z.any(),",
        "  async run(_cfg, ctx: any) {",
        '    if (!(await ctx.services.secrets.get("LAB_TOKEN"))) throw new Error("connect your lab account");',
        "    return { repositories: [",
        `      { url: "${SECRET}", name: "secret", private: true, pushed: "2026-11-20T10:00:00Z", description: "The secret one", picked: true },`,
        `      { url: "${OTHER_SECRET}.git", name: "other", private: true, pushed: "2026-11-21T10:00:00Z", picked: true },`,
        `      { url: "${SECRET}/", name: "secret" },`,
        '      { url: "not an address", name: "nothing" },',
        "    ] };",
        "  },",
        "});",
        "",
      ].join("\n"),
      "steps/pull-request.ts": [
        'import { z, defineStep } from "strut";',
        "export default defineStep({",
        '  type: "acme/other/pull-request",',
        '  description: "Open a pull request on the lab.",',
        '  effect: "write",',
        "  input: z.object({ url: z.string(), head: z.string(), base: z.string(), title: z.string(), body: z.string().optional() }),",
        "  output: z.any(),",
        "  async run(cfg, ctx: any) {",
        '    if (!(await ctx.services.secrets.get("LAB_TOKEN"))) throw new Error("no_push_permission: connect your lab account");',
        "    return { url: `${cfg.url}/pulls/7`, number: 7, head: cfg.head, base: cfg.base, title: cfg.title };",
        "  },",
        "});",
        "",
      ].join("\n"),
    };
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(dirname(join(other, rel)), { recursive: true });
      await writeFile(join(other, rel), text);
    }
    await install(other);
    for (const app of [APP, OTHER_APP]) versions[app] = (await strut.apps.manifestOf(app)).version;
  });
  after(async () => {
    await strut?.close?.().catch(() => {});
    await priv?.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it("installs whole: its types, app, workflows, the job's tools and the schedule", async () => {
    const { packages } = await (await strut.app.request("/packages")).json();
    const pkg = packages.find((p: any) => p.package === "stadeum/code");
    assert.ok(pkg, "installed");
    assert.equal(pkg.version, "0.10.2");
    assert.equal(pkg.requires?.binaries, undefined, "it runs no git of its own");
    const job = await strut.workspace.getWorkflow("job");
    for (const t of ["stadeum/code/repositories", "stadeum/code/workspace", "git/push", "git/pull-request"]) assert.ok(job.params.tools.includes(t), `the job agent is granted ${t}`);
    assert.deepEqual((job.params.approve ?? []).filter((t: string) => t.startsWith("stadeum/code/") || t.startsWith("git/")), [], "none asks first: the pull request is the person's review");
    assert.equal(await strut.workspace.getWorkflow("stadeum/code/add").catch(() => undefined), undefined, "no Add a repository apart from a workspace");
    const { automations } = await (await strut.app.request("/automations")).json();
    const check = automations.find((a: any) => a.package === "stadeum/code");
    assert.ok(check, "check's schedule is installed");
    assert.equal(check.workflow, "stadeum/code/check");
    assert.equal(check.trigger.every, "interval");
    assert.equal(check.trigger.minutes, 15);
    assert.equal(check.enabled ?? true, true, "on");
    assert.equal(check.runsAs, "root", `it runs as the person who installed it: ${JSON.stringify(check)}`);
  });

  it("ships the Code Change page under Job, as a kind of job, its text the file's", async () => {
    const job = await once("job-kinds", "graph/graph-get", { node_type: "Concept", name: "Job", children: "PARENT_OF" });
    const kind = job.children.find((c: any) => c.name === PAGE);
    assert.ok(kind, "a kind under Job");
    assert.match(kind.description, /change the code of one of the box's repositories/);
    assert.match(kind.description, /Not a question about the code/);
    const page = await once("code-change-page", "graph/graph-get", { node_type: "Concept", name: PAGE });
    assert.equal(page.properties.docs.trim(), await pageText());
  });

  it("ships the Codebase page, a root, its text the file's", async () => {
    const root = await concept("Codebase");
    assert.equal(root.properties.docs.trim(), await pageText("Codebase"));
    assert.match(root.properties.description, /a page for each workspace that has been baked/);
  });

  it("ships the Recent Workspaces page under strut's Recent Work, naming its read step, its text the file's", async () => {
    const root = await once("recent-pages", "graph/graph-get", { node_type: "Concept", name: "Recent Work", children: "PARENT_OF" });
    assert.ok(root.children.some((c: any) => c.name === "Recent Workspaces"), "a page under Recent Work");
    const page = await concept("Recent Workspaces");
    assert.equal(page.properties.step, "stadeum/code/recent");
    assert.equal(page.properties.docs.trim(), await pageText("Recent Workspaces"));
  });

  it("opens a Code Change job's turn with the page, the kind listed and its tools granted", async () => {
    const before = turns.length;
    const message = "Make the Add button blue.";
    const r = await strut.run("job", { prompt: message, kind: PAGE }, { job: "code-change-kind", actor: "ada", principal: "ada" });
    assert.match(JSON.stringify(r.error), /stand-in model/, "the turn reached the model");
    const turn = turns[before];
    assert.ok(turn, "the model was called");
    const { kindLead, kindEnd } = (await strut.workspace.getWorkflow("job")).params;
    // The job's line, then the kind's page, then the message (after the
    // agent's own line on its working directory).
    const head = `Your job id: code-change-kind. ${kindLead}`;
    const at = turn.prompt.indexOf(head);
    assert.ok(at >= 0, turn.prompt.slice(0, 300));
    // Before it, strut's Recent Work, this package's page among it.
    assert.ok(turn.prompt.slice(0, at).includes(`Recent Workspaces:\n${await pageText("Recent Workspaces")}`), turn.prompt.slice(0, at));
    assert.ok(turn.prompt.endsWith(`${kindEnd}${message}`), turn.prompt.slice(-200));
    const section = turn.prompt.slice(at + head.length, turn.prompt.length - kindEnd.length - message.length);
    assert.match(section, /"Code Change" Concept/);
    assert.ok(section.includes(await pageText()), "the page whole");
    // Every turn's system prompt lists the kinds under Job, this one among them.
    assert.match(turn.system, /- Code Change — A request to change the code of one of the box's repositories/);
    // Each tool the page names, by the name it gives it.
    for (const t of ["stadeum_code_repositories", "stadeum_code_workspace", "git_checkout", "git_push", "git_pull_request"]) {
      assert.ok(turn.tools.includes(t), `${t} in ${turn.tools.join(", ")}`);
      if (t !== "git_checkout") assert.ok((await pageText()).includes(t), `the page names ${t}`);
    }
    assert.ok(!(await pageText()).includes("github_create_pr"), "the page names no forge's pull-request step");
    // The deeper path sends it to the `Pod` page, another kind under Job:
    // it opens a kind's page by name, as its system prompt says.
    assert.ok(turn.tools.includes("graph_graph_get"), "it can open another page");
    assert.ok(turn.system.includes('graph_graph_get({ node_type: "Concept", name: "<name>"'), "and is told how");

    // A job of no kind opens with no page.
    const plain = await strut.run("job", { prompt: message }, { job: "code-change-none", actor: "ada", principal: "ada" });
    assert.match(JSON.stringify(plain.error), /stand-in model/);
    assert.ok(turns[before + 1]?.prompt.endsWith(`Your job id: code-change-none. ${message}`), turns[before + 1]?.prompt);
  });

  it("shows a person the empty box, and why a forge reached nothing for them", async () => {
    const seen = await list(true);
    const { hosts, ...rest } = seen;
    assert.deepEqual(rest, { repositories: [], workspaces: [], reachable: [], may: true });
    // Each host the box serves, the lab's among them, says why it reached nothing.
    const lab = hosts?.find((h) => h.host === priv.host);
    assert.ok(lab?.problem, JSON.stringify(hosts));
  });

  it("lets anyone make a workspace in the Code app, from public repositories, each asked for as them", async () => {
    const out = await made(ada(), { name: "Strut", repositories: [PODS, `${CODE}.git`], create: true });
    assert.deepEqual(out, { workspace: "strut", created: true, repositories: [CODE, PODS], added: [CODE, PODS], removed: [], new: [CODE, PODS], left: [] });
    const r = await repo(CODE);
    assert.equal(r.name, "strut-code");
    assert.equal(r.branch, "main");
    assert.match(r.head, HEX);
    assert.ok(Date.now() - Date.parse(r.checked) < 120_000, "asked now");
    assert.equal(r.ingested, undefined, "the next check ingests it");
    assert.deepEqual(r.workspaces, ["strut"]);
    assert.deepEqual(await space("strut"), { name: "strut", repositories: [CODE, PODS] }, "no main repository");
    // A name taken is refused to Create, and changes nothing.
    assert.match((await make(page("bob"), { name: "strut", repositories: [CODE], create: true })).error ?? "", /there is a workspace strut already/);
    assert.deepEqual((await space("strut")).repositories, [CODE, PODS]);
  });

  it("writes Set up's additional information on the workspace as it is made, where whatever sets it up reads it, as the person who pressed it", async () => {
    const before = await list();
    // Only when it is made, and not over 4,000 characters: refused, nothing written.
    assert.match((await make(ada(), { name: "strut", repositories: [CODE], note: "x" })).error ?? "", /strut is made already: additional information goes on a workspace when it is made/);
    assert.match((await make(ada(), { name: "noted", repositories: [CODE], create: true, note: "x".repeat(4001) })).error ?? "", /at most 4000 go on a workspace/);
    assert.deepEqual(await list(), before);

    const note = "the UI is strut;\npeel is for reference";
    const out = await made(ada(), { name: "noted", repositories: [CODE], create: true, note: `  the UI is strut;\r\n${"peel is for reference"}  ` });
    assert.deepEqual(out, { workspace: "noted", created: true, repositories: [CODE], added: [CODE], removed: [], new: [], left: [] });
    assert.deepEqual(await space("noted"), { name: "noted", repositories: [CODE], note });
    // `on: created: Workspace` ran the stand-in for pods' setup as ada, and it read the note on the node.
    const ref = (await refOf("Workspace", { name: "noted" }))!;
    const [setup] = await setups(ref);
    assert.equal(setup.status, "success", JSON.stringify(setup.error));
    assert.equal(setup.principal, "ada", "as the person who pressed it");
    assert.equal(setup.output.properties.note, note);

    // The Code app asks strut for ada's chat about it, as her page: granted.
    const call = ada();
    const asked = await call("conversation/list", { about: ref, limit: 1 });
    const found = await chatAbout(async (type, config) => {
      const r = await call(type, config);
      if (r.error) throw new Error(r.error);
      return r.result;
    }, ref);
    if (strut.getRegistry()["conversation/start"]) {
      // A strut with the seam (stakwork/strut#858): her chats about it, and none here, where nothing starts one.
      assert.equal(asked.error, undefined, asked.error);
      assert.deepEqual(found, { none: true });
    } else {
      // Before it, strut refuses a package's page every chat: no chat, and no link.
      assert.match(asked.error ?? "", /not available to an app's page/, "the grant holds: strut's own guard refuses it");
      assert.ok("unsupported" in found, JSON.stringify(found));
    }

    // Made again after a delete, it has that Set up's note, or none: never the last one's.
    assert.deepEqual((await ada()("stadeum/code/delete", { workspace: "noted" })).result, { deleted: "noted", left: [] });
    await made(ada(), { name: "noted", repositories: [CODE], create: true });
    assert.deepEqual(await space("noted"), { name: "noted", repositories: [CODE] });
    await ada()("stadeum/code/delete", { workspace: "noted" });
    await made(ada(), { name: "noted", repositories: [CODE], create: true, note: "Run the lab's app first." });
    assert.equal((await space("noted"))?.note, "Run the lab's app first.");
    assert.deepEqual((await ada()("stadeum/code/delete", { workspace: "noted" })).result, { deleted: "noted", left: [] });
    assert.deepEqual(await list(), before);
  });

  it("shows the Code app the files packages keep on a workspace's node, each version, and writes none", async () => {
    const { nodeFilesAs } = await from<any>("node-files.ts");
    await made(ada(), { name: "kept", repositories: [CODE], create: true });
    const ref = (await refOf("Workspace", { name: "kept" }))!;
    // The Code app's page reads them as ada, through strut's node/files: granted.
    const call = ada();
    const run = async (type: string, config: Record<string, unknown>) => {
      const r = await call(type, config);
      if (r.error) throw new Error(r.error);
      return r.result;
    };
    assert.deepEqual(await foldersOn(run, ref), { folders: [] }, "none kept yet");
    // Another package keeps its files on it, as stadeum/pods keeps a workspace's `.pod/`.
    const theirs = nodeFilesAs(strut.services.nodeFiles, "acme/other");
    await theirs.write(ref, { Dockerfile: "FROM node:22\n" }, { note: "first" });
    await theirs.write(ref, { Dockerfile: "FROM node:24\n", "setup.sh": "npm ci\n", "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]) });
    const found = await foldersOn(run, ref);
    assert.ok("folders" in found, JSON.stringify(found));
    assert.deepEqual(
      found.folders.map((f) => [f.package, f.versions.map((v) => [v.version, v.paths.sort()])]),
      [["acme/other", [[2, ["Dockerfile", "logo.png", "setup.sh"]], [1, ["Dockerfile"]]]]],
    );
    assert.equal(found.folders[0]!.versions[1]!.note, "first");
    const newest = await readFolder(run, ref, "acme/other");
    assert.equal(newest.version, 2);
    assert.equal(newest.files["Dockerfile"], "FROM node:24\n");
    assert.deepEqual(shown(newest.files["logo.png"]), { bytes: 5 }, "a file that isn't text, by its size");
    assert.deepEqual((await readFolder(run, ref, "acme/other", 1)).files, { Dockerfile: "FROM node:22\n" });
    // Read only: the page writes no files on a node.
    assert.match((await call("node/write-files", { ref_id: ref, files: { x: "y" } })).error ?? "", /not granted to this app/);
    // An empty newest version, as pods writes for a workspace made again: nothing to show.
    await theirs.write(ref, {});
    assert.deepEqual(await foldersOn(run, ref), { folders: [] });
    assert.deepEqual((await ada()("stadeum/code/delete", { workspace: "kept" })).result, { deleted: "kept", left: [] });
  });

  it("refuses a change from any app but the Code app, and from a run that is nobody's", async () => {
    const before = await list();
    const elsewhere = page("root", true, OTHER_APP);
    const seen = await elsewhere("stadeum/code/repositories", { reachable: false });
    assert.equal(seen.error, undefined, seen.error);
    assert.equal(seen.result.may, false, "the other app draws no controls");
    const refused = /workspaces are made and changed in the Code app \(stadeum\/code\/code\), not from acme\/other\/console/;
    for (const [type, config] of [
      ["stadeum/code/workspace", { name: "elsewhere", repositories: [CODE] }],
      ["stadeum/code/rename", { workspace: "strut", name: "elsewhere" }],
      ["stadeum/code/delete", { workspace: "strut" }],
    ] as const) {
      assert.match((await elsewhere(type, config)).error ?? "", refused, type);
    }
    const nobody = await run("nobody", "stadeum/code/workspace", { name: "nobodys", repositories: [CODE] });
    assert.equal(nobody.status, "error");
    assert.match(JSON.stringify(nobody.error), /made as a person/);
    assert.deepEqual(await list(), before);
  });

  it("puts one repository in several workspaces, one node however it is typed", async () => {
    const out = await made(ada(), { name: "code", repositories: ["HTTPS://GitHub.com/stakwork/strut-code"] });
    assert.deepEqual(out.new, [], "already the box's");
    const l = await list();
    assert.equal(l.repositories.filter((r) => r.url === CODE).length, 1);
    assert.deepEqual(l.repositories.find((r) => r.url === CODE).workspaces, ["code", "strut"]);
    assert.deepEqual(l.workspaces.map((w) => w.name), ["code", "strut"]);
  });

  it("refuses a repository the person can't read, or none, plainly, and changes nothing", async () => {
    const before = await list();
    const missing = await make(ada(), { name: "x", repositories: [CODE, MISSING] });
    assert.match(missing.error ?? "", /asks for a sign-in: it is private, or there is no repository there, and you have no access to it/);
    assert.match((await make(ada(), { name: "x", repositories: ["git@github.com:stakwork/strut-code.git"] })).error ?? "", /an ssh address/);
    assert.match((await make(ada(), { name: "x" })).error ?? "", /holds one repository at least/);
    assert.match((await make(ada(), { name: "x y", repositories: [CODE] })).error ?? "", /not a workspace's name/);
    assert.match((await make(ada(), { name: "code", repositories: [MISSING] })).error ?? "", /you have no access to it/);
    assert.deepEqual(await list(), before);
  });

  it("takes a repository out of a workspace, and one in no other leaves the box", async () => {
    const out = await made(ada(), { name: "strut", remove: [PODS] });
    assert.deepEqual(out, { workspace: "strut", created: false, repositories: [CODE], added: [], removed: [PODS], new: [], left: [PODS] });
    assert.equal(await repo(PODS), undefined, "off the box");
    assert.equal(await refOf("Repository", { url: PODS }), undefined, "its node deleted");
    const kept = await made(ada(), { name: "code", repositories: [PODS], remove: [] });
    assert.deepEqual(kept.new, [PODS], "back, as new");
    const out2 = await made(ada(), { name: "code", remove: [CODE] });
    assert.deepEqual(out2.left, [], "still in strut");
    assert.deepEqual((await repo(CODE)).workspaces, ["strut"]);
    assert.match((await make(ada(), { name: "strut", remove: [CODE] })).error ?? "", /strut would hold no repository: delete it instead/);
    assert.match((await make(ada(), { name: "strut", remove: [PODS] })).error ?? "", /is not in strut/);
    assert.match((await make(ada(), { name: "none", remove: [PODS] })).error ?? "", /there is no workspace none/);
  });

  it("checks each remote, records a head that moved, and ingests what is new", async () => {
    const before = await repo(CODE);
    // Make the graph think the remote moved since: an old head, ingested.
    const stale = "0".repeat(40);
    await once("stale", "graph/edit-node", { ref_id: await refOf("Repository", { url: CODE }), node_data: { head: stale, ingested: stale } });
    assert.equal((await repo(CODE)).head, stale);

    const r = await strut.run("stadeum/code/check", {}, { actor: "root", principal: "root" });
    assert.equal(r.status, "success", JSON.stringify(r.error));
    assert.deepEqual((await list()).workspaces.map((w) => w.name), ["code", "strut"], "check writes no workspace");
    const after = await repo(CODE);
    assert.equal(after.head, before.head, "the remote's head, recorded");
    assert.equal(after.ingested, after.head, "and ingested");
    assert.ok(Date.parse(after.checked) >= Date.parse(before.checked));
    assert.equal(after.problem, undefined);
    const pods = await repo(PODS);
    assert.equal(pods.ingested, pods.head, "a repository new to the box is ingested at the next check");
  });

  it("clears 0.6's main from a workspace that still carries it", async () => {
    const ref = await refOf("Workspace", { name: "strut" });
    await once("old-main", "graph/edit-node", { ref_id: ref, node_data: { main: CODE } });
    assert.equal((await once("old-main-read", "graph/find", { node_type: "Workspace", where: { name: "strut" } })).nodes[0].properties.main, CODE);
    assert.deepEqual(await space("strut"), { name: "strut", repositories: [CODE] }, "never read");
    assert.equal((await strut.run("stadeum/code/check", {}, { actor: "root", principal: "root" })).status, "success");
    assert.equal((await once("old-main-after", "graph/find", { node_type: "Workspace", where: { name: "strut" } })).nodes[0].properties.main ?? undefined, undefined);
  });

  it("renames a workspace in place, its page with it", async () => {
    const node = await refOf("Workspace", { name: "code" });
    const pageRef = await bake("code workspace");
    assert.deepEqual((await space("code")).page, { name: "code workspace", ref_id: pageRef });
    const out = await ada()("stadeum/code/rename", { workspace: "code", name: "Pods" });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.result, { workspace: "pods", renamed: true, from: "code", page: "pods workspace" });
    assert.deepEqual(await space("pods"), { name: "pods", repositories: [PODS], page: { name: "pods workspace", ref_id: pageRef } });
    assert.equal(await space("code"), undefined);
    assert.equal(await refOf("Workspace", { name: "pods" }), node, "the same node: what is kept on it stays");
    assert.match((await ada()("stadeum/code/rename", { workspace: "pods", name: "strut" })).error ?? "", /there is a workspace strut already/);
    assert.match((await ada()("stadeum/code/rename", { workspace: "nope", name: "x" })).error ?? "", /there is no workspace nope/);
  });

  it("deletes a workspace: its page, and each repository in no other workspace", async () => {
    // A member sees the page too: the link is every person's.
    assert.equal((await member("stadeum/code/repositories")).result.workspaces.find((w: any) => w.name === "pods").page.name, "pods workspace");
    const one = await ada()("stadeum/code/delete", { workspace: "pods" });
    assert.equal(one.error, undefined, one.error);
    assert.deepEqual(one.result, { deleted: "pods", left: [PODS] });
    assert.match(String(await concept("pods workspace")), /node not found: Concept "pods workspace"/, "its page went with it");
    await bake("strut-code");
    const two = await ada()("stadeum/code/delete", { workspace: "strut" });
    assert.deepEqual(two.result, { deleted: "strut", left: [CODE] });
    assert.deepEqual(await list(), { repositories: [], workspaces: [], may: true });
    assert.equal((await concept("strut-code")).name, "strut-code", "a repository's own page is not the workspace's");
    assert.equal((await concept("Codebase")).name, "Codebase", "and the root stays");
    // Made again, it starts over: no page until it is baked again.
    await made(ada(), { name: "strut", repositories: [CODE], create: true });
    assert.equal((await space("strut")).page, undefined);
    assert.deepEqual((await space("strut")).repositories, [CODE], "only what was asked for");
    assert.deepEqual((await ada()("stadeum/code/delete", { workspace: "strut" })).result, { deleted: "strut", left: [CODE] });
  });

  it("suggests the default workspace while the box has none, and writes it only when a person presses Set up, as them", async () => {
    assert.deepEqual((await list()).workspaces, []);
    // root has connected nothing for the lab: nothing to suggest, nothing to set up.
    const root = page("root", true);
    assert.equal((await root("stadeum/code/repositories")).result.suggested, undefined);
    assert.match((await root("stadeum/code/default-workspace")).error ?? "", /your accounts reach no repository to set up/);
    // root connects: every repository picked there, named after their owner, suggested.
    await ownSecret("root", "LAB_TOKEN", TOKEN);
    const seen = (await root("stadeum/code/repositories")).result;
    assert.deepEqual(seen.suggested, { name: "team", repositories: [OTHER_SECRET, SECRET] });
    assert.deepEqual(seen.workspaces, [], "suggested, not written");
    // check writes nothing: no setup starts unasked.
    const ran = await fireCheck();
    assert.equal(ran.status, "success", JSON.stringify(ran.error));
    assert.equal(ran.principal, "root");
    assert.deepEqual((await list()).workspaces, []);
    // Set up from another app, or by a run that is nobody's: refused.
    assert.match((await page("root", true, OTHER_APP)("stadeum/code/default-workspace")).error ?? "", /made and changed in the Code app/);
    // root presses Set up, with additional information: written as root, the note on it.
    const out = await root("stadeum/code/default-workspace", { note: "The UI is secret; other is for reference." });
    assert.equal(out.error, undefined, out.error);
    assert.deepEqual(out.result, { workspace: "team", repositories: [OTHER_SECRET, SECRET] });
    assert.deepEqual(await space("team"), { name: "team", repositories: [OTHER_SECRET, SECRET], note: "The UI is secret; other is for reference." });
    const [setup] = await setups((await refOf("Workspace", { name: "team" }))!);
    assert.equal(setup.principal, "root", "its setup runs as the person who pressed Set up");
    assert.equal(setup.output.properties.note, "The UI is secret; other is for reference.");
    assert.equal((await repo(SECRET)).branch, "trunk", "the remote's own default branch");
    // Once the box has one, nothing is suggested, and Set up is refused.
    assert.equal((await root("stadeum/code/repositories")).result.suggested, undefined);
    assert.match((await root("stadeum/code/default-workspace")).error ?? "", /the box has a workspace already/);
    // The next check ingests what is new.
    assert.equal((await fireCheck()).status, "success");
    const r = await repo(SECRET);
    assert.equal(r.ingested, r.head);
  });

  it("lists what a person's forges reach, picked or not, written one way, as them", async () => {
    // ada has connected nothing: the lab says so.
    const lab = (l: { hosts?: any[] }) => l.hosts?.find((h) => h.host === priv.host);
    const none = await list(true);
    assert.ok(lab(none)?.problem, JSON.stringify(none.hosts));
    await ownSecret("ada", "LAB_TOKEN", TOKEN);
    const seen = await list(true);
    assert.deepEqual(lab(seen), { host: priv.host });
    assert.deepEqual(seen.reachable, [
      { url: OTHER_SECRET, name: "other", private: true, pushed: "2026-11-21T10:00:00Z", picked: true },
      { url: SECRET, name: "secret", private: true, pushed: "2026-11-20T10:00:00Z", description: "The secret one", picked: true },
    ]);
    await dropSecret("ada", "LAB_TOKEN");
  });

  it("puts a private repository in a workspace with the person's own token for its host, and refuses it without one", async () => {
    const before = priv.seen.length;
    const refused = await make(ada(), { name: "mine", repositories: [SECRET], create: true });
    assert.match(
      refused.error ?? "",
      new RegExp(`${esc(SECRET)} asks for a sign-in: it is private, or there is no repository there, and you have no access to it: you have not connected an account for ${esc(priv.host)}, or that account cannot read it\\. Connect one that can, then try again\\.`),
    );
    assert.ok(priv.seen.slice(before).every((s) => s.password === undefined), "asked with no token");
    await ownSecret("bob", "LAB_TOKEN", WRONG);
    const wrong = await make(page("bob"), { name: "mine", repositories: [SECRET] });
    assert.match(wrong.error ?? "", /and you have no access to it/);
    assert.ok(!(wrong.error ?? "").includes(WRONG));
    assert.equal(await space("mine"), undefined);
    await ownSecret("ada", "LAB_TOKEN", TOKEN);
    const ok = await made(ada(), { name: "mine", repositories: [SECRET], create: true });
    assert.deepEqual(ok.new, [], "already the box's, in team");
    assert.ok(priv.seen.slice(before).some((s) => s.password === TOKEN), "the token reached its own host");
  });

  it("checks a private repository as the check workflow's owner, and names them in its problem when they have no access", async () => {
    // root installed the package, so the schedule runs as root, who has a token.
    const second = pushCommit("second");
    const ran = await fireCheck();
    assert.equal(ran.status, "success", JSON.stringify(ran.error));
    assert.equal(ran.principal, "root", "as the workflow's owner");
    let r = await repo(SECRET);
    assert.equal(r.head, second, "its new head, read with the owner's token");
    assert.equal(r.ingested, second, "and ingested");
    assert.equal(r.problem, undefined);

    // carl owns check now, and has connected no account for that host. A
    // person opening the app reads carl's name in the problem, not their own.
    await giveCheckTo("carl");
    const third = pushCommit("third");
    const denied = await fireCheck();
    assert.equal(denied.status, "success", JSON.stringify(denied.error));
    assert.equal(denied.principal, "carl");
    r = await repo(SECRET);
    assert.equal(r.head, second, "not read");
    assert.equal(
      r.problem,
      `${SECRET} asks for a sign-in: it is private, or there is no repository there, and carl, whom the check runs as (its workflow's owner), has no access to it: ` +
        `carl has not connected an account for ${priv.host}, or that account cannot read it. Either carl connects one that can, or an admin gives the check workflow an owner whose account can.`,
    );

    // carl connects one: the next check reads it, and the problem goes.
    await ownSecret("carl", "LAB_TOKEN", TOKEN);
    const again = await fireCheck();
    assert.equal(again.status, "success", JSON.stringify(again.error));
    r = await repo(SECRET);
    assert.equal(r.head, third);
    assert.equal(r.ingested, third);
    assert.equal(r.problem, undefined);
    await giveCheckTo("root");
  });

  it("answers the job agent's tools as the job's person: the workspaces, what they reach, and a workspace made", async () => {
    await bake("team workspace");
    const out = await once("tool", "stadeum/code/repositories", {}, "ada");
    assert.equal(out.may, undefined, "no page, no flag");
    assert.deepEqual(out.workspaces.map((w: any) => [w.name, w.page?.name]), [["mine", undefined], ["team", "team workspace"]]);
    assert.deepEqual(out.reachable.map((r: any) => r.url), [OTHER_SECRET, SECRET]);
    const tool = await once("tool-workspace", "stadeum/code/workspace", { name: "jobbed", repositories: [CODE, OTHER_SECRET] }, "ada");
    assert.deepEqual(tool, { workspace: "jobbed", created: true, repositories: [OTHER_SECRET, CODE], added: [OTHER_SECRET, CODE], removed: [], new: [CODE], left: [] });
    // As the job's person: one with no token for the lab can't put its repositories in.
    const refused = await run("tool-refused", "stadeum/code/workspace", { name: "jobbed", repositories: [SECRET] }, "dan");
    assert.equal(refused.status, "error");
    assert.match(JSON.stringify(refused.error), /dan has no access to it/);
  });

  it("lists the workspaces for strut's Recent Work as the person: the ones they chatted about first, then the rest by name", async () => {
    const spaces = (await list()).workspaces.sort((a, b) => a.name.localeCompare(b.name));
    const team = spaces.find((w) => w.name === "team")!;
    const repos = (w: { repositories: string[] }) => w.repositories.map((url) => url.replace(/^https:\/\//, "")).join(", ");
    // eve's chat about `team`, as the package that sets workspaces up starts one at Set up (strut's conversation/start).
    await strut.services.conversations.launched("eve/team-chat", {
      runId: "run-eve-team",
      workflow: "orchestrator",
      actor: "eve",
      principal: "eve",
      prompt: "Set up team",
      opens: { title: "Set up team", about: team.ref_id, from: "stadeum/pods" },
    });
    const eve = (await once("recent-eve", "stadeum/code/recent", {}, "eve")).items;
    const { at, ...first } = eve[0];
    assert.ok(!Number.isNaN(Date.parse(at)), `when the chat last changed: ${at}`);
    assert.deepEqual(
      [first, ...eve.slice(1)],
      [{ name: "team", what: `you chatted about it; ${repos(team)}` }, ...spaces.filter((w) => w !== team).map((w) => ({ name: w.name, what: `on this server; ${repos(w)}` }))],
    );
    // Someone with no chat about any: every workspace, by name.
    assert.deepEqual((await once("recent-dan", "stadeum/code/recent", {}, "dan")).items, spaces.map((w) => ({ name: w.name, what: `on this server; ${repos(w)}` })));
    // What eve's next turn opens with: strut's section, this page with team first.
    const { text } = await once("recent-section", "context/recent", { name: "Recent Work" }, "eve");
    assert.ok(text.includes(`Recent Workspaces:\n${await pageText("Recent Workspaces")}\n- team: you chatted about it; ${repos(team)} (${at.slice(0, 10)})`), text);
  });

  it("pushes a Code Change job's small change to a new branch as the job's person, refused the default branch, and opens its pull request", async () => {
    // A file to change on the private repository's default branch, trunk.
    const bare = join(root, "remotes", "team", "secret");
    await writeFile(join(work, "style.css"), "button { color: red; }\n");
    git(work, "add", "style.css");
    git(work, "commit", "--quiet", "-m", "style");
    git(work, "push", "--quiet", bare, "trunk");
    const trunk = git(work, "rev-parse", "HEAD");
    // ada's own token for the host, and root's one the host refuses: a push
    // that gets through carried ada's.
    await ownSecret("ada", "LAB_TOKEN", TOKEN);
    await ownSecret("root", "LAB_TOKEN", WRONG);
    const pushesBefore = priv.seen.length;
    const job = "code-change-small";
    const branch = "code-change/blue-button";
    const message = "Make the button blue";
    let path = "";
    const call = (id: string, toolName: string, input: unknown) => [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }];
    /** What a tool call of this run answered, as the model reads it back. */
    const answered = (prompt: Array<{ role: string; content: unknown }>, id: string): string => {
      for (const m of prompt) {
        if (m.role !== "tool") continue;
        for (const p of m.content as Array<{ toolCallId: string; output?: { value?: unknown } }>) {
          if (p.toolCallId === id) return typeof p.output?.value === "string" ? p.output.value : JSON.stringify(p.output?.value ?? p.output);
        }
      }
      return "";
    };
    let read: (id: string) => string = () => "";
    // The page's small path, by the tools' names on a box.
    script = [
      call("list", "stadeum_code_repositories", {}),
      (prompt: any) => {
        assert.ok(answered(prompt, "list").includes(SECRET), "the box lists it");
        return call("checkout", "git_checkout", { repo: SECRET, workdir: job });
      },
      (prompt: any) => {
        path = /"path":"([^"]+)"/.exec(answered(prompt, "checkout"))?.[1] ?? "";
        return call("edit", "bash", { command: `cd '${path}' && printf 'button { color: blue; }\\n' > style.css && git add -A` });
      },
      // The absolute path git_checkout returned: the default branch first, then a new one.
      () => call("default", "git_push", { path, branch: "trunk", message }),
      () => call("push", "git_push", { path, branch, message }),
      () => call("pr", "git_pull_request", { url: SECRET, head: branch, base: "trunk", title: message, body: "Blue, as asked." }),
      (prompt: any) => {
        read = (id) => answered(prompt, id);
        return call("done", "final_answer", { text: `Opened ${SECRET}/pulls/7.`, artifacts: [] });
      },
    ];
    const before = turns.length;
    try {
      const r = await strut.run("job", { prompt: "Make the Add button blue.", kind: PAGE }, { job, actor: "ada", principal: "ada" });
      assert.equal(r.status, "success", JSON.stringify(r.error));
    } finally {
      script = undefined;
      await ownSecret("root", "LAB_TOKEN", TOKEN);
    }
    assert.ok(turns[before]?.tools.includes("git_pull_request"), "the turn holds strut's git/pull-request");
    assert.ok(turns[before]!.prompt.includes(await pageText()), "and opens with the page");
    // The checkout is the job's own, at an absolute path.
    assert.equal(path, join(root, "jobs", job, "secret"));
    // The default branch is refused: trunk stays as it was (below).
    assert.match(read("default"), /push_rejected: trunk is origin's default branch — git\/push pushes a branch of its own, for a pull request/, read("default"));
    // The new branch is pushed, on trunk's head, with the change alone.
    assert.match(read("push"), new RegExp(`"branch":"${esc(branch)}"`), read("push"));
    const heads = git(bare, "for-each-ref", "--format=%(refname:short) %(objectname) %(authorname)", "refs/heads/").split("\n").sort();
    assert.equal(heads.length, 2, heads.join("\n"));
    assert.equal(heads[1], `trunk ${trunk} test`, "trunk as it was");
    assert.match(heads[0]!, new RegExp(`^${esc(branch)} [0-9a-f]{40} strut$`), "authored as strut: the token is not GitHub's");
    assert.equal(git(bare, "show", `${branch}:style.css`), "button { color: blue; }");
    // As ada: the push carried her token, the only one the host takes.
    const pushes = priv.seen.slice(pushesBefore).filter((r) => r.path.includes("git-receive-pack"));
    assert.ok(pushes.some((r) => r.password === TOKEN), "with ada's token");
    assert.ok(priv.seen.slice(pushesBefore).every((r) => r.password !== WRONG), "never root's");
    // The pull request, opened by the lab's own step, picked by the host.
    assert.match(read("pr"), new RegExp(`"url":"${esc(SECRET)}/pulls/7"`), read("pr"));
    assert.match(read("pr"), new RegExp(`"head":"${esc(branch)}"`));
  });

  it("never puts a token in a node, a run's output or an error", async () => {
    const said: string[] = [JSON.stringify(await list(true)), JSON.stringify(await once("repository-nodes", "graph/find", { node_type: "Repository" }))];
    for (const events of store.events.values()) said.push(JSON.stringify(events));
    for (const summary of store.summaries.values()) said.push(JSON.stringify(summary));
    const all = said.join("\n");
    assert.ok(all.includes(SECRET), "the runs and nodes read are the ones that used it");
    assert.ok(all.includes("has no access to it"), "and the refusals among them");
    for (const token of [TOKEN, WRONG]) assert.equal(all.includes(token), false, "a token is never said");
  });

  it("goes with the package: the Code Change page, its place under Job, the Recent Workspaces page and the job's tools; Codebase stays while a page hangs under it", async () => {
    const res = await strut.app.request("/packages/stadeum/code", { method: "DELETE", headers: { "x-strut-actor": "root" } });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    // Pages that are not the package's are under it.
    assert.deepEqual(
      body.kept.filter((k: any) => k.kind === "concept").map((k: any) => k.name),
      ["Codebase"],
    );
    assert.equal((await concept("Codebase")).name, "Codebase");
    const job = await once("job-kinds-after", "graph/graph-get", { node_type: "Concept", name: "Job", children: "PARENT_OF" });
    assert.equal(job.children.find((c: any) => c.name === PAGE), undefined, "no longer a kind");
    const recent = await once("recent-pages-after", "graph/graph-get", { node_type: "Concept", name: "Recent Work", children: "PARENT_OF" });
    assert.equal(recent.children.find((c: any) => c.name === "Recent Workspaces"), undefined, "no longer under Recent Work");
    const gone = await once("code-change-page-after", "graph/graph-get", { node_type: "Concept", name: PAGE });
    assert.match(String(gone), /node not found: Concept "Code Change"/);
    const tools = (await strut.workspace.getWorkflow("job")).params.tools;
    for (const t of ["stadeum/code/repositories", "stadeum/code/workspace", "git/push", "git/pull-request"]) assert.ok(!tools.includes(t), `${t} goes with the grant`);
  });
});
