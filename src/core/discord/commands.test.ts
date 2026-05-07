import { describe, it, expect, vi } from "vitest";
import { CommandRegistry } from "./commands";
import type { Message } from "discord.js";

function fakeMessage(content: string): Message {
  return { content, reply: vi.fn() } as unknown as Message;
}

describe("CommandRegistry", () => {
  it("detects commands with prefix", () => {
    const reg = new CommandRegistry("!");
    expect(reg.isCommand("!status")).toBe(true);
    expect(reg.isCommand("hello")).toBe(false);
  });

  it("supports custom prefix", () => {
    const reg = new CommandRegistry("/");
    expect(reg.isCommand("/help")).toBe(true);
    expect(reg.isCommand("!help")).toBe(false);
  });

  it("dispatches to registered handler", async () => {
    const reg = new CommandRegistry("!");
    const handler = vi.fn();
    reg.register("ping", handler);
    const msg = fakeMessage("!ping");
    const handled = await reg.handle(msg);
    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledWith(msg, "");
  });

  it("passes args to handler", async () => {
    const reg = new CommandRegistry("!");
    const handler = vi.fn();
    reg.register("task", handler);
    const msg = fakeMessage("!task buy groceries");
    await reg.handle(msg);
    expect(handler).toHaveBeenCalledWith(msg, "buy groceries");
  });

  it("returns false for unregistered commands", async () => {
    const reg = new CommandRegistry("!");
    const msg = fakeMessage("!unknown");
    expect(await reg.handle(msg)).toBe(false);
  });

  it("returns false for non-command messages", async () => {
    const reg = new CommandRegistry("!");
    reg.register("ping", vi.fn());
    const msg = fakeMessage("hello world");
    expect(await reg.handle(msg)).toBe(false);
  });

  it("is case-insensitive for command names", async () => {
    const reg = new CommandRegistry("!");
    const handler = vi.fn();
    reg.register("Status", handler);
    const msg = fakeMessage("!STATUS");
    await reg.handle(msg);
    expect(handler).toHaveBeenCalled();
  });

  it("lists registered commands", () => {
    const reg = new CommandRegistry("!");
    reg.register("ping", vi.fn());
    reg.register("status", vi.fn());
    expect(reg.list()).toEqual(["ping", "status"]);
  });

  it("catches handler errors and returns true", async () => {
    const reg = new CommandRegistry("!");
    reg.register("boom", async () => {
      throw new Error("handler error");
    });
    const msg = fakeMessage("!boom");
    const handled = await reg.handle(msg);
    expect(handled).toBe(true);
  });
});
