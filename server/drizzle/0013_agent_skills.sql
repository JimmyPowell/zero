CREATE TABLE `agent_skill` (
	`agent_id` char(36) NOT NULL,
	`skill_id` char(36) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `uniq_agent_skill` UNIQUE(`agent_id`,`skill_id`)
);
--> statement-breakpoint
CREATE TABLE `skill` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(1024) NOT NULL,
	`content` text,
	`source` enum('manual','github') NOT NULL DEFAULT 'manual',
	`source_ref` text,
	`content_hash` char(64),
	`created_by` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skill_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_skill_workspace_slug` UNIQUE(`workspace_id`,`slug`)
);
--> statement-breakpoint
CREATE TABLE `skill_file` (
	`id` char(36) NOT NULL,
	`skill_id` char(36) NOT NULL,
	`path` varchar(512) NOT NULL,
	`is_binary` boolean NOT NULL DEFAULT false,
	`content` text,
	`storage_key` text,
	`size` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `skill_file_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_skill_file_path` UNIQUE(`skill_id`,`path`)
);
--> statement-breakpoint
ALTER TABLE `agent` ADD `description` text;--> statement-breakpoint
ALTER TABLE `agent_skill` ADD CONSTRAINT `agent_skill_agent_id_agent_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_skill` ADD CONSTRAINT `agent_skill_skill_id_skill_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `skill`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skill` ADD CONSTRAINT `skill_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skill` ADD CONSTRAINT `skill_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skill_file` ADD CONSTRAINT `skill_file_skill_id_skill_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `skill`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_agent_skill_agent` ON `agent_skill` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_skill_skill` ON `agent_skill` (`skill_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_workspace` ON `skill` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_file_skill` ON `skill_file` (`skill_id`);