// Turns Discord's raw message markup (`<@123>`, `<:emoji:456>`, `<t:1700000000:R>`, ...)
// into the readable form a member sees in the client.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import { DateFormat } from "./dates.ts";

export interface MarkupNames {
  user(id: string): string | undefined;
  role(id: string): string | undefined;
  channel(id: string): string | undefined;
}

const MARKUP =
  /<@!?(?<user>\d+)>|<@&(?<role>\d+)>|<#(?<channel>\d+)>|<a?:(?<emoji>\w+):\d+>|<t:(?<time>-?\d+)(?::[tTdDfFsSR])?>|<\/(?<command>[\w -]+):\d+>/g;

export function resolveMarkup(content: string, names: MarkupNames, timeZone: string): string {
  const dates = new DateFormat(timeZone);
  return content.replace(MARKUP, (_match, ...args) => {
    const groups: Record<string, string | undefined> = args.at(-1);
    if (groups.user) return `@${names.user(groups.user) ?? "unknown-user"}`;
    if (groups.role) return `@${names.role(groups.role) ?? "unknown-role"}`;
    if (groups.channel) return `#${names.channel(groups.channel) ?? "unknown-channel"}`;
    if (groups.emoji) return `:${groups.emoji}:`;
    if (groups.time) return dates.dateTime(new Date(Number(groups.time) * 1000));
    return `/${groups.command}`;
  });
}
