CREATE TABLE `channel_binding` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`user_id` char(36),
	`kind` enum('email','telegram','wecom','feishu','webpush') NOT NULL,
	`config` json NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`verified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channel_binding_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_channel_ws_user_kind` UNIQUE(`workspace_id`,`user_id`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`event_id` char(36),
	`issue_id` char(36),
	`binding_id` char(36) NOT NULL,
	`channel` enum('email','telegram','wecom','feishu','webpush') NOT NULL,
	`subject` text,
	`body` text,
	`payload` json,
	`status` enum('pending','sent','dead') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`next_attempt_at` timestamp NOT NULL DEFAULT (now()),
	`last_error` text,
	`ref` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`sent_at` timestamp,
	CONSTRAINT `notification_outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `channel_binding` ADD CONSTRAINT `channel_binding_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_binding` ADD CONSTRAINT `channel_binding_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD CONSTRAINT `notification_outbox_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_outbox` ADD CONSTRAINT `notification_outbox_binding_id_channel_binding_id_fk` FOREIGN KEY (`binding_id`) REFERENCES `channel_binding`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_channel_workspace` ON `channel_binding` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_outbox_pending` ON `notification_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_outbox_issue` ON `notification_outbox` (`issue_id`);