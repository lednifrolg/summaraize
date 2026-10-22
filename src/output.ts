// Turns what the model wrote into Discord messages.
//
// sanitizeSummary() is the last line of defense for the case a channel message managed to
// steer the model. The model can only produce text, so the damage it could do is limited to
// links nobody posted and mass pings; both are removed. Pings are additionally blocked by
// sending every message with empty `allowed_mentions`. Links the bot adds itself (citations)
// are added afterwards, so they never pass through the URL check.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MessageRef } from "./transcript.ts";
import { extractUrls } from "./transcript.ts";

export const DISCORD_MESSAGE_LIMIT = 2000;
export const REMOVED_LINK = "[link removed]";

const MASKED_LINK = /\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"'`()[\]]+/g;
const MASS_MENTION = /@(everyone|here)/g;
const ZERO_WIDTH_SPACE = "​";
const CITATION = /(?<![\w/#[])#(\d+)\b/g;
const HEADING = /^#{1,3} /;

export function sanitizeSummary(text: string, allowedUrls: ReadonlySet<string>): string {
  const isAllowed = (url: string) => extractUrls(url).every((clean) => allowedUrls.has(clean));
  return (
    text
      // Masked links can hide any target behind harmless text, so they become plain text.
      .replace(MASKED_LINK, (_match, label: string, url: string) =>
        isAllowed(url) ? `${label} ${url}` : label,
      )
      .replace(URL_PATTERN, (url) => (isAllowed(url) ? url : REMOVED_LINK))
      .replace(MASS_MENTION, `@${ZERO_WIDTH_SPACE}$1`)
  );
}

/** Makes every `#12` the transcript knows a jump link that scrolls Discord to that message. */
export function linkCitations(text: string, refs: readonly MessageRef[], guildId: string): string {
  return text.replace(CITATION, (citation, number: string) => {
    const ref = refs[Number(number) - 1];
    return ref
      ? `[#${number}](https://discord.com/channels/${guildId}/${ref.channelId}/${ref.messageId})`
      : citation;
  });
}

/**
 * Splits text into Discord-sized messages at line breaks, so links and markdown stay intact.
 * A heading never ends a message; it moves to the next one together with its content.
 */
export function splitForDiscord(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const fits = (lines: string[], piece: string) => [...lines, piece].join("\n").length <= limit;
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const piece of text.split("\n").flatMap((line) => splitLongLine(line, limit))) {
    if (!fits(current, piece)) {
      const last = current.at(-1);
      const heading =
        current.length > 1 && last !== undefined && HEADING.test(last) && fits([last], piece)
          ? last
          : null;
      if (heading !== null) current.pop();
      chunks.push(current);
      current = heading !== null ? [heading] : [];
    }
    current.push(piece);
  }
  chunks.push(current);
  return chunks.map((lines) => lines.join("\n").trim()).filter(Boolean);
}

// Only a single line longer than a whole message needs this; it breaks at spaces, which links
// never contain.
function splitLongLine(line: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > limit) {
    const space = rest.lastIndexOf(" ", limit);
    const cut = space > 0 ? space : limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}
