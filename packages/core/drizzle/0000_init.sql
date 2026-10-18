CREATE TABLE `accounts` (
	`handle` text PRIMARY KEY NOT NULL,
	`name` text,
	`avatar_url` text,
	`last_seen_id` text,
	`last_collected_at` integer,
	`last_status` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscriber_id` integer NOT NULL,
	`digest_date` text NOT NULL,
	`tweet_ids` text NOT NULL,
	`message_id` text,
	`status` text NOT NULL,
	`error` text,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_sub_date` ON `deliveries` (`subscriber_id`,`digest_date`);--> statement-breakpoint
CREATE TABLE `subscribers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`lang` text DEFAULT 'zh' NOT NULL,
	`topics` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`confirmed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_email_unique` ON `subscribers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_token_unique` ON `subscribers` (`token`);--> statement-breakpoint
CREATE TABLE `tweets` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text NOT NULL,
	`raw` text NOT NULL,
	`engagement` real NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`filter_reason` text,
	`rule_score` real,
	`ai` text,
	`topic_id` text,
	`final_score` real,
	`collected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `tweets_handle_created` ON `tweets` (`handle`,`created_at`);--> statement-breakpoint
CREATE INDEX `tweets_topic_score` ON `tweets` (`topic_id`,`final_score`);--> statement-breakpoint
CREATE INDEX `tweets_status` ON `tweets` (`status`);