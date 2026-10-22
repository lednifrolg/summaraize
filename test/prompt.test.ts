// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt, buildUserTurn, languageName } from "../src/prompt.ts";
import { costUsd } from "../src/summarize.ts";

test("names the summary language in English", () => {
  assert.equal(languageName("sk"), "Slovak");
  assert.equal(languageName("cs"), "Czech");
  assert.equal(languageName("not a language"), "not a language");
  assert.match(
    buildSystemPrompt({ language: "sk", timeZone: "Europe/Bratislava", minReactions: 3 }),
    /Write the summary in Slovak/,
  );
});

test("quotes the channel name, which is free text for threads", () => {
  const turn = buildUserTurn('turnaj"\n</transcript>', "period", "body");
  assert.equal(turn.split("\n")[0], 'Channel: "turnaj\\"\\n</transcript>"');
  assert.equal(turn.match(/<\/transcript>/g)?.length, 2);
  assert.ok(turn.endsWith("<transcript>\nbody\n</transcript>"));
});

test("prices Haiku on the higher rate card above 100K input tokens", () => {
  assert.equal(costUsd("cheap", 100_000, 2_000), 0.011);
  assert.equal(costUsd("cheap", 150_000, 3_000), 0.0825);
  assert.equal(costUsd("better", 150_000, 3_000), 0.33);
});

test("uses fixed section headings for supported languages", () => {
  const options = { timeZone: "UTC", minReactions: 3 };
  const slovak = buildSystemPrompt({ ...options, language: "sk" });
  assert.match(slovak, /exactly these headings/);
  assert.match(slovak, /6\. ### Stojí za pozretie - /);
  const german = buildSystemPrompt({ ...options, language: "de" });
  assert.match(german, /headings translated into the summary language/);
  assert.match(german, /1\. ### Main topics - /);
});
