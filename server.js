import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import puppeteer from "puppeteer";

// Fix dirname issue in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Load HTML template
const templatePath = path.join(__dirname, "template.html");
const templateHTML = fs.readFileSync(templatePath, "utf8");

// 👉 POST route that n8n will call
app.post("/generate", async (req, res) => {
  try {
    const {
      reviewer_name,
      rating,
      review_text,
      brand,
      location,
      website,
    } = req.body;

    if (!reviewer_name || !rating || !review_text) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Replace template variables
    const renderedHTML = templateHTML
      .replace("{{reviewer_name}}", reviewer_name)
      .replace("{{rating}}", "★".repeat(rating))
      .replace("{{review_text}}", review_text)
      .replace("{{brand}}", brand || "Appliance GrandMasters")
      .replace("{{location}}", location || "Greenville, SC")
      .replace("{{website}}", website || "appliancegm.com");

    // Launch puppeteer to render PNG
    const browser = await puppeteer.launch({
      args: ["--no-sandbox"],
      headless: "new",
    });

    const page = await browser.newPage();
    await page.setContent(renderedHTML);

    const pngBuffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });

    await browser.close();

    // Send PNG back to caller
    res.set("Content-Type", "image/png");
    res.send(pngBuffer);

  } catch (err) {
    console.error("Image generation error:", err);
    res.status(500).json({ error: "Failed to generate image" });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("Review Image Generator API is running.");
});

// Railway port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
