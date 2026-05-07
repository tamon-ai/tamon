# Configuration

All configuration is via environment variables (`.env` file). See [.env.example](../.env.example) for the full list.

## Core (required)

```bash
DISCORD_BOT_TOKEN=your-token
```

## Claude

```bash
CLAUDE_MODEL=claude-sonnet-4-20250514    # or claude-opus-4-6
TAMON_MAX_CONCURRENT=2                    # parallel Claude processes
CLAUDE_MAX_EXECUTION_MINUTES=60           # timeout per request
```

## Assistant

```bash
TAMON_NAME=TAMON                          # your assistant's name
TZ=UTC                                    # timezone
LOG_LEVEL=info                            # info | debug | warn | error
```

## Notion (optional)

```bash
NOTION_API_KEY=secret_xxx
NOTION_DATABASES=tasks:db-id-1,knowledge:db-id-2
```

## Google Workspace (optional)

Service Account (recommended for teams):

```bash
GOOGLE_SA_KEY_FILE=path/to/sa-key.json
GOOGLE_SA_IMPERSONATE_EMAIL=user@company.com
```

OAuth (fallback / single-user):

```bash
GOOGLE_OAUTH_CLIENT_ID=xxx
GOOGLE_OAUTH_CLIENT_SECRET=xxx
GOOGLE_OAUTH_REFRESH_TOKEN=xxx
GOOGLE_CALENDAR_ID=primary
```

## Slack (optional)

```bash
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_USER_TOKEN=xoxp-xxx
```

## Telegram (optional)

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-xxx
```

## Webhook Server (optional)

```bash
WEBHOOK_PORT=3456
WEBHOOK_AUTH_TOKEN=your-secret
```

## Channel Mapping (optional)

Map logical names to Discord channel IDs:

```bash
TAMON_CHANNELS=hub:123456789,logs:987654321
```
