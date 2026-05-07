# Integrations

All integrations are optional and auto-detected on startup. TAMON logs which ones are available:

```
[tamon] Integrations available: Google (Gmail/Calendar/Drive), Slack
```

## Gmail

```typescript
import { getUnreadEmails, searchEmails, createDraft, getThread } from "@tamon-ai/core/integrations";

// Get unread emails from last 24h
const unread = await getUnreadEmails(10);

// Search with Gmail query syntax
const results = await searchEmails("from:boss@company.com subject:urgent");

// Read a full thread
const thread = await getThread(results[0].threadId);

// Create a reply draft
const draftUrl = await createDraft(
  "boss@company.com",
  "Re: Urgent",
  "On it.",
  results[0].threadId,
);
```

## Google Calendar

```typescript
import { getEvents, createEvent, getFreeBusy } from "@tamon-ai/core/integrations";

// Today's events
const now = new Date();
const events = await getEvents({
  timeMin: now.toISOString(),
  timeMax: new Date(now.getTime() + 86400000).toISOString(),
});

// Create an event with attendees
const created = await createEvent({
  summary: "Team standup",
  start: "2026-01-15T10:00:00+09:00",
  end: "2026-01-15T10:30:00+09:00",
  attendees: ["alice@company.com", "bob@company.com"],
});

// Check availability
const busy = await getFreeBusy(
  "alice@company.com",
  "2026-01-15T09:00:00Z",
  "2026-01-15T18:00:00Z",
);
```

## Slack

```typescript
import { sendMessage, searchMessages, getChannelHistory } from "@tamon-ai/core/integrations";

await sendMessage("#general", "Hello from TAMON!");
const history = await getChannelHistory("C01234567", 50);
const results = await searchMessages("deployment failed");
```

## Telegram

```typescript
import { sendMessage, getUpdates, getMe } from "@tamon-ai/core/integrations";

const bot = await getMe();
console.log(`Bot: ${bot.firstName} (@${bot.username})`);

await sendMessage("123456789", "Hello from TAMON!");
const updates = await getUpdates();
```

## Adding Your Own Integration

1. Create `src/integrations/your-service.ts`
2. Add config keys to `TamonConfig` interface in `src/config.ts`
3. Add env vars to `loadConfig()` with `optional()`
4. Add env vars to `.env.example`
5. Export from `src/integrations/index.ts`
6. Add `isYourServiceConfigured()` function and log it in `src/index.ts`
