// Collects a channel window from Discord into the plain data the transcript is built from.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  type AnyThreadChannel,
  ChannelType,
  DiscordAPIError,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  type MessageMentions,
  MessageType,
  type NewsChannel,
  SnowflakeUtil,
  type TextChannel,
  type User,
} from "discord.js";
import { resolveMarkup } from "./discord-markup.ts";
import type {
  ChannelLog,
  ChatMessage,
  Note,
  ReactionGroup,
  ReplyTarget,
  ThreadLog,
} from "./transcript.ts";

export interface FetchOptions {
  since: Date;
  /** End of the window; now when omitted. */
  until?: Date;
  /** Distinct reactors a message needs before its reactions are included. */
  minReactions: number;
  /** Upper bound on fetched messages across the channel and its threads. */
  maxMessages: number;
  timeZone: string;
}

export class TooManyMessagesError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`More than ${limit} messages in the requested period`);
    this.limit = limit;
  }
}

const PAGE_SIZE = 100;

// Everything else is a system message (joins, pins, thread created, ...).
const CONVERSATION_TYPES = new Set([
  MessageType.Default,
  MessageType.Reply,
  MessageType.ChatInputCommand,
  MessageType.ContextMenuCommand,
]);

export async function fetchChannelLog(
  channel: GuildTextBasedChannel,
  options: FetchOptions,
): Promise<ChannelLog> {
  const fetcher = new WindowFetcher(channel.guild, options);
  const messages = await fetcher.messages(channel);

  const threads: ThreadLog[] = [];
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
    for (const thread of await threadsActiveSince(channel, options.since)) {
      const threadMessages = await fetcher.messages(thread).catch(skipMissingAccess);
      if (threadMessages.length > 0) {
        threads.push({ id: thread.id, name: thread.name, messages: threadMessages });
      }
    }
    threads.sort(
      (a, b) =>
        (a.messages[0]?.createdAt.getTime() ?? 0) - (b.messages[0]?.createdAt.getTime() ?? 0),
    );
  }

  return { id: channel.id, name: channel.name, messages, threads };
}

// A private or restricted thread the bot cannot read is left out rather than failing the summary.
function skipMissingAccess(error: unknown): ChatMessage[] {
  if (error instanceof DiscordAPIError && error.status === 403) return [];
  throw error;
}

async function threadsActiveSince(
  channel: TextChannel | NewsChannel,
  since: Date,
): Promise<AnyThreadChannel[]> {
  const found = new Map<string, AnyThreadChannel>();
  for (const thread of (await channel.threads.fetchActive(false)).threads.values()) {
    found.set(thread.id, thread);
  }
  // Archived threads come newest-archived first; a thread archived before the window cannot
  // hold messages from inside it, because posting unarchives a thread.
  let before: Date | undefined;
  for (;;) {
    const page = await channel.threads.fetchArchived(
      { type: "public", before, limit: PAGE_SIZE },
      false,
    );
    let oldest: Date | null = null;
    for (const thread of page.threads.values()) {
      found.set(thread.id, thread);
      oldest = thread.archivedAt ?? oldest;
    }
    if (!page.hasMore || oldest === null || oldest < since) break;
    before = oldest;
  }
  return [...found.values()].filter(
    (thread) =>
      thread.type !== ChannelType.PrivateThread && lastActivity(thread) >= since.getTime(),
  );
}

function lastActivity(thread: AnyThreadChannel): number {
  return thread.lastMessageId
    ? SnowflakeUtil.timestampFrom(thread.lastMessageId)
    : (thread.createdTimestamp ?? 0);
}

class WindowFetcher {
  #guild: Guild;
  #options: FetchOptions;
  #fetched = 0;
  #names = new Map<string, Promise<string>>();
  #resolvedNames = new Map<string, string>();

  constructor(guild: Guild, options: FetchOptions) {
    this.#guild = guild;
    this.#options = options;
  }

