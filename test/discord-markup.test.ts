// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMarkup } from "../src/discord-markup.ts";

const names = {
  user: (id: string) => ({ "1": "Jano", "2": "Eva" })[id],
  role: (id: string) => ({ "10": "Moderators" })[id],
  channel: (id: string) => ({ "20": "cs2" })[id],
};

test("resolves mentions to readable names", () => {
  assert.equal(
    resolveMarkup("<@1> a <@!2>, <@&10> v <#20>", names, "UTC"),
    "@Jano a @Eva, @Moderators v #cs2",
  );
});

test("keeps unknown mentions readable", () => {
  assert.equal(
    resolveMarkup("<@9> <@&9> <#9>", names, "UTC"),
    "@unknown-user @unknown-role #unknown-channel",
  );
});

test("shortens custom emoji, timestamps and command mentions", () => {
  assert.equal(
    resolveMarkup(
      "gg <:pepega:123> <a:dance:456> o <t:1792512000:R>, skús </summary:789>",
      names,
      "Europe/Bratislava",
    ),
    "gg :pepega: :dance: o 20.10.2026 18:00, skús /summary",
  );
});

test("leaves plain text alone", () => {
  assert.equal(resolveMarkup("a < b > c @everyone", names, "UTC"), "a < b > c @everyone");
});
