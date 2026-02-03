CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`commit_id` integer NOT NULL,
	`provider` text NOT NULL,
	`explanation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`commit_id`) REFERENCES `commits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_analyses_commit_id` ON `analyses` (`commit_id`);--> statement-breakpoint
CREATE TABLE `commits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` integer NOT NULL,
	`sha` text NOT NULL,
	`message` text NOT NULL,
	`author_name` text,
	`author_email` text,
	`date` integer NOT NULL,
	`order` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_commits_repo_id` ON `commits` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_commits_sha` ON `commits` (`sha`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`commit_id` integer NOT NULL,
	`path` text NOT NULL,
	`content` text,
	`size` integer DEFAULT 0,
	`language` text,
	FOREIGN KEY (`commit_id`) REFERENCES `commits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_files_commit_id` ON `files` (`commit_id`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`stars` integer DEFAULT 0,
	`default_branch` text DEFAULT 'main',
	`readme` text,
	`last_fetched` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_url_unique` ON `repositories` (`url`);--> statement-breakpoint
CREATE INDEX `idx_repos_owner_name` ON `repositories` (`owner`,`name`);