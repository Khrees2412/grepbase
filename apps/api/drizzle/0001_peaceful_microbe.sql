CREATE TABLE `ingest_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`repo_id` integer,
	`progress` integer DEFAULT 0,
	`total_commits` integer DEFAULT 0,
	`processed_commits` integer DEFAULT 0,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_jobs_job_id_unique` ON `ingest_jobs` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_job_id` ON `ingest_jobs` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `ingest_jobs` (`status`);