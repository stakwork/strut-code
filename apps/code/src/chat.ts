/**
 * The chat about a workspace: the Jamie chat whatever set it up started for
 * the person who pressed Set up, `about` the workspace's node (strut's
 * `conversation/start`, stakwork/strut#858; stadeum's plans/software.md
 * row 26). The Code app finds it with strut's `conversation/list { about }`,
 * the viewer's own chats about that node, newest first, and opens Jamie
 * there. It names no package and starts nothing itself.
 *
 * A strut without the seam refuses the call (a package's page reads no
 * chats there), or, were it to answer, would not know `about` and would list
 * every chat of the viewer's: only a row that says it is about this node
 * counts. Either way there is no chat, and no link.
 *
 * Plain functions, so the package's test reads them as the page does.
 */

/** Strut's step that lists the viewer's chats. */
export const CONVERSATION_LIST = "conversation/list";
/** Strut's Jamie app, which opens a chat by its `session`. */
export const JAMIE = "strut/jamie";

/** How long, after Set up, the app looks for the chat, and how often. */
export const LOOK_FOR_MS = 12_000;
export const LOOK_EVERY_MS = 1_000;

/** One call of a step, as the page's `client.run` makes it. */
export type Run = (type: string, config: Record<string, unknown>) => Promise<unknown>;

/** What a look found: the chat, none, or a strut that can't say. */
export type Found = { session: string; title?: string } | { none: true } | { unsupported: string };

/** The newest chat of the viewer's about the node `about`. */
export async function chatAbout(run: Run, about: string): Promise<Found> {
  let out: unknown;
  try {
    out = await run(CONVERSATION_LIST, { about, limit: 1 });
  } catch (e) {
    return { unsupported: e instanceof Error ? e.message : String(e) };
  }
  const rows = (out as { conversations?: unknown } | undefined)?.conversations;
  if (!Array.isArray(rows)) return { unsupported: "strut's conversation/list answered no conversations" };
  for (const raw of rows) {
    const row = (raw ?? {}) as { id?: unknown; title?: unknown; about?: unknown };
    if (row.about !== about || typeof row.id !== "string" || !row.id) continue;
    return { session: row.id, ...(typeof row.title === "string" && row.title ? { title: row.title } : {}) };
  }
  return { none: true };
}

/**
 * Right after Set up: look for the chat about the workspace every
 * `every` ms for `within` ms, as the setup that starts it runs detached
 * after the workspace is written. The chat once it is there; none when the
 * time ran out; `unsupported` at once when strut can't say.
 */
export async function lookForChat(
  run: Run,
  about: string,
  { within = LOOK_FOR_MS, every = LOOK_EVERY_MS, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = () => Date.now() } = {},
): Promise<Found> {
  const end = now() + within;
  for (;;) {
    const found = await chatAbout(run, about);
    if (!("none" in found) || now() + every > end) return found;
    await wait(every);
  }
}
