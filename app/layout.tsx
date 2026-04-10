import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "eu-shopping-list",
  description:
    "Build a grocery list and compare prices across EU supermarkets.",
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
