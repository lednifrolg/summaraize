// Summary language. "auto" lets the model write in the language most messages are in, which is
// the only way to serve Slovak servers: Discord has no Slovak locale, so neither the server's
// nor the members' Discord language can tell the bot the server is Slovak.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

export const AUTO = "auto";

/** `auto` or a canonical BCP 47 tag such as `sk`; throws a RangeError for anything else. */
export function parseLanguageSetting(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === AUTO) return AUTO;
  const [tag] = Intl.getCanonicalLocales(trimmed);
  if (!tag) throw new RangeError(`Not a language code: ${value}`);
  return tag;
}

/** The primary language of a code such as `sk` or `en-US`, or null if it is not a code. */
export function primaryLanguage(code: string): string | null {
  try {
    const [tag] = Intl.getCanonicalLocales(code.trim());
    return tag ? new Intl.Locale(tag).language : null;
  } catch {
    return null;
  }
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
