CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tweet_id` text NOT NULL,
	`issue_date` text NOT NULL,
	`vote` text NOT NULL,
	`reason` text,
	`subscriber_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_tweet_subscriber` ON `feedback` (`tweet_id`,`subscriber_id`);--> statement-breakpoint
CREATE INDEX `feedback_issue` ON `feedback` (`issue_date`);