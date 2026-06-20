CREATE TABLE `task_change` (
	`task_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`issue_id` char(36) NOT NULL,
	`files_changed` int NOT NULL DEFAULT 0,
	`additions` int NOT NULL DEFAULT 0,
	`deletions` int NOT NULL DEFAULT 0,
	`baseline_sha` char(40),
	`head_sha` char(40),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_change_task_id` PRIMARY KEY(`task_id`)
);
--> statement-breakpoint
CREATE TABLE `task_file_change` (
	`id` char(36) NOT NULL,
	`task_id` char(36) NOT NULL,
	`path` varchar(1024) NOT NULL,
	`old_path` varchar(1024),
	`status` enum('added','modified','deleted','renamed') NOT NULL,
	`additions` int NOT NULL DEFAULT 0,
	`deletions` int NOT NULL DEFAULT 0,
	`is_binary` boolean NOT NULL DEFAULT false,
	`patch` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_file_change_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `task_change` ADD CONSTRAINT `task_change_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_change` ADD CONSTRAINT `task_change_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_file_change` ADD CONSTRAINT `task_file_change_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_task_change_issue` ON `task_change` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_task_file_change_task` ON `task_file_change` (`task_id`);