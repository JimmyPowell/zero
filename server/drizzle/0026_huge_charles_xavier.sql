CREATE TABLE `issue_read` (
	`user_id` char(36) NOT NULL,
	`issue_id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`last_read_at` timestamp(3) NOT NULL DEFAULT (now(3)),
	CONSTRAINT `issue_read_user_id_issue_id_pk` PRIMARY KEY(`user_id`,`issue_id`)
);
--> statement-breakpoint
ALTER TABLE `issue_read` ADD CONSTRAINT `issue_read_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `issue_read` ADD CONSTRAINT `issue_read_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `issue_read` ADD CONSTRAINT `issue_read_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_issue_read_issue` ON `issue_read` (`issue_id`);