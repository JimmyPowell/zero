CREATE TABLE `agent_wakeup` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`issue_id` char(36) NOT NULL,
	`agent_id` char(36) NOT NULL,
	`runtime_id` char(36),
	`kind` enum('timer','process') NOT NULL,
	`fire_at` timestamp,
	`pid` int,
	`note` text,
	`status` enum('pending','fired','expired','cancelled') NOT NULL DEFAULT 'pending',
	`source_task_id` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`fired_at` timestamp,
	CONSTRAINT `agent_wakeup_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `agent_wakeup` ADD CONSTRAINT `agent_wakeup_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_wakeup` ADD CONSTRAINT `agent_wakeup_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_wakeup` ADD CONSTRAINT `agent_wakeup_agent_id_agent_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_wakeup_due` ON `agent_wakeup` (`status`,`fire_at`);--> statement-breakpoint
CREATE INDEX `idx_wakeup_runtime` ON `agent_wakeup` (`runtime_id`,`status`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_wakeup_issue` ON `agent_wakeup` (`issue_id`);