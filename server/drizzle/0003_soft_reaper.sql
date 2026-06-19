CREATE TABLE `agent` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`avatar_url` text,
	`provider` enum('claude_code','codex','opencode') NOT NULL DEFAULT 'claude_code',
	`model` varchar(128),
	`instructions` text,
	`runtime_id` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_agent_workspace_name` UNIQUE(`workspace_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `agent` ADD CONSTRAINT `agent_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_agent_workspace` ON `agent` (`workspace_id`);