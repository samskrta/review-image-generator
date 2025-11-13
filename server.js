import express from "express";
import { createCanvas, loadImage } from "canvas";

const app = express();
app.use(express.json());

// API endpoint: POST /generate
app.post("/generate", async (req, res) => {
  const { name, rating, review, brandColor, logoUrl } = req.body;

  try {
    const width = 1080;
    const height = 1350;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = brandColor || "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.fillStyle = "#000";
    ctx.font = "bold 60px Arial";
    ctx.fillText(`⭐ ${rating} Review`, 60, 120);

    // Customer Name
    ctx.font = "bold 50px Arial";
    ctx.fillText(name, 60, 230);

    // Review Text (wrapped)
    ctx.font = "36px Arial";
    wrapText(ctx, review, 60, 320, 960, 48);

    // Logo (optional)
    if (logoUrl) {
      try {
        const logo = await loadImage(logoUrl);
        ctx.drawImage(logo, width - 240, height - 240, 180, 180);
      } catch {}
    }

    res.set("Content-Type", "image/png");
    res.send(canvas.toBuffer());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Function to wrap text automatically
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
