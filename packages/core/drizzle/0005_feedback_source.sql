ALTER TABLE `feedback` ADD `note` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `source` text DEFAULT 'reader' NOT NULL;