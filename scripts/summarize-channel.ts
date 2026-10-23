// Summarizes a channel window from the command line, without going through the slash command,
// and writes the transcript and the summaries to out/. Meant for tuning the prompt and comparing
// model tiers and effort levels on real channels.
//
//   npm run summarize -- --channel <id> --days 7 [--until 2025-06-30] [--tier cheap|better|both]
//                        [--effort low|medium|high] [--language auto|sk|...] [--min-reactions 3]
//                        [--context-days 3] [--dry-run]
//
// --until ends the window at a past date instead of now, for channels that went quiet.
// --context-days 0 sends the period alone, without earlier messages as context.
// --dry-run stops after the transcript, without calling Claude.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { DateFormat } from "../src/dates.ts";
import { DEFAULT_CONTEXT, fetchChannelLog } from "../src/discord-fetch.ts";
import { parseLanguageSetting } from "../src/language.ts";
import { sanitizeSummary } from "../src/output.ts";
import { type Effort, MODELS, summarize, type Tier } from "../src/summarize.ts";
import { buildTranscript } from "../src/transcript.ts";

const OUT_DIR = "out";
const MAX_MESSAGES = 10_000;
const MAX_INPUT_TOKENS = 400_000;

const { values: args } = parseArgs({
  options: {
    channel: { type: "string" },
    days: { type: "string" },
    until: { type: "string" },
    tier: { type: "string", default: "both" },
    effort: { type: "string", default: "medium" },
    language: { type: "string", default: "auto" },
    "min-reactions": { type: "string", default: "3" },
    "context-days": { type: "string", default: String(DEFAULT_CONTEXT.days) },
    "dry-run": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const days = Number(args.days);
const minReactions = Number(args["min-reactions"]);
const contextDays = Number(args["context-days"]);
const tiers: Tier[] =
  args.tier === "both" ? ["cheap", "better"] : args.tier === "cheap" ? ["cheap"] : ["better"];
if (!args.channel) fail("--channel <id> is required");
if (!Number.isInteger(days) || days < 1 || days > 30) fail("--days must be a whole number 1-30");
const until = args.until ? new Date(args.until) : new Date();
if (Number.isNaN(until.getTime())) fail("--until must be a date such as 2025-06-30");
if (!["both", "cheap", "better"].includes(args.tier)) fail("--tier must be cheap, better or both");
if (!["low", "medium", "high"].includes(args.effort)) fail("--effort must be low, medium or high");
if (!Number.isInteger(minReactions) || minReactions < 1) fail("--min-reactions must be >= 1");
if (!Number.isInteger(contextDays) || contextDays < 0) fail("--context-days must be >= 0");
const language = (() => {
  try {
    return parseLanguageSetting(args.language);
  } catch {
    return fail('--language must be "auto" or a language code such as "sk"');
  }
})();

const discordToken = process.env.DISCORD_TOKEN || fail("DISCORD_TOKEN is missing in .env");
const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
if (!args["dry-run"] && !apiKey) fail("ANTHROPIC_API_KEY is missing in .env (or use --dry-run)");
const timeZone = process.env.TIMEZONE || "Europe/Bratislava";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
try {
  const ready = once(client, Events.ClientReady);
  await client.login(discordToken);
  await ready;

  const channel = await client.channels.fetch(args.channel);
  if (!channel?.isTextBased() || channel.isDMBased()) fail("Not a server text channel or thread");

  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const fetchStarted = performance.now();
  const log = await fetchChannelLog(channel, {
    since,
    until,
    context: { ...DEFAULT_CONTEXT, days: contextDays },
    minReactions,
    maxMessages: MAX_MESSAGES,
    timeZone,
  });
  const transcript = buildTranscript(log, timeZone);
  const fetchSeconds = (performance.now() - fetchStarted) / 1000;

  const end = args.until ? `-until-${until.toISOString().slice(0, 10)}` : "";
  const stem = `${OUT_DIR}/${channel.name.replace(/[^\w-]/g, "_")}-${days}d${end}`;
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${stem}-transcript.txt`, `${transcript.text}\n`);
  console.log(
    `#${channel.name}: ${transcript.messageCount} messages + ${transcript.contextCount} context, ` +
      `${log.threads.length} threads, ` +
      `${transcript.participants.length} people, ${transcript.text.length} chars, ` +
      `fetched in ${fetchSeconds.toFixed(1)} s -> ${stem}-transcript.txt`,
  );
  const tiersToRun = args["dry-run"] || transcript.messageCount === 0 ? [] : tiers;

  const dates = new DateFormat(timeZone);
  const period = `${dates.dateTime(since)} - ${dates.dateTime(until)} (${timeZone})`;
  for (const tier of tiersToRun) {
    const started = performance.now();
    const summary = await summarize({
      apiKey,
      tier,
      effort: args.effort as Effort,
      language,
      timeZone,
      minReactions,
      channelName: channel.name,
      period,
      transcript: transcript.text,
      maxInputTokens: MAX_INPUT_TOKENS,
    });
    const seconds = (performance.now() - started) / 1000;
    const text = sanitizeSummary(summary.text, transcript.urls);
    const file = `${stem}-${tier}-${args.effort}.md`;
    await writeFile(file, `${text}\n`);
    console.log(
      `\n===== ${MODELS[tier]} (served by ${summary.model}), effort ${args.effort}, ` +
        `language ${language} -> ${summary.language}: ` +
        `${summary.inputTokens} in / ${summary.outputTokens} out tokens, ` +
        `~$${summary.costUsd.toFixed(4)}, ${seconds.toFixed(1)} s -> ${file}\n\n${text}`,
    );
  }
} finally {
  await client.destroy();
}
