import { z, defineStep } from "strut";
import { asCtx, recordIngested } from "./_code.js";

export default defineStep({
  type: "stadeum/code/record",
  description: "The `ingest` workflow's last step: record a repository's head as the commit ingested. Nothing to do when it already is.",
  effect: "write",
  input: z.object({ url: z.string().describe("The repository's url, as the list holds it") }),
  output: z.object({ url: z.string(), commit: z.string().optional(), recorded: z.boolean() }),
  async run(cfg, ctx) {
    return recordIngested(asCtx(ctx), cfg.url);
  },
});
