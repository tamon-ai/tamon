import {
  Client,
  GatewayIntentBits,
  Partials,
  type ClientOptions,
} from "discord.js";
import * as logger from "../../utils/logger";

export interface CreateClientOptions {
  intents?: GatewayIntentBits[];
  partials?: Partials[];
}

export function createClient(options: CreateClientOptions = {}): Client {
  const intents = options.intents || [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ];

  const partials = options.partials || [Partials.Message, Partials.Channel, Partials.Reaction];

  const client = new Client({
    intents,
    partials,
    rest: { retries: 3, timeout: 30_000 },
  } as ClientOptions);

  client.rest.on("rateLimited", (info) => {
    logger.warn(`[discord] Rate limited: ${info.method} ${info.url} (retry after ${info.timeToReset}ms)`);
  });

  client.on("error", (err) => {
    logger.error("[discord] Client error", err);
  });

  client.on("warn", (msg) => {
    logger.warn(`[discord] ${msg}`);
  });

  return client;
}
