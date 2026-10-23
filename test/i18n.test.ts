// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { test } from "node:test";
import { replyLanguage, textsFor } from "../src/i18n.ts";

test("Slovak header uses the right plural forms", () => {
  const sk = textsFor("sk");
  assert.equal(sk.header(1, 1, 1), "📋 **Sumár za posledný deň** · 1 správa · 1 človek");
  assert.equal(sk.header(3, 4, 2), "📋 **Sumár za posledné 3 dni** · 4 správy · 2 ľudia");
  assert.equal(sk.header(14, 414, 5), "📋 **Sumár za posledných 14 dní** · 414 správ · 5 ľudí");
  assert.equal(sk.noMessages(7), "Za posledných 7 dní tu nie sú žiadne správy.");
});

test("Czech header uses the right plural forms", () => {
  const cs = textsFor("cs");
  assert.equal(cs.header(1, 1, 1), "📋 **Souhrn za poslední den** · 1 zpráva · 1 člověk");
  assert.equal(cs.header(3, 4, 2), "📋 **Souhrn za poslední 3 dny** · 4 zprávy · 2 lidé");
  assert.equal(cs.header(14, 414, 5), "📋 **Souhrn za posledních 14 dní** · 414 zpráv · 5 lidí");
});

test("regional tags use their language and anything else falls back to English", () => {
  assert.equal(textsFor("cs-CZ"), textsFor("cs"));
  assert.equal(
    textsFor("en-US").header(1, 2, 1),
    "📋 **Summary of the last day** · 2 messages · 1 person",
  );
  assert.equal(textsFor("de"), textsFor("en"));
  assert.equal(textsFor("auto"), textsFor("en"));
});

test("replies before a summary follow the setting, then the channel, then the member", () => {
  assert.equal(replyLanguage("sk", "cs", "en-US"), "sk");
  assert.equal(replyLanguage("auto", "sk", "en-US"), "sk");
  assert.equal(replyLanguage("auto", undefined, "cs"), "cs");
});
