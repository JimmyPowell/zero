CREATE TABLE `workspace_invite` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`role` enum('admin','member') NOT NULL DEFAULT 'member',
	`token_hash` char(64) NOT NULL,
	`email` varchar(255),
	`created_by` char(36),
	`expires_at` timestamp,
	`max_uses` int,
	`use_count` int NOT NULL DEFAULT 0,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workspace_invite_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_invite_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `workspace_invite` ADD CONSTRAINT `workspace_invite_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_invite` ADD CONSTRAINT `workspace_invite_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_invite_workspace` ON `workspace_invite` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_invite_token` ON `workspace_invite` (`token_hash`);