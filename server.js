const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

let browserPromise = null;

// Lazy-launch browser once, reuse it
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }
  return browserPromise;
}

// Helper to escape HTML
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Health check route
app.get("/", (req, res) => {
  res.send("✅ review-image-generator is running");
});

/**
 * POST /review-image
 * Body JSON:
 * {
 *   "reviewer_name": "Barbara K",
 *   "rating": 5,
 *   "review_text": "We called Appliance GrandMasters based on a recommendation...",
 *   "platform": "Google" // optional
 * }
 *
 * Returns: PNG image buffer
 */
app.post("/review-image", async (req, res) => {
  try {
    const {
      reviewer_name = "Happy Customer",
      rating = 5,
      review_text = "",
      platform = "Google"
    } = req.body || {};

    const safeName = escapeHtml(reviewer_name);
    const safeReview = escapeHtml(review_text);
    const safePlatform = escapeHtml(platform);

    // Clamp rating between 1 and 5
    const stars = Math.max(1, Math.min(5, Number(rating) || 5));

    // Load HTML template
    const templatePath = path.join(__dirname, "template.html");
    let html = fs.readFileSync(templatePath, "utf8");

    // Replace placeholders
    html = html
      .replace(/{{REVIEWER_NAME}}/g, safeName)
      .replace(/{{PLATFORM}}/g, safePlatform)
      .replace(/{{REVIEW_TEXT}}/g, safeReview)
      .replace(/{{RATING}}/g, String(stars));

    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });

    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({
      type: "png",
      fullPage: true
    });

    await page.close();

    res.set("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error("Error generating image:", err);
    res.status(500).json({ error: "Failed to generate image" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 review-image-generator listening on port ${PORT}`);
});

