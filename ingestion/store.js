const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_AGE_DAYS = 90;
const SAVE_DEBOUNCE_MS = 5000;

class ReviewStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.dirty = false;
    this.saveTimer = null;
  }

  load() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      } catch {
        console.error("Corrupt reviews.json — starting fresh");
        this.data = null;
      }
    }

    if (!this.data || this.data.version !== 1) {
      this.data = { version: 1, cursors: {}, reviews: {}, stats: { totalIngested: 0, lastPollTimes: {} } };
      this.dirty = true;
      this.scheduleSave();
    }
  }

  save() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;

    const tmp = this.filePath + ".tmp";
    const bak = this.filePath + ".bak";

    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, bak);
      }
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error("Failed to save review store:", err.message);
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  hasReview(id) {
    return !!(this.data.reviews && this.data.reviews[id]);
  }

  addReview(review) {
    this.data.reviews[review.id] = {
      ...review,
      processedAt: new Date().toISOString(),
      imageGenerated: false,
      slackShared: false,
    };
    this.data.stats.totalIngested++;
    this.dirty = true;
    this.scheduleSave();
  }

  markProcessed(id, flags) {
    if (!this.data.reviews[id]) return;
    Object.assign(this.data.reviews[id], flags);
    this.dirty = true;
    this.scheduleSave();
  }

  getCursor(source) {
    return this.data.cursors[source] || null;
  }

  setCursor(source, cursor) {
    this.data.cursors[source] = cursor;
    this.dirty = true;
    this.scheduleSave();
  }

  setLastPollTime(source) {
    this.data.stats.lastPollTimes[source] = new Date().toISOString();
    this.dirty = true;
    this.scheduleSave();
  }

  getRecentReviews(limit = 50, source = null) {
    let reviews = Object.values(this.data.reviews);
    if (source) {
      reviews = reviews.filter((r) => r.source === source);
    }
    reviews.sort((a, b) => (b.reviewDate || b.processedAt || "").localeCompare(a.reviewDate || a.processedAt || ""));
    return reviews.slice(0, limit);
  }

  getStats() {
    const reviews = Object.values(this.data.reviews);
    const bySrc = {};
    for (const r of reviews) {
      bySrc[r.source] = (bySrc[r.source] || 0) + 1;
    }
    return {
      totalIngested: this.data.stats.totalIngested,
      totalStored: reviews.length,
      bySource: bySrc,
      lastPollTimes: { ...this.data.stats.lastPollTimes },
    };
  }

  prune(maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    let pruned = 0;
    for (const [id, review] of Object.entries(this.data.reviews)) {
      const date = review.reviewDate || review.processedAt;
      if (date && date < cutoff) {
        delete this.data.reviews[id];
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`Pruned ${pruned} reviews older than ${maxAgeDays} days`);
      this.dirty = true;
      this.scheduleSave();
    }
    return pruned;
  }

  shutdown() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
  }
}

module.exports = ReviewStore;
