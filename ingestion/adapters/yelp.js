const https = require("https");
const BaseAdapter = require("./base");

class YelpAdapter extends BaseAdapter {
  constructor(adapterConfig) {
    super("yelp", adapterConfig);
  }

  initialize() {
    if (!this.config.apiKey || !this.config.businessId) {
      console.log("Yelp adapter: missing apiKey or businessId — disabled");
      return false;
    }
    console.log("Yelp adapter: NOTE — Yelp API only returns up to 3 review excerpts (not full text)");
    this.enabled = true;
    return true;
  }

  async fetchReviews(cursor) {
    const data = await this._httpsRequest(
      "GET",
      "api.yelp.com",
      `/v3/businesses/${encodeURIComponent(this.config.businessId)}/reviews?limit=50&sort_by=newest`,
      { Authorization: `Bearer ${this.config.apiKey}` }
    );

    if (!data.reviews || !Array.isArray(data.reviews)) {
      return { reviews: [], cursor };
    }

    const reviews = data.reviews.map((r) => ({
      id: `yelp:${r.id}`,
      source: "yelp",
      reviewerName: r.user ? r.user.name : "Yelp User",
      rating: r.rating || 5,
      reviewText: r.text || "",
      reviewDate: r.time_created || new Date().toISOString(),
      techName: null,
      techPhotoUrl: null,
      partial: true,
      raw: r,
    }));

    const filtered = cursor ? reviews.filter((r) => r.reviewDate > cursor) : reviews;
    const newestTime = reviews.length > 0 ? reviews[0].reviewDate : cursor;

    return { reviews: filtered, cursor: newestTime || cursor };
  }

  parseReviews(rawData) {
    const items = Array.isArray(rawData) ? rawData : [rawData];
    return items.map((r) => ({
      id: `yelp:${r.id || Date.now()}`,
      source: "yelp",
      reviewerName: r.user ? r.user.name : r.reviewer_name || "Yelp User",
      rating: r.rating || parseInt(r.stars) || 5,
      reviewText: r.text || r.review_text || "",
      reviewDate: r.time_created || r.review_date || new Date().toISOString(),
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
            reject(new Error("Invalid JSON response from Yelp"));
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }
}

module.exports = YelpAdapter;
