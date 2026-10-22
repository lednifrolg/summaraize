// Builds the plain-text transcript of a channel window. It is the only thing the model sees
// besides the system prompt.
//
// Injection safety lives here and nowhere else: buildTranscript() trusts none of its input.
// Every user-controlled string (message text, file names, thread names, poll and embed texts)
// is written as an escaped JSON string literal, and every name goes through cleanName(). So
// one message is always exactly one line, and user text can never forge transcript structure
// such as a fake message line, a day header or a closing tag.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import { DateFormat } from "./dates.ts";

export interface ReactionGroup {
  /** Unicode emoji, or the name of a custom emoji. */
  emoji: string;
  custom: boolean;
  users: string[];
  /** Reactors counted by Discord but not listed in `users`. */
  more: number;
}

export interface ReplyTarget {
  messageId: string;
  /**
   * Author and text of a target outside the window. Null for a target inside the window (the
   * transcript points at it by number) and for a deleted or unavailable one.
   */
  author: string | null;
  text: string | null;
}

export type Note =
  | { kind: "attachment"; type: "image" | "video" | "audio" | "file"; name: string }
  | { kind: "sticker"; name: string }
  | { kind: "embed"; title: string; description: string }
  | { kind: "poll"; question: string; answers: { text: string; votes: number }[] }
  | { kind: "forwarded"; text: string };

export interface ChatMessage {
  id: string;
  createdAt: Date;
  author: string;
  isBot: boolean;
  /** Message text with Discord markup already resolved to readable names. */
  text: string;
  notes: Note[];
  replyTo: ReplyTarget | null;
  /** Only filled for messages that drew enough reactions to matter. */
  reactions: ReactionGroup[];
}

export interface ThreadLog {
  /** Same as the starter message ID when the thread was started from a message. */
  id: string;
  name: string;
  messages: ChatMessage[];
}

export interface ChannelLog {
  id: string;
  name: string;
  messages: ChatMessage[];
  threads: ThreadLog[];
}

export interface MessageRef {
  channelId: string;
  messageId: string;
}

export interface Transcript {
  text: string;
  /** `refs[n - 1]` is the message the transcript calls `#n`. */
  refs: MessageRef[];
  messageCount: number;
  /** Distinct human authors, most active first. */
  participants: string[];
  /** Every URL that appears in a message, the only links a summary may repeat. */
  urls: Set<string>;
}

const REPLY_EXCERPT_LENGTH = 150;
const EMBED_TEXT_LENGTH = 300;
const NAME_LENGTH = 32;

