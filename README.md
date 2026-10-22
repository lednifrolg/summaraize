# SummarAIze

Discord bot that tells you what you missed. Run `/summary days:3` in a channel and it posts a
summary of the last three days: the main topics and who drove them, decisions and plans,
disagreements, the messages people reacted to most, open questions and links worth opening.
Every cited message number is a link that jumps straight to that message.

Summaries are written by Claude through the Anthropic API.

## What goes into a summary

- Messages of the channel, plus threads started under it.
- Who replied to whom.
- Reactions, only on messages at least 3 different people reacted to, with who reacted how.
- Attachments, stickers, polls with their votes, forwarded messages and bot embeds.
- Server nicknames, so people are named the way the server knows them.

The summary is posted publicly in the channel as one card. It never pings anyone.

## Security and privacy

- Message content is fetched on demand, sent to the Anthropic API for that one summary and not
  stored anywhere.
- Text written by channel members cannot act as instructions to the bot. It reaches the model
  only as escaped JSON strings inside a fixed transcript format, the model has no tools and sees
  no secrets, links in the summary that nobody posted in the channel are removed, and mentions
  never turn into pings.
- The bot reads only channels its role can see. Private threads are skipped.

## Setup

Requires Node 26 (it runs the TypeScript sources directly, there is no build step).

### 1. Discord application

1. Create an application at https://discord.com/developers/applications.
2. On the Bot page, reset the token and keep it for `.env`. Under Privileged Gateway Intents,
   enable **Message Content Intent**. Without it Discord returns messages with empty text.
3. Invite the bot with this URL, using the Application ID from the General Information page:
   `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=274877991936`
   It asks for View Channels, Read Message History, Send Messages, Send Messages in Threads and
   Embed Links.

### 2. Anthropic API key

Create an API key in the [Anthropic Console](https://console.anthropic.com) and add credit.
This is prepaid API usage, separate from a Claude subscription. A summary of a few hundred
messages costs around $0.03-0.05.

### 3. Configure and run

```sh
npm install
cp .env.example .env   # fill in DISCORD_TOKEN and ANTHROPIC_API_KEY
npm start
```

| Variable            | Meaning                                              | Default             |
| ------------------- | ---------------------------------------------------- | ------------------- |
| `DISCORD_TOKEN`     | Bot token from the Developer Portal                  | required            |
| `ANTHROPIC_API_KEY` | Pays for the summaries of every server the bot is in | required            |
| `TIMEZONE`          | IANA timezone for days and times in summaries        | `Europe/Bratislava` |
| `SUMMARY_LANGUAGE`  | Language of summaries and replies, `sk` or `en`      | `sk`                |

The bot registers `/summary` on start. It answers only while the process runs; if the command
does not show up right away, reload the Discord client (Ctrl+R).

One API key serves every server the bot is in, so invite it only to servers whose summaries you
are willing to pay for.

## Development

```sh
npm run check   # Biome lint and format check, TypeScript, tests
```

`npm run summarize` builds a summary from the command line without the slash command, which is
handy for tuning the prompt. It writes the transcript and the summaries to `out/` (git-ignored,
it contains real messages):

```sh
npm run summarize -- --channel <channel id> --days 7 --dry-run        # transcript only, free
npm run summarize -- --channel <channel id> --days 7 --tier better    # Claude Sonnet
npm run summarize -- --channel <channel id> --days 14 --until 2025-06-30 --tier both
```

Options: `--tier cheap|better|both` (Haiku, Sonnet), `--effort low|medium|high`,
`--language sk`, `--min-reactions 3`, `--until <date>` to end the window in the past. Copy a
channel ID with Developer Mode on (User Settings, Advanced) and right-click the channel.

| Path                                | Contents                                                        |
| ----------------------------------- | --------------------------------------------------------------- |
| `src/bot.ts`                        | entry point, command registration                               |
| `src/summary-command.ts`            | `/summary`: checks, cooldown, posting the card                  |
| `src/discord-fetch.ts`              | fetching messages, threads, reactions and names                 |
| `src/transcript.ts`                 | the transcript format the model reads, and its injection safety |
| `src/prompt.ts`, `src/summarize.ts` | instructions for Claude and the API call                        |
| `src/output.ts`                     | link filtering, jump links, splitting long summaries            |

## License

GPL-3.0-or-later, see [LICENSE](LICENSE).
