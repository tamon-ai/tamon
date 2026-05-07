# Integrations

All integrations are optional and auto-detected on startup via `isXxxConfigured()` checks. TAMON logs which ones are available:

```
[tamon] Integrations available: Google (Gmail/Calendar/Drive), GitHub, Slack, Linear
```

## Google Workspace

### Gmail

```typescript
import { getUnreadEmails, searchEmails, createDraft, getThread } from "tamon-ai/integrations";

const unread = await getUnreadEmails(10);
const results = await searchEmails("from:boss@company.com subject:urgent");
const thread = await getThread(results[0].threadId);
const draftUrl = await createDraft("boss@company.com", "Re: Urgent", "On it.", results[0].threadId);
```

### Google Calendar

```typescript
import { getEvents, createEvent, getFreeBusy } from "tamon-ai/integrations";

const now = new Date();
const events = await getEvents({
  timeMin: now.toISOString(),
  timeMax: new Date(now.getTime() + 86400000).toISOString(),
});
const created = await createEvent({
  summary: "Team standup",
  start: "2026-01-15T10:00:00+09:00",
  end: "2026-01-15T10:30:00+09:00",
  attendees: ["alice@company.com"],
});
const busy = await getFreeBusy("alice@company.com", "2026-01-15T09:00:00Z", "2026-01-15T18:00:00Z");
```

### Google Drive

```typescript
import { searchFiles, getRecentFiles, uploadFile, downloadFile } from "tamon-ai/integrations";

const files = await searchFiles("quarterly report", 10);
const recent = await getRecentFiles(20);
const uploaded = await driveUploadFile("report.pdf", buffer, "application/pdf", folderId);
const content = await downloadFile(fileId);
```

### Google Contacts

```typescript
import { searchContacts, listContacts, createContact } from "tamon-ai/integrations";

const results = await searchContacts("Alice");
const all = await listContacts(100);
const created = await createContact({ givenName: "Alice", familyName: "Smith", email: "alice@example.com" });
```

## Development Tools

### GitHub

```typescript
import { getRepositories, getIssues, getPullRequests, getRecentActivity } from "tamon-ai/integrations";

const repos = await getRepositories("my-org", 10);
const issues = await githubGetIssues("my-org/my-repo", "open", 20);
const prs = await getPullRequests("my-org/my-repo", "open", 10);
const activity = await getRecentActivity("my-org", 30);
```

### Vercel

```typescript
import { getProjects, getDeployments, getEnvironmentVars } from "tamon-ai/integrations";

const projects = await getProjects(20);
const deploys = await getDeployments("prj_xxx", 10);
const envVars = await getEnvironmentVars("prj_xxx");
```

### Linear

```typescript
import { linearGetIssues, linearCreateIssue, getMyIssues, getTeams } from "tamon-ai/integrations";

const teams = await getTeams();
const issues = await linearGetIssues(teams[0].id, 20);
const mine = await getMyIssues(10);
const created = await linearCreateIssue({
  teamId: teams[0].id,
  title: "Fix auth bug",
  priority: 1,
});
```

### Supabase

```typescript
import { supabaseQuery, supabaseInsert, supabaseRpc, supabaseSql } from "tamon-ai/integrations";

const rows = await supabaseQuery({ table: "users", select: "id,name", filter: "role=eq.admin", limit: 50 });
await supabaseInsert("events", [{ type: "login", userId: "123" }]);
const result = await supabaseRpc("calculate_stats", { period: "7d" });
const raw = await supabaseSql("SELECT count(*) FROM users WHERE created_at > now() - interval '1 day'");
```

## Analytics

### Google Analytics 4

```typescript
import { getPageViews, getActiveUsers, getTopPages, runReport } from "tamon-ai/integrations";

const pv = await getPageViews("7daysAgo", "today");
const users = await getActiveUsers("30daysAgo", "today");
const top = await getTopPages(10, "7daysAgo", "today");
const custom = await runReport({
  dimensions: [{ name: "country" }],
  metrics: [{ name: "sessions" }],
  dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
});
```

### Search Console

```typescript
import { getSiteList, getSearchAnalytics, getTopQueries } from "tamon-ai/integrations";

const sites = await getSiteList();
const analytics = await getSearchAnalytics("https://example.com", "2026-01-01", "2026-01-31", { dimensions: ["query"] });
const queries = await getTopQueries("https://example.com", "2026-01-01", "2026-01-31", 20);
```

## Communication

### Slack

```typescript
import { slackSendMessage, slackSearchMessages, getChannelHistory, uploadFile } from "tamon-ai/integrations";

await slackSendMessage("#general", "Hello from TAMON!");
const history = await getChannelHistory("C01234567", 50);
const results = await slackSearchMessages("deployment failed");
```

### Telegram

```typescript
import { telegramSendMessage, getUpdates, getMe } from "tamon-ai/integrations";

const bot = await getMe();
await telegramSendMessage("123456789", "Hello from TAMON!");
const updates = await getUpdates();
```

### X (Twitter)

```typescript
import { postTweet, deleteTweet, getTimeline, searchTweets } from "tamon-ai/integrations";

const tweet = await postTweet("Hello from TAMON!");
const timeline = await getTimeline(20);
const results = await searchTweets("AI agent", 50);
await deleteTweet(tweet.id);
```

## Adding your own integration

1. Create `src/integrations/your-service.ts` with an `isYourServiceConfigured()` export
2. Add config keys to `TamonConfig` in `src/config.ts`
3. Add env vars to `loadConfig()` with `optional()`
4. Add env vars to `.env.example`
5. Export from `src/integrations/index.ts`
6. Log availability in `src/index.ts`
