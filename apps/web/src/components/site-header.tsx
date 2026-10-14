"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe, useSession } from "@/hooks/use-session";
import { usd } from "@/lib/format";
import { saveSession } from "@/lib/session";
import { PaddleDialog } from "./paddle-dialog";

export function SiteHeader() {
  const pathname = usePathname();
  const session = useSession();
  const me = useMe();

  const link = (href: string, label: string) => (
    <Link href={href} aria-current={pathname === href ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <header className="site-header">
      <div className="wrap site-header__inner">
        <Link href="/" className="wordmark">
          Café<span>/</span>Subasta
        </Link>
        <nav className="nav" aria-label="Main">
          {link("/", "Auction floor")}
          {link("/under-the-hood", "Under the hood")}
        </nav>
        {session ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="paddle-chip" title={`Signed in as ${session.displayName}`}>
              <span className="paddle-chip__no">{session.paddle}</span>
              <span className="paddle-chip__credit">
                {me ? `${usd(me.creditLimitCents - me.exposureCents)} available` : session.displayName}
              </span>
            </span>
            <button className="btn btn--ghost" onClick={() => saveSession(null)}>
              Return paddle
            </button>
          </div>
        ) : (
          <PaddleDialog
            trigger={(open) => (
              <button className="btn btn--cherry" onClick={open}>
                Get a paddle
              </button>
            )}
          />
        )}
      </div>
    </header>
  );
}
