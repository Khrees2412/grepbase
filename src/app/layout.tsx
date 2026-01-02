import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grepbase - Understand Code Through Time",
  description: "Walk through any open source project's history with AI-powered explanations. Learn how projects evolved, one commit at a time.",
  keywords: ["code", "git", "learning", "AI", "open source", "commits"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
