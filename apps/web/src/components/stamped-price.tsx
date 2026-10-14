"use client";
import { useEffect, useState } from "react";
import { usd } from "@/lib/format";

/** A price that "stamps" whenever a new bid arrives (`bidAt` changes). */
export function StampedPrice({ cents, bidAt, className = "" }: { cents: number; bidAt: number; className?: string }) {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!bidAt) return;
    setFresh(true);
    const id = setTimeout(() => setFresh(false), 750);
    return () => clearTimeout(id);
  }, [bidAt]);

  return (
    <span className={`stencil stamp ${className}`} data-fresh={fresh} aria-live="polite">
      {usd(cents)}
    </span>
  );
}
