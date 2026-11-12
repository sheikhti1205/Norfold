import { useEffect, useRef, useState } from "react";
import { Archive, Download, File as FileIcon, FileText, Film, Music } from "lucide-react";
import { downloadChatFile, type ChatFileMeta } from "../services/messaging/files";
import "./ChatFile.css";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function IconFor({ kind }: { kind: ChatFileMeta["kind"] }) {
  if (kind === "video") return <Film size={22} aria-hidden="true" />;
  if (kind === "audio") return <Music size={22} aria-hidden="true" />;
  if (kind === "archive") return <Archive size={22} aria-hidden="true" />;
  if (kind === "pdf" || kind === "document") return <FileText size={22} aria-hidden="true" />;
  return <FileIcon size={22} aria-hidden="true" />;
}

/**
 * One ordinary file in the transcript. Nothing is fetched until the reader
 * asks: a 20 MB video must not download because a thread opened. The object
 * URL is revoked when the bubble unmounts.
 *
 * Documents open through a download, which is deliberate: the file is data,
 * not a page, and the bucket already refuses HTML and SVG.
 */
export function ChatFile({ meta }: { meta: ChatFileMeta }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [src, setSrc] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  async function open() {
    if (state === "loading") return;
    if (state === "ready" && src) {
      if (meta.kind === "video" || meta.kind === "audio") return;
      triggerDownload(src, meta.name);
      return;
    }
    setState("loading");
    try {
      const blob = await downloadChatFile(meta.key);
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setSrc(url);
      setState("ready");
      if (meta.kind !== "video" && meta.kind !== "audio") triggerDownload(url, meta.name);
    } catch {
      setState("error");
    }
  }

  if (state === "ready" && src && meta.kind === "video") {
    return <video className="fb-chat-file-video" src={src} controls playsInline preload="metadata"
      aria-label={meta.name} />;
  }
  if (state === "ready" && src && meta.kind === "audio") {
    return <audio className="fb-chat-file-audio" src={src} controls preload="metadata"
      aria-label={meta.name} />;
  }

  return (
    <div className="fb-chat-file" data-kind={meta.kind}>
      <span className="fb-chat-file-icon"><IconFor kind={meta.kind} /></span>
      <span className="fb-chat-file-copy">
        <span className="fb-chat-file-name" title={meta.name}>{meta.name}</span>
        <span className="fb-chat-file-size">{humanSize(meta.byteSize)}</span>
      </span>
      <button type="button" className="fb-chat-file-action" onClick={() => void open()}
        aria-label={`Open ${meta.name}`} disabled={state === "loading"}>
        {state === "loading" ? "Opening…" : state === "error" ? "Unavailable" : <><Download size={18} aria-hidden="true" /> Open</>}
      </button>
      {state === "error" && <p role="status" className="fb-chat-file-error">That file is no longer available.</p>}
    </div>
  );
}

function triggerDownload(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noreferrer";
  anchor.click();
}
