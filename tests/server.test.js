const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Ensure config.json exists for tests
const configPath = path.join(__dirname, "..", "config.json");
const configExamplePath = path.join(__dirname, "..", "config.example.json");
let createdConfig = false;

if (!fs.existsSync(configPath)) {
  fs.copyFileSync(configExamplePath, configPath);
  createdConfig = true;
}

// Helper: make HTTP request and collect response
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        let json = null;
        try {
          json = JSON.parse(buffer.toString());
        } catch {
          // Not JSON — that's fine (e.g. PNG response)
        }
        resolve({ status: res.statusCode, headers: res.headers, buffer, json });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const BASE = { hostname: "127.0.0.1", port: 3099 };

describe("Review Image Generator API", () => {
  let serverProcess;

  before(async () => {
    // Start the server on a test port
    const { spawn } = require("node:child_process");
    serverProcess = spawn("node", ["server.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PORT: "3099" },
      stdio: "pipe",
    });

    // Wait for server to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server did not start in time")), 30000);
      serverProcess.stdout.on("data", (data) => {
        if (data.toString().includes("Server running on port")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      serverProcess.stderr.on("data", (data) => {
        // Puppeteer logs to stderr, ignore unless fatal
        const msg = data.toString();
        if (msg.includes("Failed to start")) {
          clearTimeout(timeout);
          reject(new Error(msg));
        }
      });
    });
  });

  after(() => {
    if (serverProcess) serverProcess.kill("SIGTERM");
    if (createdConfig) {
      try { fs.unlinkSync(configPath); } catch {}
    }
  });

  // ---- Health ----
  describe("GET /health", () => {
    it("returns status ok", async () => {
      const res = await request({ ...BASE, path: "/health", method: "GET" });
      assert.equal(res.status, 200);
      assert.equal(res.json.status, "ok");
      assert.equal(typeof res.json.uptime, "number");
      assert.equal(res.json.browserConnected, true);
    });
  });

  // ---- Config ----
  describe("GET /api/config", () => {
    it("returns company config", async () => {
      const res = await request({ ...BASE, path: "/api/config", method: "GET" });
      assert.equal(res.status, 200);
      assert.ok(res.json.company);
      assert.ok(res.json.company.name);
    });
  });

  // ---- Templates ----
  describe("GET /api/templates", () => {
    it("returns an array of templates", async () => {
      const res = await request({ ...BASE, path: "/api/templates", method: "GET" });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
      assert.ok(res.json.length > 0);
    });
  });

  // ---- Sizes ----
  describe("GET /api/sizes", () => {
    it("returns size presets", async () => {
      const res = await request({ ...BASE, path: "/api/sizes", method: "GET" });
      assert.equal(res.status, 200);
      assert.ok(res.json.square);
      assert.equal(res.json.square.width, 1080);
      assert.equal(res.json.square.height, 1080);
      assert.ok(res.json.portrait);
      assert.ok(res.json.story);
      assert.ok(res.json.landscape);
    });
  });

  // ---- Platforms ----
  describe("GET /api/platforms", () => {
    it("returns platform list", async () => {
      const res = await request({ ...BASE, path: "/api/platforms", method: "GET" });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
      const keys = res.json.map((p) => p.key);
      assert.ok(keys.includes("google"));
      assert.ok(keys.includes("yelp"));
    });
  });

  // ---- Technicians ----
  describe("GET /api/technicians", () => {
    it("returns an array (may be empty)", async () => {
      const res = await request({ ...BASE, path: "/api/technicians", method: "GET" });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json));
    });
  });

  // ---- Validation ----
  describe("POST /generate — validation", () => {
    it("rejects missing fields", async () => {
      const res = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        {}
      );
      assert.equal(res.status, 400);
      assert.ok(res.json.details.length > 0);
    });

    it("rejects invalid rating", async () => {
      const res = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Test", rating: 99, review_text: "Good" }
      );
      assert.equal(res.status, 400);
      assert.ok(res.json.details.some((d) => d.field === "rating"));
    });

    it("rejects invalid size", async () => {
      const res = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Test", rating: 5, review_text: "Good", size: "gigantic" }
      );
      assert.equal(res.status, 400);
      assert.ok(res.json.details.some((d) => d.field === "size"));
    });

    it("rejects invalid format", async () => {
      const res = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Test", rating: 5, review_text: "Good", format: "bmp" }
      );
      assert.equal(res.status, 400);
      assert.ok(res.json.details.some((d) => d.field === "format"));
    });
  });

  // ---- Image generation ----
  describe("POST /generate — image output", () => {
    it("generates a valid PNG", async () => {
      const res = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Jane D.", rating: 5, review_text: "Excellent service!" }
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers["content-type"], "image/png");
      // PNG magic bytes: 137 80 78 71 (0x89 0x50 0x4E 0x47)
      assert.equal(res.buffer[0], 0x89);
      assert.equal(res.buffer[1], 0x50);
      assert.equal(res.buffer[2], 0x4e);
      assert.equal(res.buffer[3], 0x47);
      // Metadata headers
      assert.equal(res.headers["x-image-width"], "1080");
      assert.equal(res.headers["x-image-height"], "1080");
      assert.ok(res.headers["x-generation-time-ms"]);
    });

    it("generates JPEG when requested", async () => {
      const res = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Jane D.", rating: 5, review_text: "Great!", format: "jpeg" }
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers["content-type"], "image/jpeg");
      // JPEG magic bytes: 0xFF 0xD8
      assert.equal(res.buffer[0], 0xff);
      assert.equal(res.buffer[1], 0xd8);
    });

    it("respects size parameter", async () => {
      const res = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Jane D.", rating: 4, review_text: "Good!", size: "landscape" }
      );
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-image-width"], "1200");
      assert.equal(res.headers["x-image-height"], "630");
    });

    it("returns cache HIT on duplicate request", async () => {
      const body = { reviewer_name: "CacheTest", rating: 5, review_text: "Cached review text" };
      // First request — miss
      await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        body
      );
      // Second request — should hit cache
      const res2 = await request(
        { ...BASE, path: "/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        body
      );
      assert.equal(res2.status, 200);
      assert.equal(res2.headers["x-cache"], "HIT");
    });
  });

  // ---- GET /generate ----
  describe("GET /generate — query string mode", () => {
    it("generates image from query params", async () => {
      const qs = "reviewer_name=Test&rating=4&review_text=Nice";
      const res = await request({ ...BASE, path: `/generate?${qs}`, method: "GET" });
      assert.equal(res.status, 200);
      assert.equal(res.headers["content-type"], "image/png");
      assert.equal(res.buffer[0], 0x89); // PNG
    });
  });

  // ---- Batch ----
  describe("POST /generate/batch", () => {
    it("rejects empty batch", async () => {
      const res = await request(
        { ...BASE, path: "/generate/batch", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviews: [] }
      );
      assert.equal(res.status, 400);
    });

    it("generates multiple images", async () => {
      const res = await request(
        { ...BASE, path: "/generate/batch", method: "POST", headers: { "Content-Type": "application/json" } },
        {
          reviews: [
            { reviewer_name: "A", rating: 5, review_text: "Good" },
            { reviewer_name: "B", rating: 4, review_text: "Nice" },
          ],
        }
      );
      assert.equal(res.status, 200);
      assert.equal(res.json.results.length, 2);
      assert.ok(res.json.results.every((r) => r.success));
      assert.ok(res.json.results.every((r) => r.image)); // base64 data
    });
  });

  // ---- Slack ----
  describe("GET /api/slack/status", () => {
    it("returns Slack configuration status", async () => {
      const res = await request({ ...BASE, path: "/api/slack/status", method: "GET" });
      assert.equal(res.status, 200);
      assert.equal(typeof res.json.configured, "boolean");
    });
  });

  describe("POST /api/share/slack", () => {
    it("rejects when Slack is not configured", async () => {
      const res = await request(
        { ...BASE, path: "/api/share/slack", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Test", rating: 5, review_text: "Good" }
      );
      // Either 400 (not configured) or 200 (if config has token) — both are valid
      assert.ok([200, 400].includes(res.status));
    });
  });

  // ---- Ingestion ----
  describe("GET /api/ingestion/status", () => {
    it("returns ingestion status", async () => {
      const res = await request({ ...BASE, path: "/api/ingestion/status", method: "GET" });
      // If ingestion is disabled, the route may not be mounted — 404 is acceptable
      if (res.status === 200) {
        assert.equal(typeof res.json.enabled, "boolean");
        assert.ok(res.json.stats || res.json.adapters !== undefined);
      } else {
        assert.ok([404].includes(res.status));
      }
    });
  });

  describe("GET /api/ingestion/reviews", () => {
    it("returns reviews list or 404 when disabled", async () => {
      const res = await request({ ...BASE, path: "/api/ingestion/reviews?limit=5", method: "GET" });
      if (res.status === 200) {
        assert.ok(Array.isArray(res.json.reviews));
        assert.equal(typeof res.json.total, "number");
      } else {
        assert.ok([404].includes(res.status));
      }
    });
  });

  describe("POST /api/ingestion/import", () => {
    it("imports JSON reviews or returns 404 when disabled", async () => {
      const res = await request(
        { ...BASE, path: "/api/ingestion/import", method: "POST", headers: { "Content-Type": "application/json" } },
        {
          source: "test",
          reviews: [
            { reviewer_name: "Test User", rating: 5, review_text: "Great service!" },
          ],
        }
      );
      if (res.status === 200) {
        assert.equal(typeof res.json.imported, "number");
      } else {
        assert.ok([404].includes(res.status));
      }
    });
  });

  describe("POST /api/ingestion/webhook/test", () => {
    it("accepts webhook payload or returns 404 when disabled", async () => {
      const res = await request(
        { ...BASE, path: "/api/ingestion/webhook/test", method: "POST", headers: { "Content-Type": "application/json" } },
        { reviewer_name: "Webhook User", rating: 4, review_text: "Pushed via webhook" }
      );
      if (res.status === 200) {
        assert.equal(res.json.accepted, true);
      } else {
        assert.ok([404].includes(res.status));
      }
    });
  });

  describe("GET /api/ingestion/webhook/test", () => {
    it("responds to verification handshake or returns 404", async () => {
      const res = await request({ ...BASE, path: "/api/ingestion/webhook/test?verification=abc123", method: "GET" });
      if (res.status === 200) {
        assert.equal(res.json.verification, "abc123");
      } else {
        assert.ok([404].includes(res.status));
      }
    });
  });
});
