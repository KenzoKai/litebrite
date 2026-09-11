import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Afterglow — a little light between us",
  description: "A private light board for two. Draw together, watch the lights fade, leave no message history.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
