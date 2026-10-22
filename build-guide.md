# Build guide for AI agents

This file is written for an AI coding agent. A person should be able to paste
one short prompt and let the agent carry the rest.

## The short prompt

> Use https://github.com/Loft47/loft-mcp-client/blob/main/build-guide.md
> exactly. If you cannot open that file, stop and tell me. Then build a
> standalone app that …

## Ground rules

- If you cannot create files and run commands on the person's computer, say so
  before starting. Do not surprise them with a long list of manual steps.
- Read the README at https://github.com/Loft47/loft-mcp-client first. It is
  authoritative on wiring, OAuth, the proxy, storage and the client API. If
  this guide and the README disagree, follow the README.
- Build a standalone React + Vite app that runs locally.
- The app always talks to Loft47 through the `loft-mcp-client` npm package from
  https://github.com/Loft47/loft-mcp-client. Do not copy, vendor or rewrite its
  code, and do not write your own MCP, OAuth or proxy code in its place.
- Start on `staging`. Never use `production` unless the person explicitly asks.
- The person is not a developer. Do not ask them to edit files, run builds or
  read stack traces.

## Connect to the MCP server before building anything

Before you scaffold a project, install a package or write a single file,
connect your own session to the Loft47 MCP server. You need that connection to
learn the real tools, their inputs and the shape of the data they return. Do
not design screens, types or tool wrappers from tool names or from memory.

1. Pick the server for the environment. Default to staging:
   - staging: `https://mcp.staging.loft47.com/mcp`
   - production: `https://mcp.loft47.com/mcp` — only if the person explicitly
     asks for production.
2. Connect to it. If a Loft47 connector for that environment is already
   available in your session, use it. Otherwise add it as a remote HTTP MCP
   server; in Claude Code that is
   `claude mcp add --transport http loft47-staging https://mcp.staging.loft47.com/mcp`.
3. Have the person sign in. Sign-in is OAuth in their browser. Tell them what
   to click (in Claude Code: type `/mcp`, choose the Loft47 server, then
   authenticate). Never ask for a password or token in chat.
4. Confirm the connection works by listing the tools. If the tools do not
   appear, or sign-in fails, stop and tell the person in one sentence what went
   wrong and the one thing to try next. Do not fall back to building from
   guesses.

Once connected, gather what the app needs:

- List every tool and read each input schema: required arguments, filters,
  sort options and how pagination works.
- Call the read tools the app will use, against the person's brokerage on
  staging, and look at real responses: field names, types, ids, dates, money
  formats, nulls and nested records.
- Write down a short map of tool → arguments → fields the app will use. Build
  the app's types and wrappers from that map.
- Use this connection read-only. Never call a tool that creates, changes,
  sends or deletes anything during discovery.

Your session's MCP connection is only for discovery. The app still signs in on
its own through the client, as the README describes.

## Ask before building

Ask at most two or three questions at a time, in plain language:

- Which brokerage should the app use? Only ask this if the person can reach
  more than one brokerage on the MCP server; offer those brokerages as the
  choices. If they have exactly one, use it and tell them which one, without
  asking.
- Is there an app-specific definition you need, such as which profile type is
  an "agent" or which status means "active"? Show the real values you found on
  the server so the person can pick.
- Which environment? Default to staging.

Confirm the required tools and fields exist before designing screens. If a
field is missing, say so plainly and show what is available. Never invent a
field or leave a silent blank.

## Setup requirements

- Install the client as an npm dependency from GitHub, pinned to the latest
  release tag:
  `npm install github:Loft47/loft-mcp-client#<latest tag>` (for example
  `#v0.1.1`). It must appear under `dependencies` in the app's `package.json`.
  Import it only by package name: `loft-mcp-client`, `loft-mcp-client/react`
  and `loft-mcp-client/vite`. Never import from a relative path, a local clone
  or `node_modules/loft-mcp-client/src`.
- Create the client once at module scope with a unique `appName` and
  `storagePrefix`, and the local redirect URI.
- Set up the dev proxy with the fixed port the README requires. Do not silently
  move the port; sign-in is bound to it. If it is busy, explain the problem and
  fix both sides together.
- Handle every sign-in state the README lists, including a dedicated error
  screen. Never render the app over a session that did not finish connecting.
- Persist user choices with `scopedKey` / `brokerageKey`, not raw keys. Keep
  saved settings separate per environment and brokerage.
- The app is read-only unless the person asks for writes and the server exposes
  a write tool. Confirm that before building the control.
- Fetch every page of a list. Do not ship a first-page-only view or export.
- Run the typecheck and build yourself. Start the dev server and give the
  person the URL.
- Never ask for a password, token or secret in chat. Sign-in happens in the
  person's browser.

## Handover

When it works, give the person:

- the URL and the exact click order from sign-in to result;
- what they should see at each step;
- an acceptance test you actually ran: staging sign-in, the main flow, filters,
  reload persistence, export and opening the file;
- how to start it again next time, including a one-click launcher if the
  platform allows it, and a reminder that the local server window must stay
  open;
- where exported files are saved and whether any data leaves the machine;
- a plain list of fields or tools that were missing.
- if you are able to launch the app for them prompt the person to do so;

Explain failures in one sentence with one next action. No stack traces.

## Done means

- It runs locally from a clean start.
- Staging sign-in and brokerage selection work, error state included.
- The requested data appears with filters and saved settings.
- The export matches what is on screen.
- The person can use it again without you.
