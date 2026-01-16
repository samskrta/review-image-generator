const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const app = express();

// Load config
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Serve config to frontend
app.get("/api/config", (req, res) => {
  res.json(config);
});

// List technician photos
app.get("/api/technicians", (req, res) => {
  const techDir = path.join(__dirname, "public", "technicians");
  try {
    if (!fs.existsSync(techDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(techDir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
      .map(f => ({
        name: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        filename: f,
        url: `/technicians/${f}`
      }));
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

app.post("/generate", async (req, res) => {
  try {
    const { reviewer_name, rating, review_text, tech_photo_url, tech_name } = req.body;

    if (!reviewer_name || !rating || !review_text) {
      return res.status(400).json({
        error: "Missing required fields: reviewer_name, rating, review_text"
      });
    }

    // Load HTML template
    const templatePath = path.join(__dirname, "template.html");
    let html = fs.readFileSync(templatePath, "utf8");

    // Generate stars based on rating
    const filledStars = Math.min(Math.max(parseInt(rating) || 0, 0), 5);
    const starsHtml = '★'.repeat(filledStars);

    // Build full URLs for assets
    const baseUrl = `http://localhost:${PORT}`;
    const logoUrl = config.company.logoUrl.startsWith('http') 
      ? config.company.logoUrl 
      : `${baseUrl}${config.company.logoUrl}`;
    const techPhotoFullUrl = tech_photo_url 
      ? (tech_photo_url.startsWith('http') ? tech_photo_url : `${baseUrl}${tech_photo_url}`)
      : '';

    // Company config replacements
    const c = config.company;
    html = html
      .replace(/\{\{BRAND_COLOR\}\}/g, c.brandColor)
      .replace(/\{\{BRAND_COLOR_DARK\}\}/g, c.brandColorDark)
      .replace("{{COMPANY_NAME}}", c.name)
      .replace("{{COMPANY_PHONE}}", c.phone || "")
      .replace("{{LOGO_URL}}", logoUrl);

    // Dynamic content replacements
    const hasTech = tech_photo_url && tech_name;
    const isLowRating = filledStars <= 3;
    html = html
      .replace("{{REVIEWER_NAME}}", reviewer_name)
      .replace("{{REVIEW_TEXT}}", review_text)
      .replace("{{STARS}}", starsHtml)
      .replace("{{TECH_PHOTO_URL}}", techPhotoFullUrl)
      .replace("{{TECH_NAME}}", tech_name || "")
      .replace(/\{\{TECH_DISPLAY\}\}/g, hasTech ? "flex" : "none")
      .replace(/\{\{LOW_RATING_CLASS\}\}/g, isLowRating ? "low-rating" : "");

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1080, height: 1080 } });
    await browser.close();

    res.set("Content-Type", "image/png");
    res.send(buffer);

  } catch (err) {
    console.error("Error generating image:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
