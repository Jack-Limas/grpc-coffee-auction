import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/site-header";
// Self-hosted fonts: no request to a third-party font CDN at runtime.
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/big-shoulders-stencil-display/700";
import "@fontsource/big-shoulders-stencil-display/800";
import "@fontsource/big-shoulders-stencil-display/900";
import "./globals.css";

export const metadata: Metadata = {
  title: "Café Subasta — live specialty coffee auction",
  description:
    "Bid on Colombian specialty micro-lots in real time. Built contract-first with gRPC, Protocol Buffers and HTTP/2.",
};

export const viewport: Viewport = { themeColor: "#e3e8da" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            Café Subasta is a teaching project. Lots, farms and producers are fictional, and no real money moves.
            Every screen talks to the server through one gRPC contract.
          </div>
        </footer>
      </body>
    </html>
  );
}
