const https = require("https");
const BaseAdapter = require("./base");

class BBBAdapter extends BaseAdapter {
  constructor(adapterConfig) {
    super("bbb", adapterConfig);
  }

  initialize() {
    if (!this.config.bearerToken || !this.config.businessId) {
      console.log("BBB adapter: missing bearerToken or businessId — disabled");
      return false;
    }
    this.enabled = true;
    return true;
  }

  async fetchReviews(cursor) {
    const offset = cursor ? parseInt(cursor.replace("offset:", "")) || 0 : 0;
    const data = await this._httpsRequest(
      "GET",
      "api.bbb.org",
      `/api/orgs/${encodeURIComponent(this.config.businessId)}/reviews?offset=${offset}&limit=10`,
      { Authorization: `Bearer ${this.config.bearerToken}` }
    );

    if (!data.items || !Array.isArray(data.items)) {
      return { reviews: [], cursor };
    }

    const reviews = data.items.map((r) => ({
      id: `bbb:${r.id || r.reviewId}`,
      source: "bbb",
      reviewerName: r.displayName || r.author || "BBB User",
      rating: r.rating || r.starRating || 5,
      reviewText: r.text || r.description || "",
      reviewDate: r.date || r.publishDate || new Date().toISOString(),
      techName: null,
      techPhotoUrl: null,
      raw: r,
    }));

    const newCursor = data.items.length > 0 ? `offset:${offset + data.items.length}` : cursor;

    return { reviews, cursor: newCursor };
  }

  parseReviews(rawData) {
    const items = Array.isArray(rawData) ? rawData : [rawData];
    return items.map((r) => ({
      id: `bbb:${r.id || r.reviewId || Date.now()}`,
      source: "bbb",
      reviewerName: r.displayName || r.author || r.reviewer_name || "BBB User",
      rating: parseInt(r.rating) || parseInt(r.starRating) || 5,
      reviewText: r.text || r.description || r.review_text || "",
      reviewDate: r.date || r.publishDate || r.review_date || new Date().toISOString(),
      techName: r.tech_name || null,
      techPhotoUrl: r.tech_photo_url || null,
      raw: r,
    }));
  }

  _httpsRequest(method, hostname, reqPath, headers) {
    return new Promise((resolve, reject) => {
      const req = https.request({ hostname, path: reqPath, method, headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error("Invalid JSON response from BBB"));
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }
}

module.exports = BBBAdapter;
