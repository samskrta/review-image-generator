const https = require("https");
const BaseAdapter = require("./base");

const STAR_MAP = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

class GoogleAdapter extends BaseAdapter {
  constructor(adapterConfig) {
    super("google", adapterConfig);
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  initialize() {
    const { accountId, locationId, oauth } = this.config;
    if (!accountId || !locationId) {
      console.log("Google adapter: missing accountId or locationId — disabled");
      return false;
    }
    if (!oauth || !oauth.clientId || !oauth.clientSecret || !oauth.refreshToken) {
      console.log("Google adapter: missing OAuth credentials — disabled");
      return false;
    }
    this.enabled = true;
    return true;
  }

  async refreshAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    const { clientId, clientSecret, refreshToken } = this.config.oauth;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString();

    const data = await this._httpsRequest("POST", "oauth2.googleapis.com", "/token", {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    }, body);

    if (!data.access_token) {
      throw new Error(`Google token refresh failed: ${data.error_description || data.error || "unknown"}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async fetchReviews(cursor) {
    const token = await this.refreshAccessToken();
    const { accountId, locationId } = this.config;
    const basePath = `/v4/${accountId}/${locationId}/reviews?pageSize=50`;
    const apiPath = cursor ? `${basePath}&orderBy=updateTime desc` : basePath;

    const data = await this._httpsRequest("GET", "mybusiness.googleapis.com", apiPath, {
      Authorization: `Bearer ${token}`,
    });

    if (!data.reviews) {
      return { reviews: [], cursor };
    }

    const reviews = data.reviews.map((r) => ({
      id: `google:${r.reviewId || r.name}`,
      source: "google",
      reviewerName: r.reviewer ? r.reviewer.displayName : "Google User",
      rating: STAR_MAP[r.starRating] || 5,
      reviewText: r.comment || "",
      reviewDate: r.createTime || r.updateTime || new Date().toISOString(),
      techName: null,
      techPhotoUrl: null,
      raw: r,
    }));

    // Use the newest review's updateTime as cursor
    const newestTime = data.reviews.reduce((max, r) => {
      const t = r.updateTime || r.createTime || "";
      return t > max ? t : max;
    }, cursor || "");

    // Filter out reviews we've already seen (older than cursor)
    const filtered = cursor ? reviews.filter((r) => r.reviewDate > cursor) : reviews;

    return { reviews: filtered, cursor: newestTime || cursor };
  }

  parseReviews(rawData) {
    const items = Array.isArray(rawData) ? rawData : [rawData];
    return items.map((r) => ({
      id: `google:${r.reviewId || r.name || Date.now()}`,
      source: "google",
      reviewerName: r.reviewer ? r.reviewer.displayName : r.reviewer_name || "Google User",
      rating: STAR_MAP[r.starRating] || parseInt(r.rating) || 5,
      reviewText: r.comment || r.review_text || "",
      reviewDate: r.createTime || r.review_date || new Date().toISOString(),
      techName: r.tech_name || null,
      techPhotoUrl: r.tech_photo_url || null,
      raw: r,
    }));
  }

  _httpsRequest(method, hostname, reqPath, headers, body) {
    return new Promise((resolve, reject) => {
      const req = https.request({ hostname, path: reqPath, method, headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error("Invalid JSON response from " + hostname));
          }
        });
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = GoogleAdapter;
