// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { test } from "node:test";
import { textsFor } from "../src/i18n.ts";

test("Slovak header uses the right plural forms", () => {
  const sk = textsFor("sk");
  assert.equal(sk.header(1, 1, 1), "📋 **Sumár za posledný deň** · 1 správa · 1 človek");
  assert.equal(sk.header(3, 4, 2), "📋 **Sumár za posledné 3 dni** · 4 správy · 2 ľudia");
  assert.equal(sk.header(14, 414, 5), "📋 **Sumár za posledných 14 dní** · 414 správ · 5 ľudí");
  assert.equal(sk.noMessages(7), "Za posledných 7 dní tu nie sú žiadne správy.");
});

test("English is the fallback language", () => {
  assert.equal(
    textsFor("de").header(1, 2, 1),
    "📋 **Summary of the last day** · 2 messages · 1 person",
  );
});