  async messages(channel: GuildTextBasedChannel): Promise<ChatMessage[]> {
    const ownId = this.#guild.client.user.id;
    const raw = (await this.#fetchSince(channel)).filter(
      (message) => CONVERSATION_TYPES.has(message.type) && message.author.id !== ownId,
    );
    const inWindow = new Set(raw.map((message) => message.id));
    const converted: ChatMessage[] = [];
    for (const message of raw) converted.push(await this.#convert(message, inWindow));
    return converted;
  }

  /** Oldest first. */
  async #fetchSince(channel: GuildTextBasedChannel): Promise<Message<true>[]> {
    const since = this.#options.since.getTime();
    const { until } = this.#options;
    const newestFirst: Message<true>[] = [];
    let before = until ? SnowflakeUtil.generate({ timestamp: until }).toString() : undefined;
    for (;;) {
      const page = await channel.messages.fetch({ limit: PAGE_SIZE, before, cache: false });
      for (const message of page.values()) {
        if (message.createdTimestamp < since) return newestFirst.reverse();
        this.#fetched += 1;
        if (this.#fetched > this.#options.maxMessages) {
          throw new TooManyMessagesError(this.#options.maxMessages);
        }
        newestFirst.push(message);
      }
      if (page.size < PAGE_SIZE) return newestFirst.reverse();
      before = page.lastKey();
    }
  }

  async #convert(message: Message<true>, inWindow: Set<string>): Promise<ChatMessage> {
    const notes: Note[] = [];
    for (const attachment of message.attachments.values()) {
      notes.push({
        kind: "attachment",
        type: attachmentType(attachment.contentType),
        name: attachment.name,
      });
    }
    for (const sticker of message.stickers.values()) {
      notes.push({ kind: "sticker", name: sticker.name });
    }
    // Embeds on human messages are link previews of URLs already in the text.
    if (message.author.bot) {
      for (const embed of message.embeds) {
        if (embed.title || embed.description) {
          notes.push({
            kind: "embed",
            title: embed.title ?? "",
            description: embed.description ?? "",
          });
        }
      }
    }
    if (message.poll) {
      notes.push({
        kind: "poll",
        question: message.poll.question.text ?? "",
        answers: message.poll.answers.map((answer) => ({
          text: answer.text ?? "",
          votes: answer.voteCount ?? 0,
        })),
      });
    }
    for (const snapshot of message.messageSnapshots.values()) {
      if (snapshot.content) {
        notes.push({
          kind: "forwarded",
          text: await this.#text(snapshot.content, snapshot.mentions),
        });
      }
    }

    let replyTo: ReplyTarget | null = null;
    const targetId = message.reference?.messageId;
    if (message.type === MessageType.Reply && targetId) {
      replyTo = inWindow.has(targetId)
        ? { messageId: targetId, author: null, text: null }
        : await this.#replyTarget(message, targetId);
    }

    return {
      id: message.id,
      createdAt: message.createdAt,
      author: await this.#author(message),
      isBot: message.author.bot,
      text: await this.#text(message.content, message.mentions),
      notes,
      replyTo,
      reactions: await this.#reactions(message),
    };
  }

  async #replyTarget(message: Message<true>, targetId: string): Promise<ReplyTarget> {
    try {
      const target = await message.fetchReference();
      return {
        messageId: targetId,
        author: await this.#author(target),
        text: await this.#text(target.content, target.mentions),
      };
    } catch (error) {
      if (error instanceof DiscordAPIError)
        return { messageId: targetId, author: null, text: null };
      throw error;
    }
  }

  async #reactions(message: Message<true>): Promise<ReactionGroup[]> {
    const reactions = [...message.reactions.cache.values()];
    const total = reactions.reduce((sum, reaction) => sum + reaction.count, 0);
    if (total < this.#options.minReactions) return [];

    const reactors = new Set<string>();
    const groups: ReactionGroup[] = [];
    for (const reaction of reactions) {
      const users = await reaction.users.fetch({ limit: 100 });
      const names: string[] = [];
      for (const user of users.values()) {
        reactors.add(user.id);
        names.push(await this.#name(user));
      }
      groups.push({
        emoji: reaction.emoji.name ?? "?",
        custom: reaction.emoji.id !== null,
        users: names,
        more: Math.max(0, reaction.count - users.size),
      });
    }
    // The total counts one person reacting with three emoji three times.
    return reactors.size >= this.#options.minReactions ? groups : [];
  }

  async #text(content: string, mentions: MessageMentions): Promise<string> {
    for (const user of mentions.users.values()) await this.#name(user);
    const guild = this.#guild;
    return resolveMarkup(
      content,
      {
        user: (id) => this.#resolvedNames.get(id),
        role: (id) => guild.roles.cache.get(id)?.name,
        channel: (id) => guild.channels.cache.get(id)?.name,
      },
      this.#options.timeZone,
    );
  }

  #author(message: Message<true>): Promise<string> {
    // Webhook "users" are not guild members; their name is the webhook's display name.
    return message.webhookId
      ? Promise.resolve(message.author.username)
      : this.#name(message.author);
  }

  /** Server nickname, else global display name. One member lookup per user and fetch. */
  #name(user: User): Promise<string> {
    let name = this.#names.get(user.id);
    if (!name) {
      name = this.#guild.members
        .fetch(user.id)
        .then(
          (member) => member.displayName,
          () => user.displayName,
        )
        .then((resolved) => {
          this.#resolvedNames.set(user.id, resolved);
          return resolved;
        });
      this.#names.set(user.id, name);
    }
    return name;
  }
}

function attachmentType(contentType: string | null): "image" | "video" | "audio" | "file" {
  if (contentType?.startsWith("image/")) return "image";
  if (contentType?.startsWith("video/")) return "video";
  if (contentType?.startsWith("audio/")) return "audio";
  return "file";
}
