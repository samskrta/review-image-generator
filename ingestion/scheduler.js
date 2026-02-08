const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_BACKOFF_MS = 2 * 60 * 60 * 1000; // 2 hours

class PollScheduler {
  constructor(adapters, pipeline, store) {
    this.adapters = adapters;
    this.pipeline = pipeline;
    this.store = store;
    this.timers = new Map();
    this.locks = new Map();
    this.failures = new Map();
    this.running = false;
  }

  start(globalIntervalMinutes) {
    if (this.running) return;
    this.running = true;

    let staggerMs = 0;
    for (const adapter of this.adapters) {
      if (!adapter.enabled) continue;

      const intervalMs = (adapter.config.pollIntervalMinutes || globalIntervalMinutes || 15) * 60 * 1000;

      // Stagger initial polls
      setTimeout(() => {
        this.pollOnce(adapter.name).catch(() => {});
        const timer = setInterval(() => {
          this.pollOnce(adapter.name).catch(() => {});
        }, this.getEffectiveInterval(adapter.name, intervalMs));
        this.timers.set(adapter.name, timer);
      }, staggerMs);

      staggerMs += 5000;
      console.log(`[scheduler] ${adapter.name}: polling every ${intervalMs / 60000} minutes`);
    }
  }

  stop() {
    this.running = false;
    for (const [name, timer] of this.timers) {
      clearInterval(timer);
      console.log(`[scheduler] ${name}: stopped`);
    }
    this.timers.clear();
  }

  getEffectiveInterval(name, baseMs) {
    const fails = this.failures.get(name) || 0;
    if (fails === 0) return baseMs;
    return Math.min(baseMs * Math.pow(2, fails), MAX_BACKOFF_MS);
  }

  async pollOnce(adapterName) {
    const adapter = this.adapters.find((a) => a.name === adapterName);
    if (!adapter || !adapter.enabled) {
      throw new Error(`Adapter "${adapterName}" not found or not enabled`);
    }

    if (this.locks.get(adapterName)) {
      console.log(`[scheduler] ${adapterName}: poll already in progress, skipping`);
      return { skipped: true };
    }

    this.locks.set(adapterName, true);

    try {
      const cursor = this.store.getCursor(adapterName);
      const { reviews, cursor: newCursor } = await adapter.fetchReviews(cursor);

      if (newCursor && newCursor !== cursor) {
        this.store.setCursor(adapterName, newCursor);
      }
      this.store.setLastPollTime(adapterName);

      let results = { new: 0, duplicate: 0 };
      if (reviews.length > 0) {
        results = await this.pipeline.process(reviews);
        console.log(`[scheduler] ${adapterName}: ${results.new} new, ${results.duplicate} duplicates`);
      }

      this.failures.set(adapterName, 0);
      return results;
    } catch (err) {
      const fails = (this.failures.get(adapterName) || 0) + 1;
      this.failures.set(adapterName, fails);
      console.error(`[scheduler] ${adapterName}: poll failed (attempt ${fails}):`, err.message);
      throw err;
    } finally {
      this.locks.set(adapterName, false);
    }
  }
}

module.exports = PollScheduler;
