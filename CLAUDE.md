# CLAUDE.md

## Project Overview

**review-image-generator** is a Node.js microservice that converts customer reviews into branded PNG images for social media (Instagram, Facebook, Stories, etc.). It supports multiple output sizes, formats, templates, and platform badges. Designed to be called from n8n automation workflows via HTTP API, or used interactively through the web UI.

The stack is intentionally minimal: Express serves an API and static files, Puppeteer renders HTML/CSS templates to PNG/JPEG, and a vanilla JS frontend provides a web UI.

## Repository Structure

```
review-image-generator/
├── server.js                  # Express API server (main entry point)
├── template.html              # Default HTML/CSS template for review cards
├── templates/                 # Additional template variants
│   ├── minimal/template.html  # Clean, centered design
│   └── dark/template.html     # Dark-themed with glow effects
├── public/
│   ├── index.html             # Frontend web UI (vanilla JS, single file)
│   └── technicians/           # Technician photos (created at runtime)
├── tests/
│   └── server.test.js         # Integration tests (Node.js test runner)
├── config.json                # Company branding config (not in repo, required)
├── config.example.json        # Example config — copy to config.json
├── package.json               # Dependencies and scripts
├── Dockerfile                 # Production container image
├── .dockerignore              # Docker build exclusions
├── .eslintrc.json             # ESLint configuration
├── .prettierrc.json           # Prettier configuration
├── .github/workflows/ci.yml   # GitHub Actions CI pipeline
├── CLAUDE.md                  # This file
└── README.md                  # Brief project description
```

## Tech Stack

- **Runtime:** Node.js >= 18
- **Server:** Express 4.x
- **Rendering:** Puppeteer 22.x (headless Chromium, shared browser instance)
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Template engine:** None — uses `String.replace()` with `{{PLACEHOLDER}}` patterns
- **Testing:** Node.js built-in test runner (`node --test`)
- **Linting:** ESLint 8.x + Prettier 3.x

## Quick Start

```bash
cp config.example.json config.json    # Create config (edit with your values)
npm install
npm start                             # Production: port 3000 (or $PORT)
npm run dev                           # Development: auto-reload on file changes
```

## npm Scripts

| Script         | Command              | Description                         |
|----------------|----------------------|-------------------------------------|
| `npm start`    | `node server.js`     | Start production server             |
| `npm run dev`  | `node --watch server.js` | Start with auto-reload          |
| `npm test`     | `node --test tests/` | Run integration test suite          |
| `npm run lint` | `eslint .`           | Lint JavaScript files               |
| `npm run format` | `prettier --write .` | Auto-format all files             |

## Environment Variables

| Variable   | Default | Description                                                |
|------------|---------|------------------------------------------------------------|
| `PORT`     | `3000`  | Server listen port                                         |
| `BASE_URL` | (auto)  | Base URL for asset resolution (e.g. `https://example.com`) |

When `BASE_URL` is not set, the server derives it from the incoming request's `Host` header.

## API Endpoints

| Method | Path                       | Description                              |
|--------|----------------------------|------------------------------------------|
| GET    | `/health`                  | Health check (status, uptime, browser)   |
| GET    | `/api/config`              | Returns company config                   |
| GET    | `/api/templates`           | Lists available templates                |
| GET    | `/api/sizes`               | Lists size presets                        |
| GET    | `/api/platforms`           | Lists supported review platforms          |
| GET    | `/api/technicians`         | Lists technician photos                  |
| POST   | `/api/technicians/upload`  | Upload a technician photo                |
| GET    | `/api/slack/status`        | Returns Slack integration status         |
| POST   | `/api/share/slack`         | Share a review image to Slack            |
| POST   | `/generate`                | Generate a review card image             |
| GET    | `/generate`                | Generate via query params (simple integrations) |
| POST   | `/generate/batch`          | Generate multiple images at once         |

### POST `/generate` — full request body

```json
{
  "reviewer_name": "string (required)",
  "rating": "1-5 (required)",
  "review_text": "string (required)",
  "tech_photo_url": "string (optional)",
  "tech_name": "string (optional)",
  "template": "default | minimal | dark (optional)",
  "size": "square | portrait | story | landscape (optional, default: square)",
  "format": "png | jpeg (optional, default: png)",
  "source": "google | yelp | facebook | bbb (optional)",
  "brand_color": "#hex (optional, overrides config)",
  "brand_color_dark": "#hex (optional, overrides config)",
  "logo_url": "string (optional, overrides config)",
  "callback_url": "string (optional, enables async mode)"
}
```

**Response:** Image binary with headers:
- `Content-Type: image/png` or `image/jpeg`
- `X-Image-Width`, `X-Image-Height` — rendered dimensions
- `X-Generation-Time-Ms` — render duration
- `X-Cache: HIT` — when served from cache

