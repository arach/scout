import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { type ComposerFormat, FORMATS } from "./composer-formats.tsx";

import {
  deleteCharsBeforeCaret,
  htmlToMarkdown,
  insertTextAtCaret,
  markdownToHtml,
  textBeforeCaret,
} from "./chat-rich-text.ts";

export type ChatRichInputHandle = {
  focus: () => void;
  textBeforeCaret: () => string;
  insertText: (text: string) => void;
  replaceMention: (fromAt: number, label: string) => void;
  applyFormat: (command: ComposerFormat) => void;
};

export const ChatRichInput = forwardRef<ChatRichInputHandle, {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onFormatsChange?: (formats: ComposerFormat[]) => void;
  onChange: (markdown: string) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onBlur?: () => void;
}>(function ChatRichInput({
  value,
  placeholder,
  disabled = false,
  onChange,
  onFormatsChange,
  onKeyDown,
  onPaste,
  onDragOver,
  onDrop,
  onBlur,
}, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastMarkdown = useRef<string | null>(null);
  const skipEmit = useRef(false);

  const emit = useCallback(() => {
    const root = rootRef.current;
    if (!root || skipEmit.current) return;
    const markdown = htmlToMarkdown(root);
    lastMarkdown.current = markdown;
    onChange(markdown);
  }, [onChange]);

  const paint = useCallback((markdown: string) => {
    const root = rootRef.current;
    if (!root) return;
    skipEmit.current = true;
    root.innerHTML = markdownToHtml(markdown);
    lastMarkdown.current = markdown;
    skipEmit.current = false;
  }, []);

  useEffect(() => {
    if (value === lastMarkdown.current) return;
    paint(value);
  }, [paint, value]);

  const reportFormats = useCallback(() => {
    const root = rootRef.current;
    const selection = root?.ownerDocument.getSelection();
    if (!root || !selection || !root.contains(selection.anchorNode)) return;
    const node = selection.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const tags: Record<ComposerFormat, string> = { bold: 'b,strong', italic: 'i,em', underline: 'u', strike: 's,strike,del', link: 'a', ol: 'ol', ul: 'ul', quote: 'blockquote', code: 'code', block: 'pre' };
    const commands: Partial<Record<ComposerFormat, string>> = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough', ol: 'insertOrderedList', ul: 'insertUnorderedList' };
    onFormatsChange?.(FORMATS.filter(({ id }) => Boolean(element?.closest(tags[id])) || Boolean(commands[id] && root.ownerDocument.queryCommandState?.(commands[id]!))).map(({ id }) => id));
  }, [onFormatsChange]);
  useEffect(() => {
    document.addEventListener('selectionchange', reportFormats);
    return () => document.removeEventListener('selectionchange', reportFormats);
  }, [reportFormats]);

  useEffect(() => {
    const root = rootRef.current;
    const pane = root?.closest('.chat-channel, .chat-thread, .chat-side-panel');
    if (!root || !pane || typeof ResizeObserver === 'undefined') return;
    const resize = () => root.style.setProperty('--chat-composer-max-height', `${Math.max(42, pane.clientHeight * .5)}px`);
    const observer = new ResizeObserver(resize); observer.observe(pane); resize();
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    textBeforeCaret: () => {
      const root = rootRef.current;
      return root ? textBeforeCaret(root) : "";
    },
    insertText: (text: string) => {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      // A popover (emoji, menu) may have taken the selection with it; only a
      // caret inside the field is honoured, otherwise the text goes at the end.
      const selection = root.ownerDocument.getSelection();
      if (selection && (selection.rangeCount === 0 || !root.contains(selection.anchorNode))) {
        const range = root.ownerDocument.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      insertTextAtCaret(root, text);
      emit();
    },
    replaceMention: (fromAt: number, label: string) => {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      const before = textBeforeCaret(root);
      const deleteCount = Math.max(1, before.length - fromAt);
      deleteCharsBeforeCaret(root, deleteCount);
      insertTextAtCaret(root, `@${label} `);
      emit();
    },
    applyFormat: (command) => {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      const doc = root.ownerDocument;
      const native: Partial<Record<ComposerFormat, string>> = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough', ul: 'insertUnorderedList', ol: 'insertOrderedList' };
      if (native[command]) doc.execCommand(native[command]!);
      else if (command === 'quote' || command === 'block') doc.execCommand('formatBlock', false, command === 'quote' ? 'blockquote' : 'pre');
      else if (command === 'link') {
        const href = doc.defaultView?.prompt('Link URL (https:// or mailto:)');
        if (href && /^(https?:\/\/|mailto:)/i.test(href)) doc.execCommand('createLink', false, href);
      } else if (command === 'code') {
        const selection = doc.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const code = doc.createElement('code');
        code.textContent = selection.toString() || 'code';
        range.deleteContents(); range.insertNode(code);
        range.selectNodeContents(code); selection.removeAllRanges(); selection.addRange(range);
      }
      reportFormats();
      emit();
    },
  }), [emit, reportFormats]);

  return (
    <div
      ref={rootRef}
      className="chat-composer-input"
      role="textbox"
      contentEditable={!disabled}
      suppressContentEditableWarning
      aria-multiline="true"
      aria-label={placeholder}
      aria-disabled={disabled || undefined}
      data-placeholder={placeholder}
      data-empty={value.trim().length === 0 ? "true" : undefined}
      onInput={emit}
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        onPaste?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text) return;
        const root = rootRef.current;
        if (!root) return;
        insertTextAtCaret(root, text);
        emit();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onBlur={onBlur}
    />
  );
});
