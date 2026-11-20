import { z, defineStep } from "strut";
import { asCtx, readList, view } from "./_code.js";

export default defineStep({
  type: "stadeum/code/repositories",
  description:
    "What repositories and workspaces this box holds. Each repository: its https `url`, `name`, default `branch`, the `head` commit last seen on it, " +
    "when it was `checked`, the commit last `ingested`, a `problem` when its last check failed, and the `workspaces` it is in. " +
    "Each workspace: its `name` (what a pod is claimed for), its `main` repository's url, and its `repositories`' urls, the main one first. " +
    "Clone a repository by its `url`; work on its default `branch`. A person adds repositories in the Code app.",
  effect: "read",
  input: z.object({}),
  output: z.object({
    repositories: z.array(
      z.object({
        url: z.string(),
        name: z.string(),
        branch: z.string().optional(),
        head: z.string().optional(),
        checked: z.string().optional(),
        ingested: z.string().optional(),
        problem: z.string().optional(),
        workspaces: z.array(z.string()),
      }),
    ),
    workspaces: z.array(z.object({ name: z.string(), main: z.string().optional(), repositories: z.array(z.string()) })),
    admin: z.boolean().optional().describe("On a page's call: whether its viewer may change the list (an admin)."),
  }),
  async run(_cfg, ctx) {
    const c = asCtx(ctx);
    return { ...view(await readList(c)), ...(c.app ? { admin: c.app.admin === true } : {}) };
  },
});
