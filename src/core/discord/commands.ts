import type { Message } from "discord.js";
import * as logger from "../../utils/logger";

export type CommandHandler = (message: Message, args: string) => Promise<void>;

export class CommandRegistry {
  private commands = new Map<string, CommandHandler>();
  private prefix: string;

  constructor(prefix = "!") {
    this.prefix = prefix;
  }

  register(name: string, handler: CommandHandler): void {
    this.commands.set(name.toLowerCase(), handler);
  }

  isCommand(content: string): boolean {
    return content.startsWith(this.prefix);
  }

  async handle(message: Message): Promise<boolean> {
    const content = message.content.trim();
    if (!this.isCommand(content)) return false;

    const withoutPrefix = content.slice(this.prefix.length);
    const spaceIndex = withoutPrefix.indexOf(" ");
    const name = (spaceIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, spaceIndex)).toLowerCase();
    const args = spaceIndex === -1 ? "" : withoutPrefix.slice(spaceIndex + 1).trim();

    const handler = this.commands.get(name);
    if (!handler) return false;

    try {
      await handler(message, args);
    } catch (err) {
      logger.error(`[commands] Error in !${name}`, err);
    }
    return true;
  }

  list(): string[] {
    return [...this.commands.keys()];
  }
}
