CREATE TABLE `project` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`title` varchar(512) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`description` text,
	`icon` varchar(64),
	`status` enum('planned','in_progress','paused','completed','cancelled') NOT NULL DEFAULT 'planned',
	`lead_type` enum('member','agent'),
	`lead_id` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_project_workspace_slug` UNIQUE(`workspace_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `project_resource` (
	`id` char(36) NOT NULL,
	`project_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`ref` json NOT NULL,
	`label` varchar(255),
	`position` int NOT NULL DEFAULT 0,
	`created_by` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_resource_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `issue` ADD `project_id` char(36);--> statement-breakpoint
ALTER TABLE `project` ADD CONSTRAINT `project_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_resource` ADD CONSTRAINT `project_resource_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_resource` ADD CONSTRAINT `project_resource_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_resource` ADD CONSTRAINT `project_resource_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_project_workspace` ON `project` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_project_resource_project` ON `project_resource` (`project_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_project_resource_workspace` ON `project_resource` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_issue_project` ON `issue` (`project_id`);