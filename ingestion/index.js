const path = require("path");
const ReviewStore = require("./store");
const ReviewPipeline = require("./pipeline");
const PollScheduler = require("./scheduler");
const GoogleAdapter = require("./adapters/google");
const YelpAdapter = require("./adapters/yelp");
const BBBAdapter = require("./adapters/bbb");
const GenericAdapter = require("./adapters/generic");
const createRoutes = require("./routes");

const ADAPTER_CLASSES = {
  google: GoogleAdapter,
  yelp: YelpAdapter,
  bbb: BBBAdapter,
};

let store = null;
let pipeline = null;
let scheduler = null;
let adapters = [];
let genericAdapter = null;
let router = null;

function init(config, serverFns) {
  const ingestionConfig = config.ingestion || {};
  const sources = ingestionConfig.sources || {};

  // Initialize store
  const dataPath = ingestionConfig.dataPath || path.join(process.cwd(), "data", "reviews.json");
  store = new ReviewStore(dataPath);
  store.load();

  // Initialize adapters
  adapters = [];
  for (const [name, sourceConfig] of Object.entries(sources)) {
    const AdapterClass = ADAPTER_CLASSES[name];
    if (!AdapterClass) {
      console.log(`[ingestion] Unknown adapter "${name}" — using generic`);
      const generic = new GenericAdapter({ ...sourceConfig, sourceName: name });
      generic.name = name;
      generic.initialize();
      if (sourceConfig.enabled !== false) adapters.push(generic);
      continue;
    }

    const adapter = new AdapterClass(sourceConfig);
    const ok = adapter.initialize();
    if (ok) {
      adapters.push(adapter);
      console.log(`[ingestion] ${name} adapter: enabled`);
    }
  }

  // Generic adapter for webhooks and imports from unknown sources
  genericAdapter = new GenericAdapter(ingestionConfig.generic || {});
  genericAdapter.initialize();

  // Initialize pipeline
  pipeline = new ReviewPipeline(store, {
    autoGenerate: ingestionConfig.autoGenerate || false,
    autoShare: ingestionConfig.autoShare || false,
    defaultTemplate: ingestionConfig.defaultTemplate || "default",
    defaultSize: ingestionConfig.defaultSize || "square",
    minRatingForAutoShare: ingestionConfig.minRatingForAutoShare || 4,
    renderImage: serverFns.renderImage || null,
    shareToSlack: serverFns.shareToSlack || null,
  });

  // Initialize scheduler
  scheduler = new PollScheduler(adapters, pipeline, store);

  // Create routes
  router = createRoutes({ store, pipeline, scheduler, adapters, genericAdapter });

  console.log(`[ingestion] Initialized with ${adapters.length} adapter(s)`);
  return router;
}

function startScheduler(intervalMinutes) {
  if (!scheduler) return;
  scheduler.start(intervalMinutes);
  console.log("[ingestion] Scheduler started");
}

function stopScheduler() {
  if (scheduler) scheduler.stop();
  if (store) store.shutdown();
  console.log("[ingestion] Scheduler stopped, store flushed");
}

function getStore() {
  return store;
}

module.exports = { init, startScheduler, stopScheduler, getStore };
