# Build guide for AI agents

This file is written for an AI agent — a chat assistant in a browser (Claude,
ChatGPT, Gemini, …) or a coding agent on the person's computer (Claude Code,
Cursor, Codex, …). A person should be able to paste one short prompt and let
the agent carry the rest.

## The short prompt

> Read https://raw.githubusercontent.com/Loft47/loft-mcp-client/main/build-guide.md
> and follow it exactly. If you cannot open that page, stop and tell me.
> Build it as a **prototype in this chat** / **local app on my computer**
> (pick one). It should …

For example:

> Read https://raw.githubusercontent.com/Loft47/loft-mcp-client/main/build-guide.md
> and follow it exactly. If you cannot open that page, stop and tell me.
> Build it as a prototype in this chat. It should export our agent roster to
> CSV — name, email, phone, office, team, status, start date — filterable to
> active only and by office, with a column layout I can save. For board dues,
> E&O renewal and reconciling the MLS roster.

## Reading this guide and the README

- Everything you need is on public web pages. Open them with whatever web
  browsing or URL fetching you have. You do **not** need git, a GitHub account,
  a clone of the repo, or a terminal to read them. Never ask for git access.
- Prefer the raw URLs; they are plain text and easier to read:
  - this guide: https://raw.githubusercontent.com/Loft47/loft-mcp-client/main/build-guide.md
  - the README: https://raw.githubusercontent.com/Loft47/loft-mcp-client/main/README.md