// Characters that could break a name out of its place in a line, plus Discord markdown.
const NAME_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"#:;,()[\]<>@=\\`*~|]/gu;
const EMOJI_FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}\s"#:;,()[\]<>@=\\`]/gu;
// Left unescaped by JSON.stringify, but read as line breaks or reorder text visually.
const QUOTE_ESCAPED = /[\u0080-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const URL_PATTERN = /https?:\/\/[^\s<>"'`()[\]]+/g;
const URL_TRAILING_PUNCTUATION = /[.,;:!?]+$/;

export function cleanName(raw: string): string {
  // Whitespace first, so a tab or line break between words becomes a space instead of vanishing.
  const flat = raw.replace(/\s+/g, " ").replace(NAME_FORBIDDEN, "").replace(/ {2,}/g, " ");
  const name = Array.from(flat.trim()).slice(0, NAME_LENGTH).join("").trim();
  return name || "unknown";
}

export function quote(text: string): string {
  return JSON.stringify(text).replace(
    QUOTE_ESCAPED,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function extractUrls(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map((url) => url.replace(URL_TRAILING_PUNCTUATION, ""));
}

function excerpt(text: string, length: number): string {
  const chars = Array.from(text);
  return chars.length > length ? `${chars.slice(0, length).join("")}…` : text;
}

function emojiLabel(reaction: ReactionGroup): string {
  const emoji = reaction.emoji.replace(EMOJI_FORBIDDEN, "") || "?";
  return reaction.custom ? `:${emoji}:` : emoji;
}

function formatNote(note: Note): string {
  switch (note.kind) {
    case "attachment":
      return `[${note.type} ${quote(note.name)}]`;
    case "sticker":
      return `[sticker ${quote(note.name)}]`;
    case "embed":
      return `[embed ${quote(excerpt(note.title, EMBED_TEXT_LENGTH))} ${quote(excerpt(note.description, EMBED_TEXT_LENGTH))}]`;
    case "poll": {
      const answers = note.answers
        .map((answer) => `${quote(answer.text)} ${answer.votes}`)
        .join(", ");
      return `[poll ${quote(note.question)} votes: ${answers}]`;
    }
    case "forwarded":
      return `[forwarded ${quote(note.text)}]`;
  }
}

function noteText(note: Note): string {
  switch (note.kind) {
    case "embed":
      return note.description;
    case "forwarded":
      return note.text;
    default:
      return "";
  }
}

export function buildTranscript(log: ChannelLog, timeZone: string): Transcript {
  const dates = new DateFormat(timeZone);
  const refs: MessageRef[] = [];
  const localIds = new Map<string, number>();
  const authorsById = new Map<string, string>();
  const activity = new Map<string, number>();
  const urls = new Set<string>();

  const sections = [
    { channelId: log.id, thread: null, messages: log.messages },
    ...log.threads.map((thread) => ({
      channelId: thread.id,
      thread,
      messages: thread.messages,
    })),
  ];
  // Numbers are assigned up front so a thread header can point at its starter message.
  for (const section of sections) {
    for (const message of section.messages) {
      refs.push({ channelId: section.channelId, messageId: message.id });
      localIds.set(message.id, refs.length);
      authorsById.set(message.id, cleanName(message.author));
    }
  }
  const threadNames = new Map(log.threads.map((thread) => [thread.id, thread.name]));

  const lines: string[] = [];
  for (const section of sections) {
    if (section.thread) {
      const starter = localIds.get(section.thread.id);
      const origin = starter ? ` (started from #${starter})` : "";
      lines.push("", `=== Thread ${quote(section.thread.name)}${origin} ===`);
    }
    let currentDay = "";
    for (const message of section.messages) {
      const day = dates.day(message.createdAt);
      if (day !== currentDay) {
        lines.push(`=== ${day} ===`);
        currentDay = day;
      }
      const author = cleanName(message.author);
      if (!message.isBot) activity.set(author, (activity.get(author) ?? 0) + 1);
      for (const text of [message.text, ...message.notes.map(noteText)]) {
        for (const url of extractUrls(text)) urls.add(url);
      }

      let head = `[${dates.time(message.createdAt)}] #${localIds.get(message.id)} ${author}`;
      if (message.isBot) head += " (bot)";
      if (message.replyTo) head += ` (${formatReply(message.replyTo, localIds, authorsById)})`;

      const parts = [`${head}:`];
      if (message.text) parts.push(quote(message.text));
      parts.push(...message.notes.map(formatNote));
      const threadName = threadNames.get(message.id);
      if (threadName !== undefined) parts.push(`[thread ${quote(threadName)}]`);
      lines.push(parts.join(" "));

      if (message.reactions.length > 0) {
        const groups = message.reactions.map((reaction) => {
          const who = [reaction.users.map(cleanName).join(", ")];
          if (reaction.more > 0) who.push(`+${reaction.more}`);
          return `${emojiLabel(reaction)} ${who.filter(Boolean).join(" ")}`;
        });
        lines.push(`  [reactions: ${groups.join("; ")}]`);
      }
    }
  }

  return {
    text: lines.join("\n"),
    refs,
    messageCount: refs.length,
    participants: [...activity.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    urls,
  };
}

function formatReply(
  reply: ReplyTarget,
  localIds: Map<string, number>,
  authorsById: Map<string, string>,
): string {
  const local = localIds.get(reply.messageId);
  if (local) return `reply to #${local} ${authorsById.get(reply.messageId)}`;
  if (reply.author === null || reply.text === null) return "reply to a deleted message";
  return `reply to ${cleanName(reply.author)}: ${quote(excerpt(reply.text, REPLY_EXCERPT_LENGTH))}`;
}
