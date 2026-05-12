import { describe, expect, it } from "vitest";

import { emailToHandle, parseMentions } from "./mentions";

describe("parseMentions", () => {
  it("extracts a single mention", () => {
    expect(parseMentions("hey @alice can you check this")).toEqual(["alice"]);
  });

  it("returns an empty array when there are no mentions", () => {
    expect(parseMentions("just a normal message")).toEqual([]);
  });

  it("handles mentions at the start of the message", () => {
    expect(parseMentions("@bob heads up")).toEqual(["bob"]);
  });

  it("does not match an @ inside an email address", () => {
    expect(parseMentions("contact alice@example.com please")).toEqual([]);
  });

  it("de-duplicates repeated mentions and lower-cases them", () => {
    expect(parseMentions("@Alice and @ALICE and @alice")).toEqual(["alice"]);
  });

  it("captures multiple distinct mentions in order", () => {
    expect(parseMentions("@alice and @bob and @carol")).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("supports dots, underscores, hyphens, and plus in handles", () => {
    expect(parseMentions("ping @a.b_c-d+tag for review")).toEqual([
      "a.b_c-d+tag",
    ]);
  });

  it("matches a mention after punctuation", () => {
    expect(parseMentions("(@alice) and: @bob.")).toEqual(["alice", "bob"]);
  });
});

describe("emailToHandle", () => {
  it("returns the lower-cased local-part of an email", () => {
    expect(emailToHandle("Alice@Example.com")).toBe("alice");
  });

  it("falls back to the full string when there is no @", () => {
    expect(emailToHandle("nobody")).toBe("nobody");
  });
});
