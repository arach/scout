import { basename, extname, resolve } from "node:path";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { defaultScoutContextDirectory, type ScoutCommandContext } from "../context.ts";
import { assertLocalAttachmentBroker } from "../notify-attachment-runtime.ts";
import { ScoutCliError } from "../errors.ts";
import { resolveScoutBrokerUrl, resolveScoutSenderId, sendScoutMessage, sendScoutOperatorAttachment } from "../../lib/core/broker/service.ts";
import type { AttachmentUpload } from "@openscout/protocol";

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function renderNotifyCommandHelp(): string {
  return [
    "Usage: scout notify --message <text> [--image <path>] [--as <sender>] [--json]",
    "",
    "Send your operator a deliberate message and keep working. No flight or waiting state is created.",
    "The operating agent decides when the user's condition is met; this command does not schedule checks.",
    "The remote push is generic. Reading images requires a client with broker blob support.",
    "Delivery is best-effort: a receipt confirms recording, not notification display or reading.",
    "Images: PNG, JPEG, GIF, WebP; up to 25 MiB. Requires the local broker attachment capability.",
    "Image bytes are atomically bound to the broker message; availability follows broker blob retention.",
    "",
    '  scout notify --message "The screen is ready for review." --image ./screen.png',
    '  scout notify --message "The investigation found a reason to change our plan."',
  ].join("\n");
}

export function parseNotifyCommandOptions(args: string[]) {
  const result: { message: string; image?: string; sender?: string; cwd?: string; help: boolean } = { message: "", help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") return { ...result, help: true };
    if (arg === "--json") continue;
    const key = ({ "--message": "message", "--image": "image", "--as": "sender", "--cwd": "cwd" } as const)[arg as "--message"];
    if (!key) throw new ScoutCliError(`unknown notify option: ${arg}`);
    const value = args[++i];
    if (!value?.trim() || value.startsWith("--")) throw new ScoutCliError(`${arg} requires a non-empty value`);
    result[key] = value.trim();
  }
  if (!result.message) throw new ScoutCliError("notify requires --message <text>");
  return result;
}

export async function runNotifyCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseNotifyCommandOptions(args.length ? args : ["--help"]);
  if (options.help) { context.output.writeText(renderNotifyCommandHelp()); return; }
  const currentDirectory = options.cwd ?? defaultScoutContextDirectory(context);
  let attachment: AttachmentUpload | undefined;
  if (options.image) {
    assertLocalAttachmentBroker(resolveScoutBrokerUrl());
    const path = resolve(currentDirectory, options.image);
    const mediaType = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mediaType) throw new ScoutCliError("--image must be PNG, JPEG, GIF, or WebP");
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || !info.size || info.size > MAX_IMAGE_BYTES) throw new ScoutCliError("image must be a non-empty file of at most 25 MiB");
      const chunks: Buffer[] = []; let size = 0;
      while (true) {
        const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_IMAGE_BYTES + 1 - size));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, null); if (!bytesRead) break;
        size += bytesRead; if (size > MAX_IMAGE_BYTES) throw new ScoutCliError("image exceeds 25 MiB"); chunks.push(chunk.subarray(0, bytesRead));
      }
      if (!size) throw new ScoutCliError("image is empty");
      attachment = { data: Buffer.concat(chunks).toString("base64"), mediaType, fileName: basename(path) };
    } finally { await file.close(); }
  }
  const senderId = await resolveScoutSenderId(options.sender, currentDirectory, context.env);
  if (attachment) {
    const message = await sendScoutOperatorAttachment({ senderId, currentDirectory, body: options.message, attachment });
    context.output.writeValue({ status: "recorded", notificationDelivery: "unconfirmed", senderId: message.actorId,
      messageId: message.id, conversationId: message.conversationId, imageExpiresAt: null }, value =>
      `Operator message recorded; notification delivery is unconfirmed. Continue working.\nMessage: ${value.messageId}. Conversation: ${value.conversationId}.`);
    return;
  }
  const result = await sendScoutMessage({
    senderId, currentDirectory, targetLabel: "operator", body: options.message, source: "scout-notify",
    operatorSignal: { kind: "notify", blocking: false, replyExpectation: "none" },
  });
  if (!result.usedBroker || result.routingError || result.unresolvedTargets.length || !result.messageId) {
    throw new ScoutCliError("operator notification was not recorded; check broker availability and routing");
  }
  context.output.writeValue({
    status: "recorded", notificationDelivery: "unconfirmed", senderId,
    messageId: result.messageId, conversationId: result.conversationId,
    imageExpiresAt: null,
  }, value => [
    "Operator message recorded; notification delivery is unconfirmed. Continue working.",
    `Message: ${value.messageId}. Conversation: ${value.conversationId}.`,
  ].join("\n"));
}
