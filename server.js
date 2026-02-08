const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

// ---------------------------------------------------------------------------
// Config loading with graceful error
// ---------------------------------------------------------------------------
const configPath = path.join(__dirname, "config.json");
if (!fs.existsSync(configPath)) {
  console.error(
    "ERROR: config.json not found.\n" +
    "Copy the example and fill in your values:\n" +
    "  cp config.example.json config.json\n"
  );
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "";

const SIZE_PRESETS = {
  "square":    { width: 1080, height: 1080 },
  "portrait":  { width: 1080, height: 1350 },
  "story":     { width: 1080, height: 1920 },
  "landscape": { width: 1200, height: 630  },
};
const DEFAULT_SIZE = "square";
const ALLOWED_FORMATS = ["png", "jpeg"];
const MAX_TEXT_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;
const MAX_BATCH_SIZE = 20;
const BATCH_CONCURRENCY = 3;

// In-memory LRU image cache
const IMAGE_CACHE_MAX = 100;
const imageCache = new Map();

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
const TEMPLATES_DIR = path.join(__dirname, "templates");

function getTemplateList() {
  if (!fs.existsSync(TEMPLATES_DIR)) return ["default"];
  const dirs = fs.readdirSync(TEMPLATES_DIR).filter((f) => {
    const full = path.join(TEMPLATES_DIR, f);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "template.html"));
  });
  if (dirs.length === 0) return ["default"];
  return dirs;
}

function loadTemplate(name) {
  if (!name || name === "default") {
    return fs.readFileSync(path.join(__dirname, "template.html"), "utf8");
  }
  const templatePath = path.join(TEMPLATES_DIR, name, "template.html");
  if (!fs.existsSync(templatePath)) {
    return null;
  }
  return fs.readFileSync(templatePath, "utf8");
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Shared Puppeteer browser instance
// ---------------------------------------------------------------------------
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveAssetUrl(urlValue, baseUrl) {
  if (!urlValue) return "";
  if (urlValue.startsWith("http")) return urlValue;
  return `${baseUrl}${urlValue}`;
}

function getBaseUrl(req) {
  if (BASE_URL) return BASE_URL;
  const protocol = req.protocol;
  const host = req.get("host");
  return `${protocol}://${host}`;
}

function cacheKey(params) {
  return crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex");
}

function cacheGet(key) {
  if (!imageCache.has(key)) return null;
  const entry = imageCache.get(key);
  // Move to end (most recently used)
  imageCache.delete(key);
  imageCache.set(key, entry);
  return entry;
}

function cacheSet(key, value) {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    // Evict oldest (first) entry
    const oldest = imageCache.keys().next().value;
    imageCache.delete(oldest);
  }
  imageCache.set(key, value);
}

const PLATFORM_ICONS = {
  google: { icon: "G", color: "#4285F4", label: "Google Review" },
  yelp: { icon: "Y", color: "#d32323", label: "Yelp Review" },
  facebook: { icon: "f", color: "#1877F2", label: "Facebook Review" },
  bbb: { icon: "BBB", color: "#005A78", label: "BBB Review" },
};