**Size presets:**
- `square` — 1080x1080 (Instagram post)
- `portrait` — 1080x1350 (Instagram portrait)
- `story` — 1080x1920 (Instagram/Facebook Story)
- `landscape` — 1200x630 (Facebook/Open Graph)

### POST `/generate/batch`

```json
{
  "reviews": [
    { "reviewer_name": "...", "rating": 5, "review_text": "..." },
    { "reviewer_name": "...", "rating": 4, "review_text": "..." }
  ]
}
```

Returns JSON with base64-encoded images. Max 20 reviews per batch, 3 rendered concurrently.

## Key Code Patterns

### Template rendering pipeline

```
loadTemplate(name)  →  string replace {{PLACEHOLDERS}}  →  Puppeteer page.setContent()  →  screenshot  →  buffer
```

The `renderImage()` function in `server.js` is the core render logic used by all endpoints.

### Shared browser instance

Puppeteer launches once at startup (`getBrowser()`) and reuses the browser across requests. Each request opens a new page, renders, then closes the page. The browser auto-reconnects if it disconnects. Graceful shutdown via `SIGTERM`/`SIGINT` handlers closes the browser.

### Image caching

An in-memory LRU cache (Map-based, max 100 entries) stores rendered images keyed by SHA-256 of the input params. Pass `?nocache=1` to bypass.

### Input sanitization

All user-provided text is HTML-escaped via `escapeHtml()` before template injection. Input lengths are validated (2000 chars for review text, 100 for names).

### Templates

Templates live in `templates/<name>/template.html`. The `default` template is `template.html` in the project root. All templates must support the same `{{PLACEHOLDER}}` set including `{{PLATFORM_BADGE}}`.

### Platform badges

When `source` is provided (google, yelp, facebook, bbb), an absolutely-positioned badge is injected into the rendered HTML via `{{PLATFORM_BADGE}}`.

### Low-rating mode

When `rating <= 3`, a `low-rating` CSS class is applied via `{{LOW_RATING_CLASS}}`, darkening the card and hiding branding.

## Testing

```bash
npm test
```

Tests use Node.js built-in test runner. The test suite starts the server on port 3099, runs integration tests against all endpoints, then shuts down. Tests cover:
- Health check
- Config/templates/sizes/platforms API
- Input validation (missing fields, invalid rating, invalid size/format)
- PNG and JPEG generation (verifies magic bytes)
- Size parameter behavior
- Cache HIT on duplicate requests
- GET /generate query string mode
- Batch generation

## Docker

```bash
docker build -t review-image-generator .
docker run -p 3000:3000 -v $(pwd)/config.json:/app/config.json review-image-generator
```

The Dockerfile uses `node:18-slim` with system Chromium. Puppeteer `--no-sandbox` flags are intentional for container use.

## Slack Integration

The app can share generated review images directly to a Slack channel with technician @-mentions.

### Setup

Add a `slack` block to `config.json`:

```json
{
  "company": { ... },
  "slack": {
    "botToken": "xoxb-your-bot-token",
    "channel": "#reviews",
    "technicians": {
      "John Smith": "U0123456789",
      "Jane Doe": "U9876543210"
    }
  }
}
```

**Requirements:**
- A Slack Bot Token (`xoxb-...`) with `files:write` and `chat:write` scopes
- The bot must be invited to the target channel
- The `technicians` map links technician display names to their Slack User IDs

### How it works

1. `GET /api/slack/status` — frontend checks if Slack is configured; if so, shows the "Share to Slack" button
2. `POST /api/share/slack` — generates the image, uploads it to the configured Slack channel with a formatted message
3. If the review includes a `tech_name` that matches a key in `slack.technicians`, the technician is @-mentioned in the Slack message (e.g., `Technician: <@U0123456789>`)

### Slack message format

```
:star::star::star::star::star: *New 5-Star Review* (Google Review)
*Jane D.* says:
> Amazing service, highly recommend!
Technician: @John Smith
```

The review card image is attached as a file upload to the message.

## Code Style

- CommonJS `require()` imports
- `const` by default, `let` only when reassignment needed
- `async/await` for all async operations
- Semicolons: yes (enforced by Prettier)
- Double quotes (enforced by Prettier)
- 120-char line width
- ESLint `eslint:recommended` ruleset
- `console.log`/`console.error` for logging (no structured logger)

## CI/CD

GitHub Actions runs on push to `main` and on PRs:
1. **lint** — `npm ci && npm run lint`
2. **test** — `npm ci && npm test`
3. **docker** — `docker build` to verify the image builds
