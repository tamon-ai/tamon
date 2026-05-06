import type { Message, TextChannel, DMChannel, NewsChannel, ThreadChannel } from "discord.js";
import { splitMessage } from "../../utils/split-message";
import * as logger from "../../utils/logger";

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

export interface SafeSendResult {
  success: boolean;
  messages: Message[];
  errorCode?: number;
}

const UNRECOVERABLE_CODES = new Set([50083, 50001, 50013, 10003, 10008]);

export async function safeSend(
  channel: SendableChannel,
  content: string,
): Promise<SafeSendResult> {
  const chunks = splitMessage(content);
  const messages: Message[] = [];

  for (const chunk of chunks) {
    try {
      const msg = await channel.send(chunk);
      messages.push(msg);
    } catch (err: any) {
      const code = err?.code;
      if (UNRECOVERABLE_CODES.has(code)) {
        logger.warn(`[discord] safeSend unrecoverable: code=${code}`);
        return { success: false, messages, errorCode: code };
      }
      throw err;
    }
  }

  return { success: true, messages };
}

export async function safeEdit(
  message: Message,
  content: string,
): Promise<SafeSendResult> {
  const truncated = content.length > 2000 ? content.slice(0, 1997) + "..." : content;
  try {
    const edited = await message.edit(truncated);
    return { success: true, messages: [edited] };
  } catch (err: any) {
    const code = err?.code;
    if (UNRECOVERABLE_CODES.has(code)) {
      logger.warn(`[discord] safeEdit unrecoverable: code=${code}`);
      return { success: false, messages: [], errorCode: code };
    }
    throw err;
  }
}

export interface TypingLoop {
  stop(): void;
}

export function startTypingLoop(
  channel: SendableChannel,
  intervalMs = 8000,
): TypingLoop {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await channel.sendTyping();
    } catch {}
  };

  tick();
  const timer = setInterval(tick, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
