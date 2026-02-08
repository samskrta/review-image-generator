const crypto = require("crypto");
const BaseAdapter = require("./base");

class GenericAdapter extends BaseAdapter {
  constructor(adapterConfig) {
    super("generic", adapterConfig);
  }

  initialize() {
    this.enabled = true;
    this.fieldMap = this.config.fieldMapping || {};
    return true;
  }

  async fetchReviews() {
    // Generic adapter does not poll — only receives via webhook or import
    return { reviews: [], cursor: null };
  }

  parseReviews(rawData) {
    const items = Array.isArray(rawData) ? rawData : rawData.reviews || [rawData];
    const source = rawData.source || this.config.sourceName || "generic";

    return items.map((item) => {
      const reviewerName = item[this.fieldMap.reviewerNameField || "reviewer_name"] || item.reviewerName || "Unknown";
      const rating = parseInt(item[this.fieldMap.ratingField || "rating"] || item.rating) || 5;
      const reviewText = item[this.fieldMap.reviewTextField || "review_text"] || item.reviewText || "";
      const reviewDate = item[this.fieldMap.reviewDateField || "review_date"] || item.reviewDate || new Date().toISOString();
      const techName = item[this.fieldMap.techNameField || "tech_name"] || item.techName || null;
      const techPhotoUrl = item[this.fieldMap.techPhotoUrlField || "tech_photo_url"] || item.techPhotoUrl || null;

      const idSource = item.id || crypto.createHash("sha256").update(`${source}:${reviewerName}:${reviewText}:${rating}`).digest("hex").slice(0, 16);

      return {
        id: `${source}:${idSource}`,
        source,
        reviewerName,
        rating: Math.min(Math.max(rating, 1), 5),
        reviewText,
        reviewDate,
        techName,
        techPhotoUrl,
        raw: item,
      };
    });
  }
}

module.exports = GenericAdapter;
