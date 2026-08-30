/**
 * Designing a bot, without an agent server.
 *
 * Everything else here needs the chain or the agent runtime: placing a duel,
 * trading it, settling it. Building a bot needs neither — it is one model call
 * on a short conversation. Routing it through the agent server anyway made the
 * deployed site say "run this locally" at exactly the step the project is about,
 * so the same call runs here as a serverless function.
 *
 * The agent server still wins when it is configured: it is the same endpoint
 * shape, and pointing NEXT_PUBLIC_AGENT_URL at a running agent keeps a single
 * place holding the keys. This is the path for when there is no such server.
 *
 * The provider logic is a reduced copy of agent/src/llm.ts — same env vars, same
 * failover order — because the two are separate packages and Vercel only uploads
 * this one. Mistral goes through its OpenAI-compatible endpoint rather than the
 * SDK, which keeps the route dependency-free.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Kept identical to DESIGNER_PROMPT in agent/src/server.ts; see the note above.
const DESIGNER_PROMPT = `You help someone design an automated trading bot for a short duel — minutes, not days — on BTC, ETH and SOL.

Ask at most one short clarifying question. As soon as you have a usable idea, produce the bot: do not interrogate.

Reply with JSON only, no prose outside it:
{"reply":"<one or two sentences to the user>","ready":<true|false>,"name":"<2-3 word bot name>","strategy":"<precise instruction the trading agent follows: what to buy, when, how big, when to exit>"}

Set ready=false only while you are still asking. When ready=true, name and strategy must both be filled in. Keep strategy concrete and self-contained — it is handed to another agent with no memory of this conversation.

If a bot already appears earlier in this conversation and the user asks for
something better, different, or refined, produce a genuinely different bot: a new
name, and a mechanism that is not the previous one reworded. Changing the prose
while keeping the same trigger, the same sizing and the same exit is not a new
bot. Never reuse a name you have already proposed here.

The bot you design is handed to an agent that sees only spot prices for BTC, ETH,
SOL, BNB and AVAX, refreshed every 15 to 30 seconds, and can BUY or SELL a
percentage of its position. There is no order book, no volume, no leverage, no
shorting, no limit orders and no indicator it has not computed from those prices
itself. A strategy that needs any of those cannot be run, and the agent will hold
instead. Write triggers the agent can evaluate from a short recent price history.

Size every threshold to what a duel actually contains. These last two to ten
minutes, and spot crypto moves roughly 0.05% to 0.3% over that span — not 2%, not
5%. A trigger written for a daily chart never fires: the agent holds every tick,
the duel ends at 0.00%, and the person watching sees a flat line. Put entry
triggers around 0.05% to 0.2%, exits tighter still, and lookbacks of two to six
price points rather than tens.

Design for a bot that acts. A duel is short and a bot that waits for a perfect
setup will not get one. Prefer a strategy that takes a position in the first
minute and keeps adjusting: something to watch beats something correct that never
fires. Position sizes of 50% to 100% of
cash are normal for a game this short — a 5% position cannot show up before the
clock stops.`;

interface Backend {
  describe: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** AI_* first, AI_FALLBACK_* second, Mistral last — the order agent/src/llm.ts uses. */
function backends(): Backend[] {
  const out: Backend[] = [];
  const add = (prefix: string, defaultModel: string) => {
    const baseUrl = process.env[`${prefix}BASE_URL`];
    const apiKey = process.env[`${prefix}API_KEY`];
    if (!baseUrl || !apiKey) return;
    const model = process.env[`${prefix}MODEL`] || defaultModel;
    out.push({ baseUrl, apiKey, model, describe: `${model} at ${host(baseUrl)}` });
  };

  add("AI_", "qwen/qwen3.8-27b");
  add("AI_FALLBACK_", "grok-4.6");

  const mistral = process.env.MISTRAL_API_KEY;
  if (mistral) {
    const model = process.env.MISTRAL_MODEL || "mistral-small-latest";
    out.push({
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: mistral,
      model,
      describe: `${model} at api.mistral.ai`,
    });
  }
  return out;
}

const host = (url: string) => url.replace(/^https?:\/\//, "").split("/")[0];

/** Faults where another provider might plausibly succeed. A bad request is not one. */
const worthFailingOver = (message: string) =>
  /\b(401|402|403|408|409|429|5\d\d)\b/.test(message) ||
  /quota|credit|insufficient|rate.?limit|unauthor|timeout|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed|aborted|overload|capacity|unavailable/i.test(
    message,
  );

async function complete(messages: { role: string; content: string }[]): Promise<string> {
  const list = backends();
  if (list.length === 0) throw new Error("No LLM configured");

  const failures: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const last = i === list.length - 1;
    try {
      const res = await fetch(`${b.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${b.apiKey}` },
        body: JSON.stringify({
          model: b.model,
          messages,
          // Matches ai_agent.ts: naming wants variety, a trade decision does not.
          max_tokens: 500,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!last && !worthFailingOver(msg)) throw e;
      failures.push(`${b.describe} failed (${msg.slice(0, 80)})`);
      if (last) throw new Error(failures.join("; "));
    }
  }
  throw new Error("No LLM configured");
}

/**
 * The model is asked for JSON, so parse it — but never let a formatting slip
 * swallow the answer. Unparseable text is still shown: a chat that says
 * something unstructured beats a chat that says nothing.
 */
function parseDesign(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { reply: raw.trim() || "…", ready: false };
  try {
    const p = JSON.parse(match[0]);
    const ready = p.ready === true && !!p.name && !!p.strategy;
    const said = String(p.reply ?? "").trim();
    return {
      // Mirrors ai_agent.ts: a bot with no sentence beside it rendered as a bare
      // "…", which reads as the model having nothing to say about what it built.
      reply: said || (ready ? `Here is ${String(p.name)}.` : "…"),
      ready,
      name: ready ? String(p.name).slice(0, 40) : undefined,
      strategy: ready ? String(p.strategy).slice(0, 600) : undefined,
    };
  } catch {
    return { reply: raw.trim().slice(0, 400), ready: false };
  }
}

export async function POST(req: Request) {
  let messages: { role: string; content: string }[] | undefined;
  try {
    ({ messages } = await req.json());
  } catch {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  if (!messages?.length) return NextResponse.json({ error: "messages required" }, { status: 400 });

  try {
    const raw = await complete([
      { role: "system", content: DESIGNER_PROMPT },
      ...messages.slice(-12),
    ]);
    return NextResponse.json(parseDesign(raw));
  } catch (e) {
    const raw = String((e as Error)?.message ?? "");
    const unusable =
      raw.includes("No LLM configured") ||
      /\b(401|402|403)\b|subscription|quota|credit|insufficient|unauthor/i.test(raw);
    return NextResponse.json(
      {
        error: unusable
          ? "Designing a bot needs a working AI_API_KEY on the deployment."
          : `Design failed: ${raw.slice(0, 160)}`,
      },
      { status: unusable ? 503 : 500 },
    );
  }
}
