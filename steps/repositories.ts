import { z, defineStep } from "strut";
import { asCtx, mayChange, reach, readList, view } from "./_code.js";

export default defineStep({
  type: "stadeum/code/repositories",
  description:
    "The box's workspaces and their repositories, and what each forge's token reaches as you. " +
    "Each workspace: its `name` (what a pod is claimed for), its `repositories`' urls, and its `page` once it has been baked: " +
    "the Concept `<name> workspace`, a diagram of its systems and how they connect, the system in words and how to run it. " +
    "Each repository the box holds: its https `url`, `name`, default `branch`, the `head` commit last seen on it, when it was `checked`, the commit last `ingested`, " +
    "a `problem` when its last check failed, and the `workspaces` it is in. " +
    "`reachable`: every repository the forges' tokens reach as you (strut's git/repositories), whether or not the box holds it, each with its `url`, `name`, " +
    "whether it is `private`, when it was `pushed` and its `description`; `hosts` says which forges were asked, and why one reached nothing. " +
    "Clone a repository by its `url`; work on its default `branch`. Make a workspace, or add to one, with stadeum_code_workspace.",
  effect: "read",
  input: z.object({
    reachable: z.boolean().optional().describe("Also list what the forges reach (default true). False reads only the box's own"),
  }),
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
    workspaces: z.array(
      z.object({
        name: z.string(),
        repositories: z.array(z.string()),
        page: z.object({ name: z.string(), ref_id: z.string() }).optional().describe("Its page, the Concept `<name> workspace`: absent until the workspace is baked."),
      }),
    ),
    reachable: z
      .array(
        z.object({
          url: z.string(),
          name: z.string(),
          private: z.boolean().optional(),
          pushed: z.string().optional(),
          description: z.string().optional(),
          picked: z.boolean().optional(),
        }),
      )
      .optional(),
    hosts: z.array(z.object({ host: z.string(), problem: z.string().optional() })).optional(),
    reach_problem: z.string().optional().describe("Why nothing could be asked of the forges"),
    may: z.boolean().optional().describe("On a page's call: whether this viewer may make and change workspaces here."),
  }),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    const [list, reached] = await Promise.all([readList(c), cfg.reachable === false ? undefined : reach(c)]);
    return {
      ...view(list),
      ...(reached ? { reachable: reached.repositories, hosts: reached.hosts, ...(reached.problem ? { reach_problem: reached.problem } : {}) } : {}),
      ...(c.app ? { may: mayChange(c) } : {}),
    };
  },
});
