import { withBudget } from "@/lib/budget/guard";
import { createImageJob } from "@/lib/images/jobs";
import { imageRequestSchema } from "@/lib/schemas";

export const maxDuration = 60;

export const POST = withBudget(
  { route: "images", schema: imageRequestSchema },
  async (_req, _ctx, bc) => {
    const job = await createImageJob(bc.body, bc.identity);
    return Response.json(job, { status: 200 });
  },
);
