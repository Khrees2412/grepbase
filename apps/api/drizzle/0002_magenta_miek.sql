ALTER TABLE `ingest_jobs` ADD `retry_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `ingest_jobs` ADD `max_retries` integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE `ingest_jobs` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `ingest_jobs` ADD `last_retry_at` integer;--> statement-breakpoint
ALTER TABLE `ingest_jobs` ADD `resume_from_commit` integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX `idx_jobs_retry` ON `ingest_jobs` (`status`,`last_retry_at`,`retry_count`);