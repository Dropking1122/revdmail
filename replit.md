# REVDMAIL – Temporary Email Service

Node.js/Express app that provides disposable email addresses backed by a real IMAP mailbox.

## How to run

```
node server.js
```

Workflow: **Start application** — runs on port 5000.

## Required environment variables (Replit Secrets)

| Variable | Description |
|---|---|
| `AVAILABLE_DOMAINS` | Comma-separated list of domains you control, e.g. `mail.example.com,tmp.example.com` |
| `IMAP_USER` | IMAP login username (usually the full email address) |
| `IMAP_PASSWORD` | IMAP password or app password |
| `IMAP_SERVER` | IMAP hostname, e.g. `imap.gmail.com` |
| `IMAP_PORT` | (optional) IMAP port, defaults to `993` |

Set all of these in **Replit Secrets** before the app can fetch mail.

**Status:** Dependencies installed and the app runs (workflow "Start application" on port 5000). The IMAP secrets above have not been provided yet, so mail fetching returns "IMAP configuration missing" — the UI otherwise loads and works. Ask the user for these secrets (via the environment-secrets flow) when they're ready to enable real mail fetching.

## Stack

- **Backend**: Node.js + Express 5, `imap-simple`, `mailparser`, `dotenv`
- **Frontend**: Vanilla JS SPA, Tailwind CSS (CDN), Ionicons

## Project structure

```
server.js                  Entry point
src/
  controllers/apiController.js   Request handlers
  routes/apiRoutes.js            API route definitions
  services/imapService.js        IMAP connection & message fetching
  utils/nameGenerator.js         Random email prefix generator
public/
  index.html                     Single-page app
  js/script.js                   Frontend state & UI logic
  css/style.css                  Custom styles (Tailwind handles the rest)
username/
  pria.txt                       Male name list for random prefixes
  perempuan.txt                  Female name list for random prefixes
```

## User preferences

- Keep existing project structure and stack
