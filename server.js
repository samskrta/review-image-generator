const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Review Image Generator API is running.");
});

// ========== MAIN POST ROUTE (fixes Cannot POST /) ==========
app.post("/generate", async (req, res) => {
  try {
    const { reviewer_name, rating, review_text, brand_color } = req.body;

    if (!reviewer_name || !rating || !review_text) {
      return res.status(400).json({
        error: "Missing required fields: reviewer_name, rating, review_text"
      });
    }

    // Load HTML template
    const templatePath = path.join(__dirname, "template.html");
    let html = fs.readFileSync(templatePath, "utf8");

    // Inject dynamic content
    html = html
      .replace("{{name}}", reviewer_name)
      .replace("{{rating}}", "⭐".repeat(rating))
      .replace("{{review}}", review_text)
      .replace("{{brand_color}}", brand_color || "#E63946");

    // Launch Puppeteer (headless browser)
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({ type: "png" });
    await browser.close();

    res.set("Content-Type", "image/png");
    res.send(buffer);

  } catch (err) {
    console.error("Error generating image:", err);
    res.status(500).json({ error: "Internal s
