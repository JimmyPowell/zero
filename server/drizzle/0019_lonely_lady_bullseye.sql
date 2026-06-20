CREATE TABLE `kb_doc` (
	`id` char(36) NOT NULL,
	`workspace_id` char(36) NOT NULL,
	`project_id` char(36),
	`scope` enum('workspace','project') NOT NULL DEFAULT 'workspace',
	`path` varchar(512) NOT NULL,
	`title` varchar(512),
	`pinned` boolean NOT NULL DEFAULT false,
	`content_hash` char(64),
	`updated_by` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_doc_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_kb_doc_ws_path` UNIQUE(`workspace_id`,`path`)
);
--> statement-breakpoint
ALTER TABLE `kb_doc` ADD CONSTRAINT `kb_doc_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_kb_doc_workspace` ON `kb_doc` (`workspace_id`,`scope`);--> statement-breakpoint
CREATE INDEX `idx_kb_doc_project` ON `kb_doc` (`project_id`);