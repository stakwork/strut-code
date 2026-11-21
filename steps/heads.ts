import { z, defineStep } from "strut";
import { asCtx, checkHeads } from "./_code.js";

export default defineStep({
  type: "stadeum/code/heads",
  description:
    "The `check` workflow's pass: ask each repository's remote for its default branch's head (strut's git/remote-head, no clone) as the person the run is " +
    "(the check workflow's owner, on its schedule), with their own token for each host; record a head that moved, when it was checked, and why a check failed, " +
    "naming whose access is missing. Names the repositories whose head is not yet ingested, for `ingest`.",
  effect: "write",
  input: z.object({}),
  output: z.object({
    checked: z.number(),
    moved: z.array(z.string()),
    ingest: z.array(z.string()),
    problems: z.array(z.object({ url: z.string(), problem: z.string() })),
  }),
  async run(_cfg, ctx) {
    return checkHeads(asCtx(ctx));
  },
});
