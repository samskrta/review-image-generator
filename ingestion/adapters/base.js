class BaseAdapter {
  constructor(name, adapterConfig) {
    this.name = name;
    this.config = adapterConfig || {};
    this.enabled = false;
  }

  initialize() {
    throw new Error(`${this.name}: subclass must implement initialize()`);
  }

  async fetchReviews(_cursor) {
    throw new Error(`${this.name}: subclass must implement fetchReviews()`);
  }

  parseReviews(_rawData) {
    throw new Error(`${this.name}: subclass must implement parseReviews()`);
  }
}

module.exports = BaseAdapter;
