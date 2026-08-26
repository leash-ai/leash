/**
 * One call shape, several providers.
 *
 * The agent needs a small JSON decision every 30 seconds and a short chat reply
 * — a few hundred tokens either way, a handful of calls per duel. That fits
 * inside every free tier worth having, so the useful thing is not picking one
 * provider but making the key you happen to hold work without a code change.
 *
 * Backends, tried in order and configured independently:
 *
 *   AI_*            primary — anything speaking OpenAI chat-completions: Groq,
 *                   xAI, Cerebras, OpenRouter, SambaNova, OpenAI, local Ollama
 *   AI_FALLBACK_*   second, used when the primary is unavailable
 *   MISTRAL_API_KEY last resort, via @mistralai/mistralai
 *
 * Configure two and a spent daily cap or a rate limit stops being an outage. The
 * OpenAI path is plain fetch on purpose: that wire format is stable and shared by
 * every provider above, and an SDK to reach it would buy nothing.
 */
import { Mistral } from "@mistralai/mistralai";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  /** Human-readable, for logs and error messages. */
  readonly describe: string;
  complete(messages: ChatMessage[], maxTokens: number, temperature?: number): Promise<string>;
}

class OpenAiCompatible implements LlmClient {
  readonly describe: string;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {
    this.describe = `${model} at ${baseUrl.replace(/^https?:\/\//, "").split("/")[0]}`;
  }

  async complete(messages: ChatMessage[], maxTokens: number, temperature = 0.3): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      // Keep the status in the message: the caller classifies 402 and 401 into
      // advice about which key to fix, and a bare "request failed" defeats that.
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  }
}

class MistralBackend implements LlmClient {
  readonly describe: string;
  private client: Mistral;

  constructor(apiKey: string, private model: string) {
    this.client = new Mistral({ apiKey });
    this.describe = `${model} at mistral.ai`;
  }

  async complete(messages: ChatMessage[], maxTokens: number, temperature = 0.3): Promise<string> {
    const res = await this.client.chat.complete({
      model: this.model,
      messages: messages as any,
      maxTokens,
      temperature,
    });
    const content = res.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return (content as any[]).map((c) => c.text ?? "").join("");
    return "";
  }
}

/** Thrown at construction when nothing is configured, so the reason reaches the UI. */
export class NoLlmConfigured extends Error {
  constructor() {
    super(
      "No LLM configured. Set AI_BASE_URL + AI_API_KEY + AI_MODEL for any " +
        "OpenAI-compatible provider (Groq, Cerebras, OpenRouter…), or MISTRAL_API_KEY.",
    );
  }
}

/**
 * Tries each backend in turn and returns the first answer it gets.
 *
 * Free tiers fail in ways that are worth surviving rather than reporting: a
 * daily cap resets tomorrow, a rate limit resets in seconds, a promotional
 * credit runs out one day without warning. With two providers configured, one of
 * those stops being an outage and becomes a line in the log.
 *
 * It does not fail over on everything. A malformed request fails the same way
 * everywhere, so retrying it against a second provider just doubles the latency
 * before the same error — only availability faults are worth a second attempt.
 */
class FailoverClient implements LlmClient {
  readonly describe: string;

  constructor(private backends: LlmClient[]) {
    this.describe = backends.map((b) => b.describe).join(" → ");
  }

  /** Faults where another provider might plausibly succeed. */
  private worthFailingOver(message: string): boolean {
    return /\b(401|402|403|408|409|429|5\d\d)\b/.test(message)
      || /quota|credit|insufficient|rate.?limit|unauthor|timeout|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed|aborted|overload|capacity|unavailable/i.test(message);
  }

  async complete(messages: ChatMessage[], maxTokens: number, temperature?: number): Promise<string> {
    const failures: string[] = [];

    for (let i = 0; i < this.backends.length; i++) {
      const backend = this.backends[i];
      try {
        const out = await backend.complete(messages, maxTokens, temperature);
        if (i > 0) console.warn(`[llm] ${failures.join("; ")} — served by ${backend.describe}`);
        return out;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        const last = i === this.backends.length - 1;
        if (!last && !this.worthFailingOver(msg)) throw e;
        failures.push(`${backend.describe} failed (${msg.slice(0, 80)})`);
        if (last) throw new Error(failures.join("; "));
      }
    }

    throw new NoLlmConfigured();
  }
}

function openAiBackend(prefix: string, defaultModel: string): LlmClient | null {
  const baseUrl = process.env[`${prefix}BASE_URL`];
  const apiKey = process.env[`${prefix}API_KEY`];
  if (!baseUrl || !apiKey) return null;
  return new OpenAiCompatible(baseUrl, apiKey, process.env[`${prefix}MODEL`] || defaultModel);
}

/**
 * Backends in priority order, from whatever is configured:
 *
 *   AI_BASE_URL / AI_API_KEY / AI_MODEL                      primary
 *   AI_FALLBACK_BASE_URL / AI_FALLBACK_API_KEY / …_MODEL     used if the primary
 *                                                            is unavailable
 *   MISTRAL_API_KEY                                          last resort
 */
export function makeLlmClient(): LlmClient {
  const backends: LlmClient[] = [];

  const primary = openAiBackend("AI_", "llama-3.3-70b-versatile");
  if (primary) backends.push(primary);

  const fallback = openAiBackend("AI_FALLBACK_", "grok-4.6");
  if (fallback) backends.push(fallback);

  const mistralKey = process.env.MISTRAL_API_KEY;
  if (mistralKey) {
    backends.push(new MistralBackend(mistralKey, process.env.MISTRAL_MODEL || "mistral-small-latest"));
  }

  if (backends.length === 0) throw new NoLlmConfigured();
  return backends.length === 1 ? backends[0] : new FailoverClient(backends);
}
