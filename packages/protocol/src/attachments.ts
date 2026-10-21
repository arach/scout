/** Runtime-owned content binding. Bytes never enter canonical message history. */
export interface MessageBlobRef {
  sha256: string;
  mediaType: string;
  byteSize: number;
}
export interface AttachmentUpload {
  /** Canonical base64, without a data: prefix. No existing blob references. */
  data: string;
  mediaType: string;
  fileName?: string;
}
export interface PostWithAttachments {
  requestId: string;
  conversationId: string;
  body: string;
  replyToMessageId?: string;
  attachments: AttachmentUpload[];
}
export interface ReadAttachment {
  conversationId: string;
  messageId: string;
  /** Content hash, only meaningful through this message's committed binding. */
  blobId: string;
  mode: "text" | "image";
}
export type AttachmentReadResult = {
  blobId: string; messageId: string; mediaType: string; byteSize: number; fileName?: string;
} & ({ mode: "image"; data: string } | { mode: "text"; text: string; truncated: boolean; sourceTrust: "untrusted_attachment" });
export const ATTACHMENT_LIMITS = {
  imageBytes: 25 * 1024 * 1024,
  readBytes: 256 * 1024,
  textCharacters: 32_000,
  storeBytes: 256 * 1024 * 1024,
  requestBytes: 36 * 1024 * 1024,
} as const;
