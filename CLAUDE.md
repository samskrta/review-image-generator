# CLAUDE.md

## Project Overview

**review-image-generator** is a Node.js microservice that converts customer reviews into branded 1080x1080px PNG images for social media (Instagram, Facebook, etc.). It is designed to be called from n8n automation workflows via its HTTP API.

The stack is intentionally minimal: Express serves an API and static files, Puppeteer renders an HTML/CSS template to PNG, and a vanilla JS frontend provides a web UI for manual image generation.

## Repository Structure

```
review-image-generator/
├── server.js            # Express API server (main entry point)
├── template.html        # HTML/CSS template rendered by Puppeteer into PNG
├── public/
│   └── index.html       # Frontend web UI (vanilla JS, single file)
├── config.json          # Company branding config (not in repo, required at runtime)
├── package.json         # Dependencies and scripts
└── README.md            # Brief project description
```

There is no `src/`, `lib/`, `test/`, or `dist/` directory. The entire backend is in `server.js` (~115 lines).

## Tech Stack

- **Runtime:** Node.js >= 18
- **Server:** Express 4.x
- **Rendering:** Puppeteer 22.x (headless Chromium)
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Template engine:** None — uses `String.replace()` with `{{PLACEHOLDER}}` patterns

## Quick Start

```bash
npm install
npm start          # Starts server on port 3000 (or $PORT)
```

**Prerequisite:** A `config.json` file must exist in the project root. The server loads it synchronously on startup and will crash if it is missing. Expected shape:

```json
{
  "company": {
    "name": "Company Name",
    "brandColor": "#c41230",
    "brandColorDark": "#8b0000",
    "logoUrl": "/logo.png",
    "phone": "123-456-7890"
  }
}
```

## API Endpoints

| Method | Path               | Description                                      |
|--------|--------------------|--------------------------------------------------|
| GET    | `/api/config`      | Returns the company config object                |
| GET    | `/api/technicians` | Lists technician photos from `public/technicians/` |
| POST   | `/generate`        | Generates a review card PNG image                |

### POST `/generate` request body

```json
{
  "reviewer_name": "string (required)",
  "rating": 1-5,
  "review_text": "string (required)",
  "tech_photo_url": "string (optional)",
  "tech_name": "string (optional)"
}
```

Response: PNG image binary (`Content-Type: image/png`) or JSON error.

## Key Code Patterns

### Template rendering

`server.js` reads `template.html`, performs string replacements for all `{{PLACEHOLDER}}` values, then feeds the HTML to Puppeteer which renders it at 1080x1080px and screenshots it as PNG.

```
template.html  →  string replace  →  Puppeteer setContent  →  screenshot  →  PNG buffer
```

### Low-rating mode

When `rating <= 3`, a "stark mode" CSS class is applied that darkens the card and hides company branding elements. The class name is injected via the `{{LOW_RATING_CLASS}}` placeholder.

### Dynamic font sizing

Both `template.html` and `public/index.html` include a font-sizing algorithm that shrinks review text to fit within the card container, decrementing `fontSize` by 2px until the text fits (minimum 18px).

### Puppeteer launch flags

Puppeteer is launched with `--no-sandbox` and `--disable-setuid-sandbox` for Docker/container compatibility. This is intentional.

### Static file serving

`public/` is served as a static directory. Technician photos go in `public/technicians/`. The company logo can also be placed here.

## Development Notes

- **No build step.** Files are served directly — edit and restart.
- **No test suite.** There are no tests, test runner, or test dependencies.
- **No linter/formatter configured.** No ESLint or Prettier config files.
- **No CI/CD.** No GitHub Actions or other automation.
- **No TypeScript.** Plain JavaScript throughout.
- **Single npm script:** `npm start` → `node server.js`

## Code Style Conventions

- Plain ES module-style `require()` imports (CommonJS)
- `const` for all declarations where possible
- `async/await` for asynchronous operations
- Try/catch error handling with JSON error responses
- Console logging only (`console.log`, `console.error`)
- No semicolons are used inconsistently — some files use them, some don't

## Known Limitations

1. **`config.json` not in repo** — must be created manually before running
2. **Hardcoded `localhost` base URL** — `server.js` line 61 constructs asset URLs as `http://localhost:${PORT}`, which won't work in non-local deployments
3. **Synchronous file reads** — `fs.readFileSync()` is used for config and template loading
4. **No input sanitization** — review text is injected directly into HTML (mitigated by Puppeteer's isolated rendering, but still a concern)
5. **No rate limiting** on the `/generate` endpoint
6. **Browser instance per request** — Puppeteer launches and closes a new browser for each image generation
