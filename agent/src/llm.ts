/**
 * One call shape, several providers.
 *
 * The agent needs a small JSON decision every 30 seconds and a short chat reply
 * — a few hundred tokens either way, a handful of calls per duel. That fits
 * inside every free tier worth having, so the useful thing is not picking one
 * provider but making the key you happen to hold work without a code change.
 *
 * Two backends:
 *
 *   MISTRAL_API_KEY            the original, via @mistralai/mistralai
 *   AI_BASE_URL + AI_API_KEY   anything speaking OpenAI chat-completions —
 *                              Groq, Cerebras, OpenRouter, SambaNova, OpenAI,
 *                              a local Ollama
 *
 * AI_BASE_URL wins when both are set. The OpenAI path is plain fetch on purpose:
 * that wire format is stable and shared by every provider above, and adding an
 * SDK to reach it would buy nothing.
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

export function makeLlmClient(): LlmClient {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;

  if (baseUrl && apiKey) {
    return new OpenAiCompatible(baseUrl, apiKey, process.env.AI_MODEL || "llama-3.3-70b-versatile");
  }

  const mistralKey = process.env.MISTRAL_API_KEY;
  if (mistralKey) {
    return new MistralBackend(mistralKey, process.env.AI_MODEL || "mistral-small-latest");
  }

  throw new NoLlmConfigured();
}
