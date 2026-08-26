/**
 * Failover between LLM providers.
 *
 * Two free tiers are configured so that a spent daily cap or a rate limit is a
 * line in the log rather than an outage. That only holds if the chain actually
 * falls through on the faults that matter — and, just as importantly, does not
 * fall through on the ones where a second provider would fail identically.
 *
 * Real HTTP servers rather than stubs: the thing most likely to be wrong is the
 * request the client puts on the wire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";

import { makeLlmClient } from "../src/llm";

interface Stub {
  server: Server;
  url: string;
  hits: number;
  lastBody: any;
  close(): Promise<void>;
}

/** A provider that answers `reply`, or fails with `status` when given one. */
async function stubProvider(reply: string, status = 200): Promise<Stub> {
  const state = { hits: 0, lastBody: null as any };

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.hits++;
      state.lastBody = JSON.parse(body || "{}");
      if (status !== 200) {
        res.writeHead(status, { "content-type": "text/plain" });
        return res.end(`provider said ${status}`);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;

  return {
    server,
    url: `http://127.0.0.1:${port}/v1`,
    get hits() { return state.hits; },
    get lastBody() { return state.lastBody; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  } as Stub;
}

/** Run with a temporary env, restoring whatever was there. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const all = { ...vars, MISTRAL_API_KEY: undefined }; // keep the real key out of these
  for (const [k, v] of Object.entries(all)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries({ ...saved, MISTRAL_API_KEY: process.env.MISTRAL_API_KEY })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const msg = [{ role: "user" as const, content: "hello" }];

test("the primary serves and the fallback is never touched", async () => {
  const primary = await stubProvider("from primary");
  const fallback = await stubProvider("from fallback");
  try {
    await withEnv(
      { AI_BASE_URL: primary.url, AI_API_KEY: "k1", AI_MODEL: "m1",
        AI_FALLBACK_BASE_URL: fallback.url, AI_FALLBACK_API_KEY: "k2", AI_FALLBACK_MODEL: "m2" },
      async () => {
        assert.equal(await makeLlmClient().complete(msg, 120), "from primary");
      },
    );
    assert.equal(primary.hits, 1);
    assert.equal(fallback.hits, 0, "a healthy primary must not cost a second request");
  } finally {
    await primary.close(); await fallback.close();
  }
});

test("a rate-limited primary falls through to the fallback", async () => {
  const primary = await stubProvider("", 429);
  const fallback = await stubProvider("from fallback");
  try {
    await withEnv(
      { AI_BASE_URL: primary.url, AI_API_KEY: "k1", AI_MODEL: "m1",
        AI_FALLBACK_BASE_URL: fallback.url, AI_FALLBACK_API_KEY: "k2", AI_FALLBACK_MODEL: "m2" },
      async () => {
        assert.equal(await makeLlmClient().complete(msg, 120), "from fallback");
      },
    );
    assert.equal(fallback.hits, 1);
  } finally {
    await primary.close(); await fallback.close();
  }
});

test("an exhausted credit (402) falls through too", async () => {
  const primary = await stubProvider("", 402);
  const fallback = await stubProvider("from fallback");
  try {
    await withEnv(
      { AI_BASE_URL: primary.url, AI_API_KEY: "k1",
        AI_FALLBACK_BASE_URL: fallback.url, AI_FALLBACK_API_KEY: "k2" },
      async () => {
        assert.equal(await makeLlmClient().complete(msg, 120), "from fallback");
      },
    );
  } finally {
    await primary.close(); await fallback.close();
  }
});

test("a malformed request is not retried against the fallback", async () => {
  // 400 means the request is wrong, and it will be just as wrong at the second
  // provider. Retrying only doubles the latency before the same failure.
  const primary = await stubProvider("", 400);
  const fallback = await stubProvider("from fallback");
  try {
    await withEnv(
      { AI_BASE_URL: primary.url, AI_API_KEY: "k1",
        AI_FALLBACK_BASE_URL: fallback.url, AI_FALLBACK_API_KEY: "k2" },
      async () => {
        await assert.rejects(() => makeLlmClient().complete(msg, 120), /400/);
      },
    );
    assert.equal(fallback.hits, 0, "a 400 must not be retried elsewhere");
  } finally {
    await primary.close(); await fallback.close();
  }
});

test("when both are down the error names both", async () => {
  const primary = await stubProvider("", 429);
  const fallback = await stubProvider("", 503);
  try {
    await withEnv(
      { AI_BASE_URL: primary.url, AI_API_KEY: "k1", AI_MODEL: "alpha",
        AI_FALLBACK_BASE_URL: fallback.url, AI_FALLBACK_API_KEY: "k2", AI_FALLBACK_MODEL: "beta" },
      async () => {
        await assert.rejects(
          () => makeLlmClient().complete(msg, 120),
          (e: Error) => e.message.includes("alpha") && e.message.includes("beta"),
        );
      },
    );
  } finally {
    await primary.close(); await fallback.close();
  }
});

test("a dead host falls through — a provider can be unreachable, not just busy", async () => {
  const fallback = await stubProvider("from fallback");
  try {
    await withEnv(
      { AI_BASE_URL: "http://127.0.0.1:1/v1", AI_API_KEY: "k1",
        AI_FALLBACK_BASE_URL: fallback.url, AI_FALLBACK_API_KEY: "k2" },
      async () => {
        assert.equal(await makeLlmClient().complete(msg, 120), "from fallback");
      },
    );
  } finally {
    await fallback.close();
  }
});

test("the request on the wire is what an OpenAI-compatible provider expects", async () => {
  const primary = await stubProvider("ok");
  try {
    await withEnv(
      { AI_BASE_URL: primary.url, AI_API_KEY: "secret-key", AI_MODEL: "llama-3.3-70b-versatile" },
      async () => { await makeLlmClient().complete(msg, 120, 0.3); },
    );
    assert.equal(primary.lastBody.model, "llama-3.3-70b-versatile");
    assert.equal(primary.lastBody.max_tokens, 120);
    assert.equal(primary.lastBody.temperature, 0.3);
    assert.deepEqual(primary.lastBody.messages, msg);
  } finally {
    await primary.close();
  }
});

test("nothing configured is an explicit error, not a crash", async () => {
  await withEnv(
    { AI_BASE_URL: undefined, AI_API_KEY: undefined, AI_FALLBACK_BASE_URL: undefined, AI_FALLBACK_API_KEY: undefined },
    async () => {
      assert.throws(() => makeLlmClient(), /No LLM configured/);
    },
  );
});
