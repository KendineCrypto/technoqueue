"use client";
import { Copy, Share2 } from "lucide-react";
import { useState } from "react";
function short(did: string | null) { return did ? `${did.slice(0, 16)}…${did.slice(-6)}` : "Pending"; }
export function ShareButtons({ title, worker, reviewer }: { title: string; worker: string | null; reviewer: string | null }) {
  const [copied, setCopied] = useState(false);
  async function copy() { await navigator.clipboard.writeText(location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }
  function share() { const text = `TechnoQueue task completed ⚡\n\nTask: ${title}\n\nWorker: ${short(worker)}\nReviewer: ${short(reviewer)}\n\n✓ Result attested\n✓ Review attested\n\nCoordinated through @flop_labs Technocore.\n\n${location.href}`; window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer"); }
  return <div style={{ display: "grid", gap: 8 }}><button className="button" onClick={copy}><Copy size={13}/>{copied ? "Copied" : "Copy task link"}</button><button className="button" onClick={share}><Share2 size={13}/> Share task</button></div>;
}
