CREATE TABLE `issue_event` (
	`id` char(36) NOT NULL,
	`issue_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`actor_type` enum('member','agent','system'),
	`actor_id` char(36),
	`kind` enum('created','comment','status_change','priority_change','assignment','run_started','run_progress','run_finished','run_failed','diff_ready','pr_opened') NOT NULL,
	`body` text,
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `issue_event_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repo` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` text NOT NULL,
	`default_branch` varchar(255) NOT NULL DEFAULT 'main',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repo_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `issue` ADD `repo_id` char(36);--> statement-breakpoint
ALTER TABLE `issue` ADD `base_branch` varchar(255);--> statement-breakpoint
ALTER TABLE `issue_event` ADD CONSTRAINT `issue_event_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `issue_event` ADD CONSTRAINT `issue_event_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repo` ADD CONSTRAINT `repo_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_issue_event_issue` ON `issue_event` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_repo_workspace` ON `repo` (`workspace_id`);