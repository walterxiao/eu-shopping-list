import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shopping List",
  description:
    "Track product prices across regions and compare them side-by-side with live FX and tourist refund estimates.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
