CREATE TABLE `attachment` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`issue_id` char(36),
	`issue_event_id` char(36),
	`uploader_type` enum('member','agent') NOT NULL,
	`uploader_id` char(36),
	`filename` varchar(512) NOT NULL,
	`mime` varchar(128) NOT NULL,
	`size_bytes` int NOT NULL,
	`storage_key` varchar(512) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attachment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `attachment` ADD CONSTRAINT `attachment_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attachment` ADD CONSTRAINT `attachment_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attachment` ADD CONSTRAINT `attachment_issue_event_id_issue_event_id_fk` FOREIGN KEY (`issue_event_id`) REFERENCES `issue_event`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_attachment_issue` ON `attachment` (`issue_id`);--> statement-breakpoint
CREATE INDEX `idx_attachment_event` ON `attachment` (`issue_event_id`);