CREATE TABLE `task` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`issue_id` char(36) NOT NULL,
	`agent_id` char(36) NOT NULL,
	`runtime_id` char(36),
	`status` enum('queued','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'queued',
	`trigger_event_id` char(36),
	`session_id` text,
	`work_dir` text,
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`started_at` timestamp,
	`finished_at` timestamp,
	CONSTRAINT `task_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_agent_id_agent_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_task_claim` ON `task` (`runtime_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_task_issue` ON `task` (`issue_id`);