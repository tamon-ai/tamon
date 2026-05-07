import { describe, it, expect } from "vitest";
import { splitMessage } from "./split-message";

describe("splitMessage", () => {
  it("returns single chunk for short messages", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("returns single chunk for exactly max length", () => {
    const msg = "a".repeat(2000);
    expect(splitMessage(msg)).toEqual([msg]);
  });

  it("splits at paragraph boundary when possible", () => {
    const para1 = "a".repeat(1200);
    const para2 = "b".repeat(1200);
    const msg = `${para1}\n\n${para2}`;
    const chunks = splitMessage(msg);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1 + "\n\n");
    expect(chunks[1]).toBe(para2);
  });

  it("falls back to line break split", () => {
    const line1 = "a".repeat(1500);
    const line2 = "b".repeat(800);
    const msg = `${line1}\n${line2}`;
    const chunks = splitMessage(msg);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(line1 + "\n");
    expect(chunks[1]).toBe(line2);
  });

  it("hard splits when no good boundary found", () => {
    const msg = "a".repeat(4000);
    const chunks = splitMessage(msg);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(2000);
    expect(chunks[1].length).toBe(2000);
  });

  it("respects custom maxLength", () => {
    const msg = "a".repeat(30);
    const chunks = splitMessage(msg, 10);
    expect(chunks.length).toBe(3);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(10));
  });

  it("handles empty string", () => {
    expect(splitMessage("")).toEqual([""]);
  });
});
