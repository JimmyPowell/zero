CREATE TABLE `member` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`role` enum('owner','admin','member') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `member_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_member_workspace_user` UNIQUE(`workspace_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` char(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`avatar_url` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`description` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_member_workspace` ON `member` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_member_user` ON `member` (`user_id`);