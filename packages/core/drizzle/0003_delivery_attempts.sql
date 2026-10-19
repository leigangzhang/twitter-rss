CREATE TABLE `delivery_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscriber_id` integer NOT NULL,
	`digest_date` text NOT NULL,
	`kind` text NOT NULL,
	`recipients` integer DEFAULT 1 NOT NULL,
	`tweet_ids` text NOT NULL,
	`status` text NOT NULL,
	`message_id` text,
	`error` text,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `delivery_attempts_date` ON `delivery_attempts` (`digest_date`);--> statement-breakpoint
INSERT INTO `delivery_attempts` (`subscriber_id`, `digest_date`, `kind`, `recipients`, `tweet_ids`, `status`, `message_id`, `error`, `sent_at`) SELECT `subscriber_id`, `digest_date`, 'scheduled', 1, `tweet_ids`, `status`, `message_id`, `error`, `sent_at` FROM `deliveries`;
