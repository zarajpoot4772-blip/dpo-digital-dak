"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Tool } from "@/lib/tools";
import { MAX_FILE_BYTES } from "@/lib/tools";

type Result = {
  url: string;
  filename: string;
  note: string;
  size: number;
  ms: number;
};

/**
 * Trigger a real file download.
 *
 * Returns false when the browser refused — most commonly because the page is
 * running inside a sandboxed preview iframe that was not granted the
 * `allow-downloads` permission, in which case the click silently does nothing.
 */
function triggerDownload(url: string, filename: string): boolean {
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    return false;
  }
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function defaults(tool: Tool): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of tool.fields ?? []) {
    map[field.name] =
      field.type === "checkbox"
        ? String(field.default ?? false)
        : String(field.default ?? "");
  }
  return map;
}

export default function ConverterPanel({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [options, setOptions] = useState<Record<string, string>>(() => defaults(tool));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    setEmbedded(inIframe());
    setPageUrl(window.location.href);
  }, []);

  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      setError(null);
      setResult(null);
      const list = Array.from(incoming);
      if (list.length === 0) return;

      const accepted: File[] = [];
      for (const file of list) {
        const ext = file.name.includes(".")
          ? file.name.split(".").pop()!.toLowerCase()
          : "";
        if (ext && !tool.extensions.includes(ext)) {
          setError(
            `"${file.name}" is not supported here. This tool accepts ${tool.extensions
              .map((e) => `.${e}`)
              .join(", ")}.`,
          );
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(`"${file.name}" is larger than 100 MB.`);
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length === 0) return;

      setFiles((previous) => {
        const next = tool.multiple ? [...previous, ...accepted] : [accepted[0]];
        if (next.length > tool.maxFiles) {
          setError(`Only ${tool.maxFiles} files can be processed at once.`);
          return next.slice(0, tool.maxFiles);
        }
        return next;
      });
    },
    [tool],
  );

  const move = (index: number, direction: -1 | 1) => {
    setFiles((previous) => {
      const next = [...previous];
      const target = index + direction;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const submit = async () => {
    if (files.length === 0) {
      setError("Please choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      for (const [key, value] of Object.entries(options)) body.append(key, value);

      const response = await fetch(`/api/convert/${tool.slug}`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        let message = `The conversion failed (HTTP ${response.status}).`;
        try {
          const payload = await response.json();
          if (payload?.error) message = payload.error;
        } catch {
          /* non JSON error */
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename = decodeURIComponent(
        response.headers.get("X-Converted-Filename") ?? "converted",
      );
      const note = decodeURIComponent(response.headers.get("X-Convert-Note") ?? "");
      const ms = Number(response.headers.get("X-Convert-Ms") ?? 0);

      const url = URL.createObjectURL(blob);
      setResult({ url, filename, note, size: blob.size, ms });
      // Start the download immediately — the click that began the conversion
      // still counts as user activation, so browsers allow it.
      triggerDownload(url, filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="panel">
      <div
        className={`dropzone${dragging ? " drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
      >
        <div className="dz-icon">↑</div>
        <strong>
          {tool.multiple ? "Drop your files here" : "Drop your file here"}
        </strong>
        <small>
          or click to browse — {tool.extensions.map((e) => `.${e}`).join(", ")} ·
          max 100 MB{tool.multiple ? ` · up to ${tool.maxFiles} files` : ""}
        </small>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={tool.accept}
          multiple={tool.multiple}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              {tool.multiple && files.length > 1 && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Move down"
                    disabled={index === files.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
              <span className="name">{file.name}</span>
              <span className="size">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="icon-btn"
                title="Remove"
                onClick={() =>
                  setFiles((previous) => previous.filter((_, i) => i !== index))
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 1 && (
        <p className="note" style={{ textAlign: "left", marginTop: 10 }}>
          {files.length} files · {formatBytes(totalSize)} total
          {tool.slug === "merge-pdf" || tool.slug === "image-to-pdf"
            ? " — use the arrows to set the order."
            : ""}
        </p>
      )}

      {(tool.fields?.length ?? 0) > 0 && (
        <div className="options">
          {tool.fields!.map((field) => (
            <div className="field" key={field.name}>
              {field.type === "checkbox" ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={options[field.name] === "true"}
                    onChange={(event) =>
                      setOptions((previous) => ({
                        ...previous,
                        [field.name]: String(event.target.checked),
                      }))
                    }
                  />
                  {field.label}
                </label>
              ) : (
                <>
                  <label htmlFor={`f-${field.name}`}>{field.label}</label>
                  {field.type === "select" ? (
                    <select
                      id={`f-${field.name}`}
                      value={options[field.name] ?? ""}
                      onChange={(event) =>
                        setOptions((previous) => ({
                          ...previous,
                          [field.name]: event.target.value,
                        }))
                      }
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`f-${field.name}`}
                      type={field.type === "number" ? "number" : "text"}
                      min={field.min}
                      max={field.max}
                      placeholder={field.placeholder}
                      value={options[field.name] ?? ""}
                      onChange={(event) =>
                        setOptions((previous) => ({
                          ...previous,
                          [field.name]: event.target.value,
                        }))
                      }
                    />
                  )}
                </>
              )}
              {field.help && <small>{field.help}</small>}
            </div>
          ))}
        </div>
      )}

      <button className="btn" onClick={submit} disabled={busy || files.length === 0}>
        {busy ? (
          <>
            <span className="spinner" /> Converting…
          </>
        ) : (
          <>{tool.title} →</>
        )}
      </button>

      {error && <div className="alert error">{error}</div>}

      {result && (
        <div className="result">
          <h3>Done!</h3>
          <p>
            <strong>{result.filename}</strong> · {formatBytes(result.size)}
            {result.ms ? ` · ${(result.ms / 1000).toFixed(1)}s` : ""}
            {result.note ? ` · ${result.note}` : ""}
          </p>
          <a
            className="btn"
            href={result.url}
            download={result.filename}
            onClick={(event) => {
              event.preventDefault();
              triggerDownload(result.url, result.filename);
            }}
          >
            ↓ Download {result.filename}
          </a>

          <div className="fallback">
            <span>Download didn’t start?</span>
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              Open the file in a new tab
            </a>
            {embedded && (
              <>
                <span aria-hidden="true">·</span>
                <a href={pageUrl} target="_blank" rel="noopener noreferrer">
                  Open this tool in a full browser tab
                </a>
              </>
            )}
          </div>

          {embedded && (
            <p className="fallback-hint">
              This page is running inside a preview frame, and browsers block
              file downloads from sandboxed frames. Opening the tool in a normal
              browser tab makes the download button work normally.
            </p>
          )}
        </div>
      )}

      <p className="note">
        Your file is processed in memory on the server and discarded immediately
        after the response. Nothing is saved or shared.
      </p>
    </div>
  );
}
