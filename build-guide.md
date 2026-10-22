# Build guide for AI agents

This file is written for an AI coding agent. A person should be able to paste
one short prompt and let the agent carry the rest.

## The short prompt

> Use https://github.com/Loft47/loft-mcp-client and follow
> `docs/build-guide.md` exactly. If you cannot open that file, stop and tell me.
> Then build a standalone app that …

## Ground rules

- If you cannot create files and run commands on the person's computer, say so
  before starting. Do not surprise them with a long list of manual steps.
- Read the repository README first. It is authoritative on wiring, OAuth, the
  proxy, storage and the client API. If this guide and the README disagree,
  follow the README.
- Build a standalone React + Vite app that runs locally.
- Start on `staging`. Never use `production` unless the person explicitly asks.
- The person is not a developer. Do not ask them to edit files, run builds or
  read stack traces.

## Ask before building

Ask at most two or three questions at a time, in plain language:

- Which brokerage should the app use?
- Is there an app-specific definition you need, such as which profile type is
  an "agent" or which status means "active"?
- Which environment? Default to staging.

Then inspect the MCP server before designing screens. Confirm the required
tools and fields exist. If a field is missing, say so plainly and show what is
available. Never invent a field or leave a silent blank.

## Setup requirements

- Install the client from GitHub at a released version, as the README shows.
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
