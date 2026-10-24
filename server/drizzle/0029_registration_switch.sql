CREATE TABLE `system_setting` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_by` char(36),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_setting_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `is_admin` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `system_setting` ADD CONSTRAINT `system_setting_updated_by_user_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 数据迁移：最早注册的用户成为系统管理员（全站开关的管理者；之后可直接改库调整）
UPDATE `user` SET `is_admin` = 1 ORDER BY `created_at` ASC, `id` ASC LIMIT 1;
