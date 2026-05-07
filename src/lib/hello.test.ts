import { describe, it, expect } from "vitest";
import { hello } from "./hello";

describe("hello", () => {
  it("greets by name", () => {
    expect(hello("Eventero")).toBe("Hello, Eventero!");
  });
});
