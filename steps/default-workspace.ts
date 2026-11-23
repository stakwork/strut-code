import { z, defineStep } from "strut";
import { asCtx, makeDefault } from "./_code.js";

export default defineStep({
  type: "stadeum/code/default-workspace",
  description:
    "The `check` workflow's first step: when the box has no workspace, make its default from what the forges reach as the run's person (the check workflow's owner), " +
    "through strut's git/repositories: every repository picked on GitHub, or the five most recently pushed when an org granted all of its repositories, " +
    "named after their owner. Nothing when the box has a workspace or nothing is reached.",
  effect: "write",
  input: z.object({}),
  output: z.object({
    made: z.boolean(),
    workspace: z.string().optional(),
    repositories: z.array(z.string()).optional(),
    skipped: z.array(z.object({ url: z.string(), problem: z.string() })).optional().describe("Reached, but their remote refused the run's person: left out"),
    why: z.string().optional().describe("Why none was made"),
  }),
  async run(_cfg, ctx) {
    return makeDefault(asCtx(ctx));
  },
});
