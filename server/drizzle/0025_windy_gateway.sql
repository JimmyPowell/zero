CREATE TABLE `channel_provider` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`kind` enum('email','wecom','telegram','feishu') NOT NULL,
	`config` json NOT NULL,
	`secret_enc` text,
	`enabled` int NOT NULL DEFAULT 1,
	`updated_by` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channel_provider_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_provider_ws_kind` UNIQUE(`workspace_id`,`kind`)
);
--> statement-breakpoint
ALTER TABLE `channel_provider` ADD CONSTRAINT `channel_provider_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;