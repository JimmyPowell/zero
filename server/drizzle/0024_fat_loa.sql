ALTER TABLE `issue` ADD `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `issue` ADD `deleted_by` char(36);--> statement-breakpoint
ALTER TABLE `issue_event` ADD `deleted_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `issue_event` ADD `deleted_by` char(36);