import { z, defineStep } from "strut";
import { addRepository, asCtx, requireAdmin } from "./_code.js";

export default defineStep({
  type: "stadeum/code/add",
  description:
    "Add a repository to the box's list by its https address (an admin's, from the Code app). The address is checked and written one way, " +
    "and its remote is asked for its default branch and head; a private repository, or none at that address, is refused with a reason. " +
    "Adding one already listed changes nothing. A new one gets a workspace of its own, named after it. The `add` workflow runs this, then `ingest`.",
  effect: "write",
  input: z.object({ url: z.string().describe("The repository's https address, such as https://example.com/team/app") }),
  output: z.any(),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireAdmin(c);
    return addRepository(c, cfg.url);
  },
});
