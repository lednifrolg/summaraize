// One Claude call per summary, always with an explicitly passed key, so the client never falls
// back to whatever Anthropic credentials happen to exist on the host.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserTurn } from "./prompt.ts";

export const MODELS = {
  cheap: "claude-haiku-5-5",
  better: "claude-sonnet-5-5",
} as const;

export type Tier = keyof typeof MODELS;
export type Effort = "low" | "medium" | "high";

export interface SummaryRequest {
  apiKey: string;
  tier: Tier;
  effort: Effort;
  language: string;
  timeZone: string;
  minReactions: number;
  channelName: string;
  period: string;
  transcript: string;
  maxInputTokens: number;
}

export interface Summary {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type SummaryFailure = "too_long" | "refused" | "truncated";

export class SummaryError extends Error {
  readonly reason: SummaryFailure;

  constructor(reason: SummaryFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

export async function summarize(request: SummaryRequest): Promise<Summary> {
  const client = new Anthropic({ apiKey: request.apiKey });
  const model = MODELS[request.tier];
  const system = buildSystemPrompt(request);
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildUserTurn(request.channelName, request.period, request.transcript),
    },
  ];

  const { input_tokens } = await client.messages.countTokens({ model, system, messages });
  if (input_tokens > request.maxInputTokens) {
    throw new SummaryError(
      "too_long",
      `Transcript has ${input_tokens} tokens, the limit is ${request.maxInputTokens}`,
    );
  }

  const response = await client.beta.messages
    .stream({
      model,
      max_tokens: 64000,
      system,
      messages,
      output_config: { effort: request.effort },
      // Sonnet can hand a declined request to another model server-side; Haiku has no fallback.
      ...(request.tier === "better"
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    })
    .finalMessage();

  if (response.stop_reason === "refusal") {
    throw new SummaryError(
      "refused",
      `Model declined: ${response.stop_details?.category ?? "no category"}`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new SummaryError("truncated", "Summary hit the output token limit");
  }

  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage;
  return {
    text,
    model: response.model,
    inputTokens,
    outputTokens,
    costUsd: costUsd(request.tier, inputTokens, outputTokens),
  };
}

// USD per million tokens, from the Anthropic price list (2026-10-06). Haiku prompts over
// 100K tokens are billed on a higher rate card.
export function costUsd(tier: Tier, inputTokens: number, outputTokens: number): number {
  const [input, output] =
    tier === "better" ? [2, 10] : inputTokens > 100_000 ? [0.5, 2.5] : [0.1, 0.5];
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}
