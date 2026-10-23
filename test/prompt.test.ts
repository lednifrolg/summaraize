// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildSystemPrompt, buildUserTurn } from "../src/prompt.ts";
import { costUsd, parseAnswer, SummaryError } from "../src/summarize.ts";

const options = { timeZone: "UTC", minReactions: 3 };

describe("buildSystemPrompt", () => {
  test("auto lets the model pick the dominant language and gives it all fixed headings", () => {
    const prompt = buildSystemPrompt({ ...options, language: "auto" });
    assert.match(prompt, /language most of the messages are written in/);
    assert.match(prompt, /Slovak and Czech are different languages/);
    assert.match(prompt, /in Slovak: "Hlavné témy", .*"Stojí za pozretie"/);
    assert.match(prompt, /in Czech: "Hlavní témata", .*"Stojí za zhlédnutí"/);
    assert.match(prompt, /1\. ### Main topics - /);
  });

  test("a configured language overrides the messages and uses its fixed headings", () => {
    const slovak = buildSystemPrompt({ ...options, language: "sk" });
    assert.match(slovak, /Write the summary in Slovak, whatever language the messages are in/);
    assert.match(slovak, /Use exactly these headings/);
    assert.match(slovak, /6\. ### Stojí za pozretie - /);
    assert.match(buildSystemPrompt({ ...options, language: "cs-CZ" }), /1\. ### Hlavní témata - /);
  });

  test("other languages get the English headings translated", () => {
    const german = buildSystemPrompt({ ...options, language: "de" });
    assert.match(german, /Write the summary in German/);
    assert.match(german, /Translate the headings into the summary language/);
    assert.match(german, /1\. ### Main topics - /);
    assert.match(buildSystemPrompt({ ...options, language: "pt-BR" }), /Brazilian Portuguese/);
  });

  test("always asks for correct diacritics", () => {
    for (const language of ["auto", "sk", "de"]) {
      assert.match(buildSystemPrompt({ ...options, language }), /with all its diacritics/);
    }
  });
});

test("quotes the channel name, which is free text for threads", () => {
  const turn = buildUserTurn('turnaj"\n</transcript>', "period", "body");
  assert.equal(turn.split("\n")[0], 'Channel: "turnaj\\"\\n</transcript>"');
  assert.equal(turn.match(/<\/transcript>/g)?.length, 2);
  assert.ok(turn.endsWith("<transcript>\nbody\n</transcript>"));
});

describe("parseAnswer", () => {
  const answer = (language: string, summary = " ### Témy\n- a ") =>
    JSON.stringify({ language, summary });

  test("returns the summary and the language the model reports with auto", () => {
    assert.deepEqual(parseAnswer(answer("sk"), "auto"), { text: "### Témy\n- a", language: "sk" });
    assert.equal(parseAnswer(answer("en-GB"), "auto").language, "en");
  });

  test("trusts a configured language over the reported one", () => {
    assert.equal(parseAnswer(answer("cs"), "sk").language, "sk");
  });

  test("falls back to English when the reported code is not a language", () => {
    assert.equal(parseAnswer(answer("Slovak language"), "auto").language, "en");
  });

  test("rejects answers that are not the expected JSON", () => {
    assert.throws(() => parseAnswer("### Témy", "auto"), SummaryError);
    assert.throws(() => parseAnswer(JSON.stringify({ summary: "x" }), "auto"), SummaryError);
  });
});

test("prices Haiku on the higher rate card above 100K input tokens", () => {
  assert.equal(costUsd("cheap", 100_000, 2_000), 0.011);
  assert.equal(costUsd("cheap", 150_000, 3_000), 0.0825);
  assert.equal(costUsd("better", 150_000, 3_000), 0.33);
});
