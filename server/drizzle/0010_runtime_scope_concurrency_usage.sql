CREATE TABLE `runtime_workspace` (
	`runtime_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `uniq_runtime_workspace` UNIQUE(`runtime_id`,`workspace_id`)
);
--> statement-breakpoint
CREATE TABLE `task_usage` (
	`task_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`runtime_id` char(36),
	`agent_id` char(36),
	`model` varchar(128),
	`cost_usd` decimal(12,6),
	`input_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`cache_read_tokens` int NOT NULL DEFAULT 0,
	`cache_write_tokens` int NOT NULL DEFAULT 0,
	`duration_ms` int,
	`num_turns` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_usage_task_id` PRIMARY KEY(`task_id`)
);
--> statement-breakpoint
ALTER TABLE `runtime` ADD `owner_id` char(36);--> statement-breakpoint
ALTER TABLE `runtime` ADD `visibility` enum('private','workspace') DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `runtime` ADD `max_concurrency` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `runtime_workspace` ADD CONSTRAINT `runtime_workspace_runtime_id_runtime_id_fk` FOREIGN KEY (`runtime_id`) REFERENCES `runtime`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runtime_workspace` ADD CONSTRAINT `runtime_workspace_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_usage` ADD CONSTRAINT `task_usage_task_id_task_id_fk` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_usage` ADD CONSTRAINT `task_usage_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_runtime_workspace_ws` ON `runtime_workspace` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_task_usage_runtime` ON `task_usage` (`runtime_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_task_usage_agent` ON `task_usage` (`agent_id`);--> statement-breakpoint
CREATE INDEX `idx_task_usage_workspace` ON `task_usage` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `runtime` ADD CONSTRAINT `runtime_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_runtime_owner` ON `runtime` (`owner_id`);--> statement-breakpoint
-- 回填：现有运行时「上架」到其主工作空间，避免改用 reach 查询后从列表消失
INSERT INTO `runtime_workspace` (`runtime_id`, `workspace_id`, `created_at`) SELECT `id`, `workspace_id`, now() FROM `runtime`;--> statement-breakpoint
-- 回填：把现有运行时归属到其主工作空间的 owner（优先 owner 角色）
UPDATE `runtime` SET `owner_id` = (SELECT `m`.`user_id` FROM `member` `m` WHERE `m`.`workspace_id` = `runtime`.`workspace_id` ORDER BY (`m`.`role` = 'owner') DESC LIMIT 1) WHERE `owner_id` IS NULL;