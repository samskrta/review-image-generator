# review-image-generator

A tiny Node.js microservice that turns a customer review into a clean, branded PNG image
for social media (Facebook, Instagram, etc.).

## How it works

- Uses **Express** to expose an HTTP API.
- Uses **Puppeteer** to render an HTML/CSS template that looks like a review card.
- Takes `reviewer_name`, `rating`, and `review_text` as JSON input.
- Returns a PNG image you can use in your n8n automations.

## Local development

```bash
npm install
npm start
