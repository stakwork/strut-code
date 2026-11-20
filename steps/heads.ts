import { z, defineStep } from "strut";
import { asCtx, checkHeads } from "./_code.js";

export default defineStep({
  type: "stadeum/code/heads",
  description:
    "The `check` workflow's pass: ask each repository's remote for its default branch's head (`git ls-remote`, no clone), record a head that moved, " +
    "when it was checked, and why a check failed. Names the repositories whose head is not yet ingested, for `ingest`.",
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
