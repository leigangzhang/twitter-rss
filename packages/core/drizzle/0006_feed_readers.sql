CREATE TABLE `feed_readers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`slug` text NOT NULL,
	`reader_key` text NOT NULL,
	`client` text NOT NULL,
	`subscribers` integer,
	`hits` integer DEFAULT 1 NOT NULL,
	`last_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_readers_day` ON `feed_readers` (`date`,`slug`,`reader_key`);--> statement-breakpoint
CREATE INDEX `feed_readers_date` ON `feed_readers` (`date`);