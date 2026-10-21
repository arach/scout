/** Core-only attachment capability. Importing this module starts no service. */
export { BrokerAttachmentService, type AttachmentPrincipal, type BrokerAttachmentServiceOptions } from "./broker-attachment-service.js";
export { AttachmentError, ATTACHMENT_LIMITS, postWithAttachmentsSchema, readAttachmentSchema, blobRefSchema } from "./attachment-contract.js";
export type { PostWithAttachments, ReadAttachment, MessageBlobRef, AttachmentUpload, AttachmentReadResult } from "@openscout/protocol";
