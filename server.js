const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();

app.use(cors());
app.use(bodyParser.json());

// Health check (so Railway knows the service is alive)
app.get("/", (req, res) => {
  res.send("Review Image Generator is running 🚀");
});

// MAIN ROUTE — Generate PNG
app.post("/generate-image", async (req, res) => {
  try {
    const { reviewer, rating, review_text } = req.body;

    if (!reviewer || !rating || !review_text) {
      return res.status(400).json({
        error: "Missing required fields: reviewer, rating, review_text"
      });
    }

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    // Load the HTML template
    const fs = require("fs");
    const template = fs.readFileSync("./template.html", "utf8");

    const html = template
      .replace("{{reviewer}}", reviewer)
      .replace("{{rating}}", rating)
      .replace("{{review_text}}", review_text);

    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({
      type: "png"
    });

    await browser.close();

    res.set("Content-Type", "image/png");
    res.send(buffer);

  } catch (err) {
    console.error("Error generating image:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