- If a raw URL fails, try the normal GitHub page
  (https://github.com/Loft47/loft-mcp-client). If neither opens, stop and say
  so in one sentence.

## Pick the build mode first

There are two ways to build. Neither one requires Claude Code or any other
particular tool. Pick the mode before doing anything else.

| | **Browser prototype** | **Local app** |
| --- | --- | --- |
| What it is | A single-page interactive prototype rendered inside the chat (an artifact, canvas or HTML preview). | A React + Vite app on the person's computer that signs in to Loft47 itself. |
| Needs | A chat window that can render HTML/React. Nothing installed. | An agent that can create files and run commands on the person's computer. |
| Data | A read-only snapshot the agent fetched through its own Loft47 connector, baked into the page. | Live, fetched by the app through the `loft-mcp-client` package every time it runs. |
| Good for | Trying an idea in minutes and showing it to someone. | A tool people use every week. |

How to choose:

1. If the person said which mode, use it.
2. If they did not — and "a standalone app" on its own does not count as
   choosing — ask once, in one sentence: "Do you want a quick prototype right
   here in the chat, or a real app installed on your computer?"
3. If you cannot do the mode they picked, say so in one sentence and offer the
   other one. Never tell the person they must switch to a different tool to get
   started. A chat assistant can always build the browser prototype; only the
   local app needs file and command access.

## Ground rules (both modes)

- The person is not a developer. Do not ask them to edit files, run builds or
  read stack traces.
- Always ask the person whether to use `staging` or `production` before
  connecting, unless they already said which in their prompt. Do not pick one
  for them. Staging holds test data; production is their live brokerage data.
  Use only the environment they chose for the whole session.
- Never ask for a password, token or secret in chat. Sign-in always happens in
  the person's browser.
- Read-only by default. Never call a tool that creates, changes, sends or
  deletes anything unless the person asks for it and the server exposes that
  write tool. Confirm before building any write control.
- Never invent a tool or a field. If something the person asked for is not on
  the server, say so plainly and show what is available.

## Connect to the MCP server before building anything

Before you design a screen or write any code, connect your own session to the
Loft47 MCP server. You need that connection to learn the real tools, their
inputs and the shape of the data they return. Do not design screens, types or
tool wrappers from tool names or from memory.

1. Ask the person which environment to use — staging or production — unless
   they already said, then pick that server:
   - staging: `https://mcp.staging.loft47.com/mcp`
   - production: `https://mcp.loft47.com/mcp`
2. Connect to it. If a Loft47 connector for that environment is already
   available in your session, use it. Otherwise tell the person how to add it
   as a remote MCP server / custom connector in the app they are using, with
   the URL above. For example:
   - Claude (claude.ai or desktop): Settings → Connectors → Add custom
     connector → paste the URL → Connect.
   - ChatGPT: Settings → Connectors (developer mode) → add the URL.
   - Claude Code: `claude mcp add --transport http loft47-<environment> <server URL>`,
     then `/mcp` → choose the Loft47 server → authenticate.
   - Anything else: its "add MCP server" or "custom connector" setting.
3. Have the person sign in. Sign-in is OAuth in their browser. Tell them what
   to click. Never ask for a password or token in chat.
4. Confirm the connection works by listing the tools. If the tools do not
   appear, or sign-in fails, stop and tell the person in one sentence what went
   wrong and the one thing to try next.

If the chat app cannot connect to MCP servers at all:

- **Local app:** carry on. The app signs in on its own; use the tool list in
  the README and confirm fields with the person once the app first connects.
- **Browser prototype:** say so, and offer to build it with clearly labelled
  sample data shaped from the README's tool list. Only do that if the person
  agrees, and show a visible "Sample data — not from Loft47" banner on every
  screen.

Once connected, gather what the app needs:

- List every tool and read each input schema: required arguments, filters,
  sort options and how pagination works.
- Call the read tools the app will use, against the person's brokerage in
  the chosen environment, and look at real responses: field names, types, ids, dates, money
  formats, nulls and nested records.
- Write down a short map of tool → arguments → fields the app will use. Build
  the app's types and screens from that map.
- Use this connection read-only.

## Ask before building

Ask at most two or three questions at a time, in plain language:

- Browser prototype or local app? (Only if they have not said.)
- Which brokerage should the app use? Only ask this if the person can reach
  more than one brokerage on the MCP server; offer those brokerages as the
  choices. If they have exactly one, use it and tell them which one, without
  asking.
- Is there an app-specific definition you need, such as which profile type is
  an "agent" or which status means "active"? Show the real values you found on
  the server so the person can pick.
- Staging or production? Always ask, unless they already said. Explain in
  one line: staging is test data, production is their live data.

Confirm the required tools and fields exist before designing screens.

## Mode A: Browser prototype

Build it directly in the chat. Do not clone, install or run anything.

Why the prototype does not sign in to Loft47 itself: the MCP hosts send no CORS
headers and the OAuth redirect is bound to `localhost:5173`, so a page running
inside a chat cannot call Loft47 directly. Instead, *you* fetch the data
through your connector and the page displays it.

- Fetch the data with your own Loft47 connection, read-only, from the chosen
  brokerage in the chosen environment. Fetch every page of each list, not just the first. If
  that is too much data for one prototype, say how much you took and why.
- Build one self-contained page: a single HTML file or React component, with
  the data embedded as a JSON constant at the top. No build step, no backend,
  no `loft-mcp-client` import (it needs the local dev proxy to work).
- Show a small header on every screen: environment, brokerage, and when the
  snapshot was taken (for example "Staging · Acme Realty · snapshot
  2026-10-23 14:05").
- Make it interactive with the embedded data: filters, sorting, search, totals,
  charts and CSV export (a client-side download) as the request needs.
- Saved settings (a column layout, a default filter): keep them in browser
  storage, wrapped so the page still works when storage is blocked, and tell
  the person they are saved only in that browser.
- Use the real field names and values from the map you wrote. Show a missing
  value as "—", and list any field the person asked for that the server does
  not have.
- Keep the data minimal: only the fields the screens use. Remind the person
  that the snapshot contains brokerage data, so they should not publish or
  share the prototype outside their team.

Handover for a prototype:

- what the prototype shows and how to use each control;
- that it is a snapshot, not live, and how to refresh it (ask you again);
- the tools and fields it relies on, and any that were missing;
- an offer to turn it into a local app that loads live data (Mode B), using the
  same screens.

## Mode B: Local app

If you cannot create files and run commands on the person's computer, say so
before starting and offer the browser prototype instead. Do not surprise them
with a long list of manual steps.

The README (https://raw.githubusercontent.com/Loft47/loft-mcp-client/main/README.md)
is authoritative for this mode on wiring, OAuth, the proxy, storage and the
client API. If this section and the README disagree, follow the README.

- Build a standalone React + Vite app that runs locally.
- The app always talks to Loft47 through the `loft-mcp-client` npm package.
  Do not copy, vendor or rewrite its code, and do not write your own MCP, OAuth
  or proxy code in its place. Your session's MCP connection is only for
  discovery; the app signs in on its own through the client.
- Install the client as an npm dependency from GitHub, pinned to the latest
  release tag: `npm install github:Loft47/loft-mcp-client#<latest tag>` (for
  example `#v0.1.1`). npm fetches it over public HTTPS; no git login is needed.
  It must appear under `dependencies` in the app's `package.json`. Import it
  only by package name: `loft-mcp-client`, `loft-mcp-client/react` and
  `loft-mcp-client/vite`. Never import from a relative path, a local clone or
  `node_modules/loft-mcp-client/src`.
- Create the client once at module scope with a unique `appName` and
  `storagePrefix`, and the local redirect URI.
- Set up the dev proxy with the fixed port the README requires. Do not silently
  move the port; sign-in is bound to it. If it is busy, explain the problem and
  fix both sides together.
- Handle every sign-in state the README lists, including a dedicated error
  screen. Never render the app over a session that did not finish connecting.
- Persist user choices with `scopedKey` / `brokerageKey`, not raw keys. Keep
  saved settings separate per environment and brokerage.
- Fetch every page of a list. Do not ship a first-page-only view or export.
- Run the typecheck and build yourself. Start the dev server and give the
  person the URL.

Handover for a local app:

- the URL and the exact click order from sign-in to result;
- what they should see at each step;
- an acceptance test you actually ran: sign-in to the chosen environment, the main flow, filters,
  reload persistence, export and opening the file;
- how to start it again next time, including a one-click launcher if the
  platform allows it, and a reminder that the local server window must stay
  open;
- where exported files are saved and whether any data leaves the machine;
- a plain list of fields or tools that were missing;
- if you are able to launch the app for them, prompt the person to do so.

Explain failures in one sentence with one next action. No stack traces.

## Done means

Browser prototype:

- It renders in the chat with no setup.
- It uses real data from the chosen environment and brokerage (or clearly labelled
  sample data the person agreed to).
- The requested views, filters, saved settings and export work on that data.
- The person knows it is a snapshot and how to get a live version.

Local app:

- It runs locally from a clean start.
- Sign-in to the chosen environment and brokerage selection work, error state included.
- The requested data appears with filters and saved settings.
- The export matches what is on screen.
- The person can use it again without you.
