import type { Message, TextChannel, DMChannel, NewsChannel, ThreadChannel } from "discord.js";
import { safeSend, safeEdit, startTypingLoop } from "./safe-send";
import { executeStreaming, type StreamingOptions, type Phase } from "../claude/executor";
import { splitMessage } from "../../utils/split-message";
import * as logger from "../../utils/logger";

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

export interface RespondOptions {
  systemPrompt?: string;
  context?: string;
  model?: string;
  mcpConfigs?: string[];
  maxExecutionMs?: number;
  onPhase?: (phase: Phase, detail?: string) => void;
}

export interface RespondResult {
  text: string;
  exitCode: number;
  timedOut: boolean;
  elapsedMs: number;
}

export async function respond(
  message: Message,
  options: RespondOptions = {},
): Promise<RespondResult> {
  const channel = message.channel as SendableChannel;
  const typing = startTypingLoop(channel);

  // Add hourglass reaction
  try {
    await message.react("⏳");
  } catch {}

  let currentMessage: Message | null = null;
  let fullText = "";
  let lastUpdate = 0;
  const UPDATE_INTERVAL = 1500;

  const updateMessage = async () => {
    const now = Date.now();
    if (now - lastUpdate < UPDATE_INTERVAL) return;
    lastUpdate = now;

    if (!fullText.trim()) return;

    const chunks = splitMessage(fullText);
    const displayChunk = chunks[chunks.length - 1];

    if (!currentMessage) {
      const result = await safeSend(channel, displayChunk);
      if (result.success && result.messages.length > 0) {
        currentMessage = result.messages[result.messages.length - 1];
      }
    } else {
      await safeEdit(currentMessage, displayChunk);
    }
  };

  // Build prompt
  let prompt = message.content;
  if (options.context) {
    prompt = `${options.context}\n\n---\n\nUser message: ${message.content}`;
  }

  const streamOptions: StreamingOptions = {
    model: options.model,
    systemPrompt: options.systemPrompt,
    mcpConfigs: options.mcpConfigs,
    maxExecutionMs: options.maxExecutionMs,
    channelId: message.channelId,
    onChunk: (chunk, full) => {
      fullText = full;
      updateMessage();
    },
    onPhase: options.onPhase,
  };

  const result = await executeStreaming(prompt, streamOptions);
  typing.stop();

  // Final update with complete text
  if (result.text.trim()) {
    const chunks = splitMessage(result.text);
    if (currentMessage) {
      await safeEdit(currentMessage, chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await safeSend(channel, chunks[i]);
      }
    } else {
      for (const chunk of chunks) {
        await safeSend(channel, chunk);
      }
    }
  }

  // Replace hourglass with result reaction
  try {
    await message.reactions.cache.get("⏳")?.users.remove(message.client.user?.id);
    await message.react(result.exitCode === 0 ? "✅" : "⚠️");
  } catch {}

  return {
    text: result.text,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    elapsedMs: result.elapsedMs,
  };
}
