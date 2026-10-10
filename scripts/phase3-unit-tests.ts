import assert from "node:assert/strict";
import { aspectRatioCss, imageFileName, parseSize } from "../lib/images/dimensions.ts";
import { evictCacheItems } from "../lib/images/cache.ts";
import {
  DEFAULT_POLL_POLICY,
  isTerminalJobStatus,
  nextPollDelay,
  runPollLoop,
  waitWithTimeout,
} from "../lib/images/polling.ts";
import type { ImageJobResponse } from "../lib/schemas.ts";

type Case = { name: string; run: () => void | Promise<void> };
const cases: Case[] = [];

function test(name: string, run: () => void | Promise<void>): void {
  cases.push({ name, run });
}

function job(
  status: ImageJobResponse["status"],
  over: Partial<ImageJobResponse> = {},
): ImageJobResponse {
  return {
    id: "j1",
    status,
    prompt: "a red fox",
    model: "flux-2-pro",
    n: 1,
    size: "1024x1024",
    created_at: 1,
    updated_at: 2,
    ...over,
  };
}

// --------------------------------------------------------------- polling

test("nextPollDelay: 1s → 2s → 3s → 3s (capped)", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 10].map((attempt) => nextPollDelay(attempt)),
    [1000, 2000, 3000, 3000, 3000],
  );
});

test("nextPollDelay: negative and NaN attempts fall back to base", () => {
  assert.equal(nextPollDelay(-3), DEFAULT_POLL_POLICY.baseMs);
  assert.equal(nextPollDelay(Number.NaN), DEFAULT_POLL_POLICY.baseMs);
});

test("nextPollDelay: custom policy respected", () => {
  const policy = { baseMs: 250, factor: 3, maxMs: 2_000 };
  assert.equal(nextPollDelay(0, policy), 250);
  assert.equal(nextPollDelay(1, policy), 750);
  assert.equal(nextPollDelay(2, policy), 2_000);
});

test("isTerminalJobStatus", () => {
  assert.equal(isTerminalJobStatus("succeeded"), true);
  assert.equal(isTerminalJobStatus("failed"), true);
  assert.equal(isTerminalJobStatus("queued"), false);
  assert.equal(isTerminalJobStatus("running"), false);
});

test("runPollLoop: queued → running → succeeded with correct delays", async () => {
  const statuses: ImageJobResponse["status"][] = ["queued", "running", "succeeded"];
  let call = 0;
  const delays: number[] = [];
  const attempts: number[] = [];

  const result = await runPollLoop("j1", {
    fetchJob: async () => job(statuses[Math.min(call++, statuses.length - 1)]),
    wait: async (ms) => {
      delays.push(ms);
    },
    onUpdate: (_job, attempt) => attempts.push(attempt),
  });

  assert.equal(result.status, "succeeded");
  assert.equal(call, 3, "three fetches before terminal");
  assert.deepEqual(delays, [1000, 2000], "delays between attempts 0 and 1");
  assert.deepEqual(attempts, [0, 1, 2]);
});

test("runPollLoop: immediate failure performs zero waits", async () => {
  let waits = 0;
  const result = await runPollLoop("j1", {
    fetchJob: async () => job("failed", { error: { message: "boom", status: 502 } }),
    wait: async () => {
      waits += 1;
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error?.message, "boom");
  assert.equal(waits, 0);
});

test("runPollLoop: abort before first fetch rejects with AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runPollLoop("j1", {
      fetchJob: async () => job("queued"),
      wait: async () => undefined,
      signal: controller.signal,
    }),
    (err: unknown) => err instanceof DOMException && err.name === "AbortError",
  );
});

test("runPollLoop: abort during wait rejects with AbortError", async () => {
  const controller = new AbortController();
  const promise = runPollLoop("j1", {
    fetchJob: async () => job("running"),
    wait: waitWithTimeout,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    promise,
    (err: unknown) => err instanceof DOMException && err.name === "AbortError",
  );
});

test("waitWithTimeout resolves after the delay", async () => {
  const start = Date.now();
  await waitWithTimeout(20);
  assert.ok(Date.now() - start >= 15, "timer fired");
});

test("waitWithTimeout rejects immediately when signal already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitWithTimeout(1_000, controller.signal),
    (err: unknown) => err instanceof DOMException && err.name === "AbortError",
  );
});

// ----------------------------------------------------------------- cache

test("evictCacheItems keeps the newest N", () => {
  const items = [
    { id: "a", created_at: 1 },
    { id: "b", created_at: 5 },
    { id: "c", created_at: 3 },
    { id: "d", created_at: 9 },
  ];
  const kept = evictCacheItems(items, 2).map((i) => i.id);
  assert.deepEqual(kept, ["d", "b"]);
});

test("evictCacheItems tie-breaks equal timestamps by id", () => {
  const items = [
    { id: "z", created_at: 1 },
    { id: "a", created_at: 1 },
    { id: "m", created_at: 1 },
  ];
  const kept = evictCacheItems(items, 2).map((i) => i.id);
  assert.deepEqual(kept, ["a", "m"]);
});

test("evictCacheItems max=0 returns empty", () => {
  assert.deepEqual(evictCacheItems([{ id: "a", created_at: 1 }], 0), []);
});

test("evictCacheItems does not mutate the input", () => {
  const items = [
    { id: "a", created_at: 1 },
    { id: "b", created_at: 2 },
  ];
  evictCacheItems(items, 1);
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
});

// ------------------------------------------------------------ dimensions

test("parseSize parses valid sizes and falls back safely", () => {
  assert.deepEqual(parseSize("1024x1024"), { w: 1024, h: 1024 });
  assert.deepEqual(parseSize("1280x720"), { w: 1280, h: 720 });
  assert.deepEqual(parseSize("720x1280"), { w: 720, h: 1280 });
  assert.deepEqual(parseSize("garbage"), { w: 1024, h: 1024 });
  assert.deepEqual(parseSize(""), { w: 1024, h: 1024 });
});

test("aspectRatioCss produces CSS aspect-ratio strings", () => {
  assert.equal(aspectRatioCss("1024x1024"), "1024 / 1024");
  assert.equal(aspectRatioCss("1280x720"), "1280 / 720");
  assert.equal(aspectRatioCss("bad"), "1024 / 1024");
});

test("imageFileName sanitizes model + id and suffixes multi-image jobs", () => {
  assert.equal(imageFileName("flux-2-pro", "abcDEF123456"), "cm_flux-2-pro_ef123456.png");
  assert.equal(imageFileName("GPT Image 2", "job_99xyz"), "cm_gpt-image-2_job99xyz.png");
  assert.equal(imageFileName("flux-2-pro", "id1", 2), "cm_flux-2-pro_id1_2.png");
  assert.equal(imageFileName("!!!", "!!!"), "cm_image_local.png");
});

// ---------------------------------------------------------------- report

let passed = 0;
const failed: string[] = [];

for (const testCase of cases) {
  try {
    await testCase.run();
    passed += 1;
    console.log(`  ok ${testCase.name}`);
  } catch (err) {
    failed.push(testCase.name);
    console.error(`  FAIL ${testCase.name}`);
    console.error(`       ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.error(`failed: ${failed.join(", ")}`);
  process.exit(1);
}
