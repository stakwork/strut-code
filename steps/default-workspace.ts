import { z, defineStep } from "strut";
import { asCtx, requireMaker, setUpDefault } from "./_code.js";

export default defineStep({
  type: "stadeum/code/default-workspace",
  description:
    "Set up the box's default workspace, which the Code app suggests while the box has none (a person's Set up, from the Code app): " +
    "every repository picked on GitHub, or the five most recently pushed when an org granted all of its repositories, named after their owner, " +
    "worked out from what the person's own forges reach (strut's git/repositories). It is written as them, so what sets it up runs as them. " +
    "A repository whose remote refuses them is left out. Refused once the box has a workspace.",
  effect: "write",
  input: z.object({}),
  output: z.object({
    workspace: z.string(),
    repositories: z.array(z.string()),
    skipped: z.array(z.object({ url: z.string(), problem: z.string() })).optional().describe("Reached, but their remote refused the person: left out"),
  }),
  async run(_cfg, ctx) {
    const c = asCtx(ctx);
    requireMaker(c);
    return setUpDefault(c);
  },
});
