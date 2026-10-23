// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { test } from "node:test";
import { languageName, parseLanguageSetting, primaryLanguage } from "../src/language.ts";

test("the setting accepts auto and canonicalizes language codes", () => {
  assert.equal(parseLanguageSetting("auto"), "auto");
  assert.equal(parseLanguageSetting(" Auto "), "auto");
  assert.equal(parseLanguageSetting("SK"), "sk");
  assert.equal(parseLanguageSetting("en-us"), "en-US");
});

test("the setting rejects what is not a language code", () => {
  assert.throws(() => parseLanguageSetting("slovenčina"), RangeError);
  assert.throws(() => parseLanguageSetting(""), RangeError);
});

test("primary language drops the region and rejects junk", () => {
  assert.equal(primaryLanguage("en-GB"), "en");
  assert.equal(primaryLanguage("sk"), "sk");
  assert.equal(primaryLanguage("s k"), null);
});

test("names languages in English for the prompt", () => {
  assert.equal(languageName("sk"), "Slovak");
  assert.equal(languageName("cs"), "Czech");
  assert.equal(languageName("not a language"), "not a language");
});
