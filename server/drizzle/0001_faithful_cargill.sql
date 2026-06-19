CREATE TABLE `issue` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`number` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`description` text,
	`status` enum('backlog','todo','in_progress','in_review','done','cancelled') NOT NULL DEFAULT 'todo',
	`priority` enum('urgent','high','medium','low','none') NOT NULL DEFAULT 'none',
	`assignee_type` enum('member','agent'),
	`assignee_id` char(36),
	`creator_id` char(36) NOT NULL,
	`parent_issue_id` char(36),
	`due_date` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `issue_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_issue_workspace_number` UNIQUE(`workspace_id`,`number`)
);
--> statement-breakpoint
ALTER TABLE `issue` ADD CONSTRAINT `issue_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `issue` ADD CONSTRAINT `issue_creator_id_user_id_fk` FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_issue_workspace` ON `issue` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_issue_status` ON `issue` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_issue_assignee` ON `issue` (`assignee_type`,`assignee_id`);