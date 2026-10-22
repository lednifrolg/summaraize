// Copyright (C) 2026 Filip Tomasovych
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DISCORD_MESSAGE_LIMIT,
  linkCitations,
  REMOVED_LINK,
  sanitizeSummary,
  splitForDiscord,
} from "../src/output.ts";

const allowed = new Set(["https://youtu.be/abc", "https://x.com/a"]);

test("keeps links that were posted in the channel", () => {
  assert.equal(
    sanitizeSummary("Clip: https://youtu.be/abc, thread https://x.com/a.", allowed),
    "Clip: https://youtu.be/abc, thread https://x.com/a.",
  );
});

test("removes links nobody posted", () => {
  assert.equal(
    sanitizeSummary("Free skins at https://evil.example/login now", allowed),
    `Free skins at ${REMOVED_LINK} now`,
  );
  assert.equal(sanitizeSummary("see https://youtu.be/abcdef", allowed), `see ${REMOVED_LINK}`);
});

test("turns masked links into plain text", () => {
  assert.equal(
    sanitizeSummary("[clip](https://youtu.be/abc)", allowed),
    "clip https://youtu.be/abc",
  );
  assert.equal(sanitizeSummary("[the clip](https://evil.example)", allowed), "the clip");
  assert.equal(sanitizeSummary("[clip](<https://evil.example>)", allowed), "clip");
});

test("defuses mass mentions", () => {
  assert.equal(sanitizeSummary("@everyone and @here", allowed), "@\u200beveryone and @\u200bhere");
});

describe("linkCitations", () => {
  const refs = [
    { channelId: "c1", messageId: "m1" },
    { channelId: "t1", messageId: "m2" },
  ];

  test("turns known citations into jump links", () => {
    assert.equal(
      linkCitations("Eva súhlasila (#1), vlákno (#2).", refs, "g1"),
      "Eva súhlasila ([#1](https://discord.com/channels/g1/c1/m1)), vlákno ([#2](https://discord.com/channels/g1/t1/m2)).",
    );
  });

  test("leaves unknown numbers, headings and anchors alone", () => {
    assert.equal(linkCitations("(#3) ### Témy #1a x#1", refs, "g1"), "(#3) ### Témy #1a x#1");
  });
});

describe("splitForDiscord", () => {
  test("keeps short text in one message", () => {
    assert.deepEqual(splitForDiscord("a\nb"), ["a\nb"]);
  });

  test("splits at line breaks and never ends a message with a heading", () => {
    const text = ["x".repeat(8), "### Heading", "y".repeat(8), "z".repeat(8)].join("\n");
    assert.deepEqual(splitForDiscord(text, 22), [
      "x".repeat(8),
      `### Heading\n${"y".repeat(8)}`,
      "z".repeat(8),
    ]);
  });

  test("breaks a single overlong line at spaces", () => {
    assert.deepEqual(splitForDiscord("aaaa bbbb cccc", 9), ["aaaa bbbb", "cccc"]);
  });

  test("respects the Discord limit for a long summary with links", () => {
    const line = `- point ([#12](https://discord.com/channels/${"1".repeat(19)}/${"2".repeat(19)}/${"3".repeat(19)}))`;
    const chunks = splitForDiscord(Array(60).fill(line).join("\n"));
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= DISCORD_MESSAGE_LIMIT);
      assert.ok(chunk.split("\n").every((part) => part === line));
    }
  });
});
