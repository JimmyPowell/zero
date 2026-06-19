CREATE TABLE `run_event` (
	`id` char(36) NOT NULL,
	`task_id` char(36) NOT NULL,
	`issue_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`seq` int NOT NULL,
	`type` enum('run_status','assistant_text','thinking','tool_call','tool_result','usage','error') NOT NULL,
	`tool` varchar(32),
	`tool_name` varchar(128),
	`text` text,
	`payload` json,
	`created_at` timestamp(3) NOT NULL DEFAULT (now(3)),
	CONSTRAINT `run_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_run_event_task_seq` UNIQUE(`task_id`,`seq`)
);
--> statement-breakpoint
ALTER TABLE `run_event` ADD CONSTRAINT `run_event_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_event` ADD CONSTRAINT `run_event_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `run_event` ADD CONSTRAINT `run_event_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_run_event_task` ON `run_event` (`task_id`,`seq`);