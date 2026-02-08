const express = require("express");
const crypto = require("crypto");

function createRoutes(ctx) {
  const router = express.Router();
  const { store, pipeline, scheduler, adapters, genericAdapter } = ctx;

  // ---- Status ----
  router.get("/status", (req, res) => {
    const stats = store.getStats();
    const adapterStatus = adapters.map((a) => ({
      name: a.name,
      enabled: a.enabled,
      lastPoll: stats.lastPollTimes[a.name] || null,
      reviewCount: stats.bySource[a.name] || 0,
    }));

    res.json({
      enabled: true,
      adapters: adapterStatus,
      stats,
    });
  });

  // ---- Recent reviews ----
  router.get("/reviews", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const source = req.query.source || null;
    const reviews = store.getRecentReviews(limit, source);
    res.json({ total: reviews.length, reviews });
  });

  // ---- Manual poll (all sources) ----
  router.post("/poll", async (req, res) => {
    try {
      const results = {};
      for (const adapter of adapters) {
        if (!adapter.enabled) continue;
        try {
          results[adapter.name] = await scheduler.pollOnce(adapter.name);
        } catch (err) {
          results[adapter.name] = { error: err.message };
        }
      }
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Manual poll (single source) ----
  router.post("/poll/:source", async (req, res) => {
    try {
      const result = await scheduler.pollOnce(req.params.source);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Webhook receiver ----
  router.post("/webhook/:source", async (req, res) => {
    const sourceName = req.params.source;
    const adapter = adapters.find((a) => a.name === sourceName) || genericAdapter;

    // Optional HMAC verification
    const sourceConfig = adapter.config || {};
    if (sourceConfig.webhookSecret) {
      const sig = req.get("x-webhook-signature") || req.get("x-hub-signature-256") || "";
      const expected = "sha256=" + crypto.createHmac("sha256", sourceConfig.webhookSecret).update(JSON.stringify(req.body)).digest("hex");
      if (sig !== expected) {
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    }

    try {
      const reviews = adapter.parseReviews(req.body);
      const results = await pipeline.process(reviews);
      res.json({ accepted: true, ...results });
    } catch (err) {
      console.error(`[webhook] ${sourceName} error:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Webhook verification (Yelp-style) ----
  router.get("/webhook/:source", (req, res) => {
    if (req.query.verification) {
      return res.json({ verification: req.query.verification });
    }
    res.json({ status: "webhook endpoint active", source: req.params.source });
  });

  // ---- Import (JSON or CSV) ----
  router.post("/import", express.text({ type: "text/csv", limit: "5mb" }), async (req, res) => {
    try {
      let reviews;
      const contentType = req.get("content-type") || "";

      if (contentType.includes("text/csv")) {
        reviews = parseCsv(req.body);
      } else {
        const body = req.body;
        const source = body.source || "import";
        const items = body.reviews || [body];

        // Use generic adapter to normalize
        reviews = genericAdapter.parseReviews({ source, reviews: items });
      }

      const results = await pipeline.process(reviews);
      res.json({ imported: results.new, duplicates: results.duplicate, errors: results.errors.length, details: results });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Generate image for a stored review ----
  router.post("/reviews/:id/generate", async (req, res) => {
    const review = store.data.reviews[req.params.id];
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    try {
      const result = await pipeline.renderImage({
        reviewer_name: review.reviewerName,
        rating: review.rating,
        review_text: review.reviewText,
        source: review.source,
        tech_name: review.techName || undefined,
        tech_photo_url: review.techPhotoUrl || undefined,
        template: req.body.template || "default",
        size: req.body.size || "square",
        format: req.body.format || "png",
      });

      store.markProcessed(req.params.id, { imageGenerated: true });

      const contentType = result.format === "jpeg" ? "image/jpeg" : "image/png";
      res.set("Content-Type", contentType);
      res.send(result.buffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Share a stored review to Slack ----
  router.post("/reviews/:id/share", async (req, res) => {
    const review = store.data.reviews[req.params.id];
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    try {
      // Generate image first
      const result = await pipeline.renderImage({
        reviewer_name: review.reviewerName,
        rating: review.rating,
        review_text: review.reviewText,
        source: review.source,
        tech_name: review.techName || undefined,
      });

      await pipeline.shareToSlack(review, result.buffer, result.format);
      store.markProcessed(req.params.id, { slackShared: true, imageGenerated: true });

      res.json({ success: true, reviewId: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// Minimal CSV parser for the expected format
function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const reviews = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length < 3) continue;

    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] || "").trim(); });

    const source = row.source || "import";
    const idHash = crypto.createHash("sha256")
      .update(`${source}:${row.reviewer_name}:${row.review_text}:${row.rating}`)
      .digest("hex").slice(0, 16);

    reviews.push({
      id: `${source}:${idHash}`,
      source,
      reviewerName: row.reviewer_name || "Unknown",
      rating: Math.min(Math.max(parseInt(row.rating) || 5, 1), 5),
      reviewText: row.review_text || "",
      reviewDate: row.review_date || new Date().toISOString(),
      techName: row.tech_name || null,
      techPhotoUrl: row.tech_photo_url || null,
      raw: row,
    });
  }

  return reviews;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

module.exports = createRoutes;
