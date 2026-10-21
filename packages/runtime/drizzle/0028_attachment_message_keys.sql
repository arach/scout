-- Attachment ids are local to a canonical message. Preserve all surviving legacy rows.
CREATE TABLE `__new_message_attachments` (
	`id` text NOT NULL,
	`message_id` text NOT NULL,
	`media_type` text NOT NULL,
	`file_name` text,
	`blob_key` text,
	`url` text,
	`metadata_json` text,
	PRIMARY KEY(`message_id`, `id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_message_attachments`("id", "message_id", "media_type", "file_name", "blob_key", "url", "metadata_json") SELECT "id", "message_id", "media_type", "file_name", "blob_key", "url", "metadata_json" FROM `message_attachments`;--> statement-breakpoint
DROP TABLE `message_attachments`;--> statement-breakpoint
ALTER TABLE `__new_message_attachments` RENAME TO `message_attachments`;
