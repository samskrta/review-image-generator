class ReviewPipeline {
  constructor(store, options) {
    this.store = store;
    this.autoGenerate = options.autoGenerate || false;
    this.autoShare = options.autoShare || false;
    this.renderImage = options.renderImage;
    this.shareToSlack = options.shareToSlack;
    this.defaultTemplate = options.defaultTemplate || "default";
    this.defaultSize = options.defaultSize || "square";
    this.minRatingForAutoShare = options.minRatingForAutoShare || 4;
  }

  async process(reviews) {
    const results = { new: 0, duplicate: 0, generated: 0, shared: 0, errors: [] };

    for (const review of reviews) {
      if (this.store.hasReview(review.id)) {
        results.duplicate++;
        continue;
      }

      this.store.addReview(review);
      results.new++;
      console.log(`[ingestion] New review: ${review.source} — ${review.reviewerName} (${review.rating} stars)`);

      if (this.autoGenerate && this.renderImage) {
        try {
          const renderParams = {
            reviewer_name: review.reviewerName,
            rating: review.rating,
            review_text: review.reviewText,
            source: review.source,
            tech_name: review.techName || undefined,
            tech_photo_url: review.techPhotoUrl || undefined,
            template: this.defaultTemplate,
            size: this.defaultSize,
          };

          const imageResult = await this.renderImage(renderParams);
          this.store.markProcessed(review.id, { imageGenerated: true });
          results.generated++;

          if (this.autoShare && this.shareToSlack && review.rating >= this.minRatingForAutoShare) {
            try {
              await this.shareToSlack(review, imageResult.buffer, imageResult.format);
              this.store.markProcessed(review.id, { slackShared: true });
              results.shared++;
            } catch (err) {
              console.error(`[ingestion] Slack share failed for ${review.id}:`, err.message);
              results.errors.push({ reviewId: review.id, step: "slack", error: err.message });
            }
          }
        } catch (err) {
          console.error(`[ingestion] Image generation failed for ${review.id}:`, err.message);
          results.errors.push({ reviewId: review.id, step: "generate", error: err.message });
        }
      }
    }

    return results;
  }
}

module.exports = ReviewPipeline;
