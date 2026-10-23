// Texts the bot itself writes. The summary body comes from the model, already in the right
// language; these are the header and the error replies around it.
//
// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import { AUTO, primaryLanguage } from "./language.ts";

export interface Texts {
  header(days: number, messages: number, people: number): string;
  noMessages(days: number): string;
  tooManyMessages: string;
  busy: string;
  cooldown(seconds: number): string;
  refused: string;
  invalidKey: string;
  aiUnavailable: string;
  failed: string;
  notHere: string;
}

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

function plural(locale: string, count: number, forms: PluralForms): string {
  return forms[new Intl.PluralRules(locale).select(count)] ?? forms.other;
}

const slovakPeriod = (days: number) =>
  days === 1
    ? "posledný deň"
    : plural("sk", days, { few: `posledné ${days} dni`, other: `posledných ${days} dní` });

const slovak: Texts = {
  header: (days, messages, people) =>
    `📋 **Sumár za ${slovakPeriod(days)}** · ${messages} ${plural("sk", messages, {
      one: "správa",
      few: "správy",
      other: "správ",
    })} · ${people} ${plural("sk", people, { one: "človek", few: "ľudia", other: "ľudí" })}`,
  noMessages: (days) => `Za ${slovakPeriod(days)} tu nie sú žiadne správy.`,
  tooManyMessages: "V tomto období je priveľa správ na jeden sumár. Skús menej dní.",
  busy: "V tomto channeli sa už sumár pripravuje, chvíľu počkaj.",
  cooldown: (seconds) => `Ďalší sumár tu môžeš spustiť o ${seconds} s.`,
  refused: "Claude tento sumár odmietol vytvoriť. Skús iné obdobie.",
  invalidKey: "API kľúč pre Claude je neplatný. Admin servera ho musí nastaviť znova.",
  aiUnavailable: "Claude je momentálne preťažený alebo nedostupný. Skús to o chvíľu.",
  failed: "Sumár sa nepodarilo vytvoriť. Skús to znova neskôr.",
  notHere: "Sumár funguje iba v textových channeloch a vláknach na serveri.",
};

const czechPeriod = (days: number) =>
  days === 1
    ? "poslední den"
    : plural("cs", days, { few: `poslední ${days} dny`, other: `posledních ${days} dní` });

const czech: Texts = {
  header: (days, messages, people) =>
    `📋 **Souhrn za ${czechPeriod(days)}** · ${messages} ${plural("cs", messages, {
      one: "zpráva",
      few: "zprávy",
      other: "zpráv",
    })} · ${people} ${plural("cs", people, { one: "člověk", few: "lidé", other: "lidí" })}`,
  noMessages: (days) => `Za ${czechPeriod(days)} tu nejsou žádné zprávy.`,
  tooManyMessages: "V tomto období je na jeden souhrn příliš mnoho zpráv. Zkus méně dní.",
  busy: "V tomto kanálu se už souhrn připravuje, chvíli počkej.",
  cooldown: (seconds) => `Další souhrn tu můžeš spustit za ${seconds} s.`,
  refused: "Claude tento souhrn odmítl vytvořit. Zkus jiné období.",
  invalidKey: "API klíč pro Claude je neplatný. Admin serveru ho musí nastavit znovu.",
  aiUnavailable: "Claude je momentálně přetížený nebo nedostupný. Zkus to za chvíli.",
  failed: "Souhrn se nepodařilo vytvořit. Zkus to znovu později.",
  notHere: "Souhrn funguje jen v textových kanálech a vláknech na serveru.",
};

const englishPeriod = (days: number) => (days === 1 ? "the last day" : `the last ${days} days`);

const english: Texts = {
  header: (days, messages, people) =>
    `📋 **Summary of ${englishPeriod(days)}** · ${messages} ${plural("en", messages, {
      one: "message",
      other: "messages",
    })} · ${people} ${plural("en", people, { one: "person", other: "people" })}`,
  noMessages: (days) => `There are no messages here from ${englishPeriod(days)}.`,
  tooManyMessages: "There are too many messages in this period for one summary. Try fewer days.",
  busy: "A summary is already being prepared in this channel, please wait.",
  cooldown: (seconds) => `You can start the next summary here in ${seconds} s.`,
  refused: "Claude declined to write this summary. Try a different period.",
  invalidKey: "The Claude API key is invalid. A server admin has to set it again.",
  aiUnavailable: "Claude is overloaded or unavailable right now. Try again in a moment.",
  failed: "The summary could not be created. Try again later.",
  notHere: "Summaries work only in server text channels and threads.",
};

const TEXTS: Record<string, Texts> = { sk: slovak, cs: czech, en: english };

export function textsFor(language: string): Texts {
  return TEXTS[primaryLanguage(language) ?? ""] ?? english;
}

/**
 * Language of replies sent before a summary exists, such as cooldown or error messages. With
 * `auto`, the language last detected in the channel wins, then the Discord language of the
 * member who ran the command.
 */
export function replyLanguage(
  setting: string,
  detectedInChannel: string | undefined,
  memberLocale: string,
): string {
  if (setting !== AUTO) return setting;
  return detectedInChannel ?? memberLocale;
}