function buildPlatformBadgeHtml(source) {
  if (!source || !PLATFORM_ICONS[source]) return "";
  const p = PLATFORM_ICONS[source];
  return `<div style="
    position:absolute; top:20px; right:20px;
    display:flex; align-items:center; gap:8px;
    background:${p.color}; color:#fff;
    padding:8px 16px; border-radius:20px;
    font-family:'Montserrat',sans-serif; font-size:14px; font-weight:700;
    letter-spacing:0.03em; z-index:10;
  "><span style="font-size:18px; font-weight:800;">${escapeHtml(p.icon)}</span> ${escapeHtml(p.label)}</div>`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateGenerateInput(body) {
  const errors = [];
  if (!body.reviewer_name || typeof body.reviewer_name !== "string" || !body.reviewer_name.trim()) {
    errors.push({ field: "reviewer_name", message: "Reviewer name is required" });
  } else if (body.reviewer_name.length > MAX_NAME_LENGTH) {
    errors.push({ field: "reviewer_name", message: `Reviewer name must be under ${MAX_NAME_LENGTH} characters` });
  }

  const rating = parseInt(body.rating);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    errors.push({ field: "rating", message: "Rating must be a number between 1 and 5" });
  }

  if (!body.review_text || typeof body.review_text !== "string" || !body.review_text.trim()) {
    errors.push({ field: "review_text", message: "Review text is required" });
  } else if (body.review_text.length > MAX_TEXT_LENGTH) {
    errors.push({ field: "review_text", message: `Review text must be under ${MAX_TEXT_LENGTH} characters` });
  }

  if (body.tech_name && body.tech_name.length > MAX_NAME_LENGTH) {
    errors.push({ field: "tech_name", message: `Technician name must be under ${MAX_NAME_LENGTH} characters` });
  }

  if (body.size && !SIZE_PRESETS[body.size]) {
    errors.push({ field: "size", message: `Invalid size. Options: ${Object.keys(SIZE_PRESETS).join(", ")}` });
  }

  if (body.format && !ALLOWED_FORMATS.includes(body.format)) {
    errors.push({ field: "format", message: `Invalid format. Options: ${ALLOWED_FORMATS.join(", ")}` });
  }

  if (body.source && !PLATFORM_ICONS[body.source]) {
    errors.push({ field: "source", message: `Invalid source. Options: ${Object.keys(PLATFORM_ICONS).join(", ")}` });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Core render function
// ---------------------------------------------------------------------------
async function renderImage(params, req) {
  const {
    reviewer_name,
    rating,
    review_text,
    tech_photo_url,
    tech_name,
    size = DEFAULT_SIZE,
    format = "png",
    template = "default",
    source,
    brand_color,
    brand_color_dark,
    logo_url,
  } = params;

  // Check cache
  const key = cacheKey(params);
  const cached = cacheGet(key);
  if (cached && cached.format === format) {
    return { buffer: cached.buffer, format: cached.format, fromCache: true };
  }

  const startTime = Date.now();

  let html = loadTemplate(template);
  if (!html) {
    throw { status: 400, message: `Template "${template}" not found` };
  }

  const filledStars = Math.min(Math.max(parseInt(rating) || 0, 0), 5);
  const starsHtml = "\u2605".repeat(filledStars);

  const baseUrl = getBaseUrl(req);
  const c = config.company;
  const effectiveBrandColor = brand_color || c.brandColor;
  const effectiveBrandColorDark = brand_color_dark || c.brandColorDark;
  const effectiveLogoUrl = resolveAssetUrl(logo_url || c.logoUrl, baseUrl);
  const techPhotoFullUrl = resolveAssetUrl(tech_photo_url, baseUrl);

  const hasTech = tech_photo_url && tech_name;
  const isLowRating = filledStars <= 3;

  const platformBadge = buildPlatformBadgeHtml(source);

  html = html
    .replace(/\{\{BRAND_COLOR\}\}/g, escapeHtml(effectiveBrandColor))
    .replace(/\{\{BRAND_COLOR_DARK\}\}/g, escapeHtml(effectiveBrandColorDark))
    .replace("{{COMPANY_NAME}}", escapeHtml(c.name))
    .replace("{{COMPANY_PHONE}}", escapeHtml(c.phone || ""))
    .replace("{{LOGO_URL}}", effectiveLogoUrl)
    .replace("{{REVIEWER_NAME}}", escapeHtml(reviewer_name))
    .replace("{{REVIEW_TEXT}}", escapeHtml(review_text))
    .replace("{{STARS}}", starsHtml)
    .replace("{{TECH_PHOTO_URL}}", techPhotoFullUrl)
    .replace("{{TECH_NAME}}", escapeHtml(tech_name || ""))
    .replace(/\{\{TECH_DISPLAY\}\}/g, hasTech ? "flex" : "none")
    .replace(/\{\{LOW_RATING_CLASS\}\}/g, isLowRating ? "low-rating" : "")
    .replace("{{PLATFORM_BADGE}}", platformBadge);

  const dimensions = SIZE_PRESETS[size] || SIZE_PRESETS[DEFAULT_SIZE];
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setViewport({ width: dimensions.width, height: dimensions.height });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const screenshotOpts = {
      type: format,
      clip: { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
    };
    if (format === "jpeg") screenshotOpts.quality = 90;

    const buffer = await page.screenshot(screenshotOpts);
    const durationMs = Date.now() - startTime;

    cacheSet(key, { buffer, format });

    return { buffer, format, durationMs, width: dimensions.width, height: dimensions.height, fromCache: false };
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    browserConnected: browser ? browser.isConnected() : false,
  });
});

// Serve config to frontend
app.get("/api/config", (req, res) => {
  res.json(config);
});

// List available templates
app.get("/api/templates", (req, res) => {
  const templates = getTemplateList();
  res.json(templates.map((name) => ({ name })));
});

// List available sizes
app.get("/api/sizes", (req, res) => {
  res.json(SIZE_PRESETS);
});

// List available platforms
app.get("/api/platforms", (req, res) => {
  res.json(
    Object.entries(PLATFORM_ICONS).map(([key, val]) => ({
      key,
      label: val.label,
      color: val.color,
    }))
  );
});

