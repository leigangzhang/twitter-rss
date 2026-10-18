ALTER TABLE `accounts` ADD `covered_until` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_tweet_at` integer;--> statement-breakpoint
ALTER TABLE `tweets` ADD `batch_date` text;--> statement-breakpoint
CREATE INDEX `tweets_batch` ON `tweets` (`batch_date`);