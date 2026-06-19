CREATE TABLE `runtime` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`kind` enum('local','cloud') NOT NULL DEFAULT 'local',
	`token_hash` varchar(64) NOT NULL,
	`capabilities` json,
	`last_heartbeat_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `runtime_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `runtime` ADD CONSTRAINT `runtime_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_runtime_workspace` ON `runtime` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_token` ON `runtime` (`token_hash`);