// List technician photos
app.get("/api/technicians", (req, res) => {
  const techDir = path.join(__dirname, "public", "technicians");
  try {
    if (!fs.existsSync(techDir)) {
      return res.json([]);
    }
    const files = fs
      .readdirSync(techDir)
      .filter((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .map((f) => ({
        name: f.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
        filename: f,
        url: `/technicians/${f}`,
      }));
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

// Upload technician photo
app.post("/api/technicians/upload", express.raw({ type: "image/*", limit: "5mb" }), (req, res) => {
  const techDir = path.join(__dirname, "public", "technicians");
  if (!fs.existsSync(techDir)) {
    fs.mkdirSync(techDir, { recursive: true });
  }

  const name = req.query.name;
  if (!name || !/^[a-zA-Z0-9 _-]+$/.test(name)) {
    return res.status(400).json({ error: "Provide a valid ?name= query parameter (alphanumeric, spaces, dashes, underscores)" });
  }

  const contentType = req.get("content-type") || "image/png";
  const extMap = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
  const ext = extMap[contentType] || ".png";
  const filename = name.replace(/\s+/g, "-") + ext;
  const filepath = path.join(techDir, filename);

  fs.writeFileSync(filepath, req.body);
  res.json({ name, filename, url: `/technicians/${filename}` });
});

// Generate image — POST (primary)
app.post("/generate", async (req, res) => {
  try {
    const errors = validateGenerateInput(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const nocache = req.query.nocache === "1";
    const params = { ...req.body };
    if (nocache) params._nocache = Date.now();

    // Callback mode: async processing
    if (req.body.callback_url) {
      res.status(202).json({ status: "accepted", message: "Image generation started. Result will be POSTed to callback_url." });
      try {
        const result = await renderImage(params, req);
        const fetch = (await import("node-fetch")).default;
        await fetch(req.body.callback_url, {
          method: "POST",
          headers: { "Content-Type": `image/${result.format}` },
          body: result.buffer,
        });
      } catch (err) {
        console.error("Callback delivery failed:", err.message);
      }
      return;
    }

    const result = await renderImage(params, req);
    const contentType = result.format === "jpeg" ? "image/jpeg" : "image/png";

    res.set("Content-Type", contentType);
    res.set("X-Image-Width", String(result.width || 1080));
    res.set("X-Image-Height", String(result.height || 1080));
    if (result.durationMs) res.set("X-Generation-Time-Ms", String(result.durationMs));
    if (result.fromCache) res.set("X-Cache", "HIT");
    res.send(result.buffer);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Error generating image:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Generate image — GET (for simple integrations)
app.get("/generate", async (req, res) => {
  try {
    const body = {
      reviewer_name: req.query.reviewer_name,
      rating: req.query.rating,
      review_text: req.query.review_text,
      tech_photo_url: req.query.tech_photo_url || undefined,
      tech_name: req.query.tech_name || undefined,
      size: req.query.size || undefined,
      format: req.query.format || undefined,
      template: req.query.template || undefined,
      source: req.query.source || undefined,
    };

    const errors = validateGenerateInput(body);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const nocache = req.query.nocache === "1";
    const params = { ...body };
    if (nocache) params._nocache = Date.now();

    const result = await renderImage(params, req);
    const contentType = result.format === "jpeg" ? "image/jpeg" : "image/png";

    res.set("Content-Type", contentType);
    res.set("X-Image-Width", String(result.width || 1080));
    res.set("X-Image-Height", String(result.height || 1080));
    if (result.durationMs) res.set("X-Generation-Time-Ms", String(result.durationMs));
    if (result.fromCache) res.set("X-Cache", "HIT");
    res.send(result.buffer);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Error generating image:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Slack integration
// ---------------------------------------------------------------------------

function slackConfigured() {
  return !!(config.slack && config.slack.botToken);
}

function getSlackTechMention(techName) {
  if (!techName || !config.slack || !config.slack.technicians) return techName || "";
  const slackId = config.slack.technicians[techName];
  if (slackId) return `<@${slackId}>`;
  // Try case-insensitive match
  const key = Object.keys(config.slack.technicians).find(
    (k) => k.toLowerCase() === techName.toLowerCase()
  );
  if (key) return `<@${config.slack.technicians[key]}>`;
  return techName;
}

function slackApiRequest(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const isMultipart = typeof body === "object" && body._multipart;
    let headers;
    let data;

    if (isMultipart) {
      const boundary = "----SlackBoundary" + crypto.randomBytes(8).toString("hex");
      const parts = [];
      for (const [key, val] of Object.entries(body.fields)) {
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`
        );
      }
      if (body.file) {
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${body.file.filename}"\r\nContent-Type: ${body.file.contentType}\r\n\r\n`
        );
        parts.push(body.file.data);
        parts.push("\r\n");
      }
      parts.push(`--${boundary}--\r\n`);

      const bufferParts = parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p));
      data = Buffer.concat(bufferParts);
      headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": data.length,
      };
    } else {
      data = Buffer.from(payload);
      headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": data.length,
      };
    }

    const req = https.request(
      {
        hostname: "slack.com",
        path: `/api/${apiPath}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error("Invalid Slack API response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// Expose Slack config status to frontend
app.get("/api/slack/status", (req, res) => {
  res.json({
    configured: slackConfigured(),
    channel: config.slack ? config.slack.channel || "#reviews" : null,
  });
});

// Share to Slack
app.post("/api/share/slack", async (req, res) => {
  try {
    if (!slackConfigured()) {
      return res.status(400).json({
        error: "Slack not configured. Set slack.botToken in config.json.",
      });
    }

    const { reviewer_name, rating, review_text, tech_name, source, message } = req.body;

    if (!reviewer_name || !rating || !review_text) {
      return res.status(400).json({ error: "Missing review data (reviewer_name, rating, review_text)" });
    }

    // First, generate the image
    const errors = validateGenerateInput(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const result = await renderImage(req.body, req);

    const token = config.slack.botToken;
    const channel = config.slack.channel || "#reviews";
    const stars = "\u2B50".repeat(Math.min(Math.max(parseInt(rating) || 0, 0), 5));

    // Build message text
    const techMention = tech_name ? getSlackTechMention(tech_name) : "";
    const platformLabel = source && PLATFORM_ICONS[source] ? ` (${PLATFORM_ICONS[source].label})` : "";
    const customMsg = message ? `\n${message}` : "";

    const slackText =
      `${stars} *New ${rating}-Star Review*${platformLabel}\n` +
      `*${reviewer_name}* says:\n` +
      `> ${review_text}\n` +
      (techMention ? `Technician: ${techMention}\n` : "") +
      customMsg;

    // Upload file to Slack (files.upload v1 — widely supported)
    const ext = result.format === "jpeg" ? "jpg" : "png";
    const uploadResult = await slackApiRequest("POST", "files.upload", token, {
      _multipart: true,
      fields: {
        channels: channel,
        initial_comment: slackText,
        filename: `review-${reviewer_name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.${ext}`,
        title: `${rating}-Star Review from ${reviewer_name}`,
      },
      file: {
        filename: `review.${ext}`,
        contentType: result.format === "jpeg" ? "image/jpeg" : "image/png",
        data: result.buffer,
      },
    });

    if (!uploadResult.ok) {
      console.error("Slack API error:", uploadResult.error);
      return res.status(502).json({
        error: "Slack API error",
        detail: uploadResult.error,
      });
    }

    res.json({
      success: true,
      channel,
      messageTs: uploadResult.file ? uploadResult.file.shares : null,
    });
  } catch (err) {
    console.error("Slack share error:", err);
    res.status(500).json({ error: "Failed to share to Slack" });
  }
});

// Batch generate
app.post("/generate/batch", async (req, res) => {
  try {
    const { reviews } = req.body;
    if (!Array.isArray(reviews) || reviews.length === 0) {
      return res.status(400).json({ error: "Request body must contain a non-empty 'reviews' array" });
    }
    if (reviews.length > MAX_BATCH_SIZE) {
      return res.status(400).json({ error: `Maximum ${MAX_BATCH_SIZE} reviews per batch` });
    }

    // Validate all inputs first
    for (let i = 0; i < reviews.length; i++) {
      const errors = validateGenerateInput(reviews[i]);
      if (errors.length > 0) {
        return res.status(400).json({ error: `Validation failed for review at index ${i}`, details: errors });
      }
    }

    // Process with concurrency limit
    const results = [];
    for (let i = 0; i < reviews.length; i += BATCH_CONCURRENCY) {
      const chunk = reviews.slice(i, i + BATCH_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (review, idx) => {
          try {
            const result = await renderImage(review, req);
            return {
              index: i + idx,
              success: true,
              image: result.buffer.toString("base64"),
              format: result.format || "png",
              width: result.width,
              height: result.height,
            };
          } catch (err) {
            return {
              index: i + idx,
              success: false,
              error: err.message || "Generation failed",
            };
          }
        })
      );
      results.push(...chunkResults);
    }

    res.json({ results });
  } catch (err) {
    console.error("Batch generation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function start() {
  // Pre-launch browser so first request is fast
  await getBrowser();
  console.log("Puppeteer browser launched");

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down...");
  if (browser) {
    await browser.close();
    browser = null;
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
