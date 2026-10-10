import { jsonError, withBudget } from "@/lib/budget/guard";
import { getImageJob, toImageJobResponse } from "@/lib/images/jobs";

type Params = { params: Promise<{ id: string }> };

export const GET = withBudget<Params>({ route: "images" }, async (_req, ctx, bc) => {
  const { id } = await ctx.params;
  const job = getImageJob(id);

  if (!job || job.identity !== bc.identity) {
    return jsonError(404, "job_not_found", "Image job does not exist or has expired.", {
      scope: "validation",
    });
  }

  return Response.json(toImageJobResponse(job));
});
