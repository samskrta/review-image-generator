const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// --- Health Check ---
app.get("/", (req, res) => {
  res.status(200).send("Review Image Generator is running 🚀");
});

// --- POST /render  (MAIN ENDPOINT) ---
app.post("/render", async (req, res) => {
  try {
    const { reviewer_name, rating, review_text } = req.body;

    if (!reviewer_name || !rating || !review_text) {
      return res.status(400).json({
        error: "Missing required fields: reviewer_name, rating, review_text",
      });
    }

    // Load Template
    const templatePath = path.join(__dirname, "template.html");
    let templateHtml = fs.readFileSync(templatePath, "utf8");

    // Replace placeholders
    templateHtml = templateHtml
      .replace("{{reviewer_name}}", reviewer_name)
      .replace("{{rating}}", "⭐".repeat(rating))
      .replace("{{review_text}}", review_text);

    // Launch browser
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-userns"],
    });

    const page = await browser.newPage();
    await page.setContent(templateHtml, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });

    await browser.close();

    // Return Base64 PNG
    res.json({
      success: true,
      image_base64: buffer.toString("base64"),
    });
  } catch (error) {
    console.error("Render error:", error);
    res.status(500).json({
      error: "Rendering failed",
      details: error.message,
    });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on PORT ${PORT}`);
});
