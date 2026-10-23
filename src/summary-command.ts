// The `/summary days:<1-30>` command: fetch the window, summarize it, post it publicly.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import Anthropic from "@anthropic-ai/sdk";
import {
  ApplicationIntegrationType,
  type ChatInputCommandInteraction,
  ContainerBuilder,
  type GuildTextBasedChannel,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { DateFormat } from "./dates.ts";
import { fetchChannelLog, TooManyMessagesError } from "./discord-fetch.ts";
import { replyLanguage, type Texts, textsFor } from "./i18n.ts";
import { linkCitations, sanitizeSummary, splitForDiscord } from "./output.ts";
import { type Effort, SummaryError, summarize, type Tier } from "./summarize.ts";
import { buildTranscript } from "./transcript.ts";

export const summaryCommand = new SlashCommandBuilder()
  .setName("summary")
  .setDescription("Summarize the messages of this channel from the last days")
  .setContexts(InteractionContextType.Guild)
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .addIntegerOption((option) =>
    option
      .setName("days")
      .setDescription("How many days back, 1-30")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(30),
  );

export interface SummaryConfig {
  apiKey: string;
  language: string;
  timeZone: string;
  tier: Tier;
  effort: Effort;
  minReactions: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 60_000;
const MAX_MESSAGES = 10_000;
const MAX_INPUT_TOKENS = 400_000;
// The summary is posted as a Components V2 card: it allows 4000 characters of text per message
// instead of 2000, which matters because every clickable `#12` costs ~90 characters of link.
const CARD_TEXT_LIMIT = 4000;
const CARD_ACCENT_COLOR = 0xf28c28;
// Mentions in anything the bot posts never turn into pings.
const NO_PINGS = { parse: [] };

export class SummaryCommand {
  #config: SummaryConfig;
  #running = new Set<string>();
  #lastStart = new Map<string, number>();
  /** Language of the last summary per channel, for replies that come before the next one. */
  #lastLanguage = new Map<string, string>();

  constructor(config: SummaryConfig) {
    this.#config = config;
  }

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    const texts = textsFor(
      replyLanguage(
        this.#config.language,
        this.#lastLanguage.get(interaction.channelId),
        interaction.locale,
      ),
    );
    const channel = interaction.inCachedGuild()
      ? (interaction.channel ?? (await interaction.guild.channels.fetch(interaction.channelId)))
      : null;
    if (!channel?.isTextBased()) {
      await interaction.reply({ content: texts.notHere, flags: MessageFlags.Ephemeral });
      return;
    }
    if (this.#running.has(channel.id)) {
      await interaction.reply({ content: texts.busy, flags: MessageFlags.Ephemeral });
      return;
    }
    const wait = (this.#lastStart.get(channel.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      await interaction.reply({
        content: texts.cooldown(Math.ceil(wait / 1000)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    this.#running.add(channel.id);
    this.#lastStart.set(channel.id, Date.now());
    try {
      await interaction.deferReply();
      const days = interaction.options.getInteger("days", true);
      const summary = await this.#summary(channel, days);
      if (summary === null) {
        await interaction.editReply({ content: texts.noMessages(days), allowedMentions: NO_PINGS });
        return;
      }
      const [first, ...rest] = splitForDiscord(summary, CARD_TEXT_LIMIT).map(summaryCard);
      if (first) await interaction.editReply(first);
      for (const card of rest) await interaction.followUp(card);
    } catch (error) {
      console.error("summary failed", { channel: channel.id }, error);
      await interaction
        .editReply({ content: errorText(error, texts), allowedMentions: NO_PINGS })
        .catch((replyError) => console.error("could not report the failure", replyError));
    } finally {
      this.#running.delete(channel.id);
    }
  }

  /** Header and summary text, or null when the window has no messages. */
  async #summary(channel: GuildTextBasedChannel, days: number): Promise<string | null> {
    const { timeZone } = this.#config;
    const started = performance.now();
    const until = new Date();
    const since = new Date(until.getTime() - days * DAY_MS);
    const log = await fetchChannelLog(channel, {
      since,
      until,
      minReactions: this.#config.minReactions,
      maxMessages: MAX_MESSAGES,
      timeZone,
    });
    const transcript = buildTranscript(log, timeZone);
    if (transcript.messageCount === 0) return null;

    const dates = new DateFormat(timeZone);
    const summary = await summarize({
      ...this.#config,
      channelName: channel.name,
      period: `${dates.dateTime(since)} - ${dates.dateTime(until)} (${timeZone})`,
      transcript: transcript.text,
      maxInputTokens: MAX_INPUT_TOKENS,
    });
    // Counts and cost only, never message content.
    console.log("summary", {
      guild: channel.guildId,
      channel: channel.id,
      days,
      messages: transcript.messageCount,
      language: summary.language,
      model: summary.model,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      costUsd: Number(summary.costUsd.toFixed(4)),
      seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    });

    const body = linkCitations(
      sanitizeSummary(summary.text, transcript.urls),
      transcript.refs,
      channel.guildId,
    );
    this.#lastLanguage.set(channel.id, summary.language);
    const header = textsFor(summary.language).header(
      days,
      transcript.messageCount,
      transcript.participants.length,
    );
    return `${header}\n\n${body}`;
  }
}

function summaryCard(text: string) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(CARD_ACCENT_COLOR)
        .addTextDisplayComponents((display) => display.setContent(text)),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_PINGS,
  } as const;
}

function errorText(error: unknown, texts: Texts): string {
  if (error instanceof TooManyMessagesError) return texts.tooManyMessages;
  if (error instanceof SummaryError) {
    if (error.reason === "too_long") return texts.tooManyMessages;
    if (error.reason === "refused") return texts.refused;
    return texts.failed;
  }
  if (error instanceof Anthropic.AuthenticationError) return texts.invalidKey;
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return texts.aiUnavailable;
  }
  return texts.failed;
}
