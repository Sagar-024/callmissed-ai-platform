import { withBudget } from "@/lib/budget/guard";
import { createImageJob } from "@/lib/images/jobs";
import { imageRequestSchema } from "@/lib/schemas";

export const maxDuration = 60;

export const POST = withBudget(
  { route: "images", schema: imageRequestSchema },
  async (_req, _ctx, bc) => {
    const job = createImageJob(bc.body, bc.identity);
    return Response.json(
      { id: job.id, status: job.status, created_at: job.created_at },
      { status: 202 },
    );
  },
);
