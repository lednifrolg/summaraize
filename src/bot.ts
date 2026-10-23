// Bot entry point: `npm start`. Serves `/summary` in every server the bot is in, with the one
// Anthropic API key from the environment.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import { Client, Events, GatewayIntentBits } from "discord.js";
import { AUTO, parseLanguageSetting } from "./language.ts";
import { SummaryCommand, summaryCommand } from "./summary-command.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is missing in .env`);
    process.exit(1);
  }
  return value;
}

function languageSetting(): string {
  const value = process.env.SUMMARY_LANGUAGE || AUTO;
  try {
    return parseLanguageSetting(value);
  } catch {
    console.error(
      `SUMMARY_LANGUAGE must be "auto" or a language code such as "sk", not "${value}"`,
    );
    process.exit(1);
  }
}

const token = required("DISCORD_TOKEN");
const language = languageSetting();
const summary = new SummaryCommand({
  apiKey: required("ANTHROPIC_API_KEY"),
  language,
  timeZone: process.env.TIMEZONE || "Europe/Bratislava",
  tier: "better",
  effort: "medium",
  minReactions: 3,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  // Overwrites the global command list, so a renamed or removed command disappears too.
  await ready.application.commands.set([summaryCommand.toJSON()]);
  console.log(
    `Logged in as ${ready.user.tag} in ${ready.guilds.cache.size} servers, summary language: ${language}`,
  );
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === summaryCommand.name) {
    summary.handle(interaction).catch((error) => console.error("unhandled /summary error", error));
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    client.destroy().finally(() => process.exit(0));
  });
}

await client.login(token);
