import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Wezesha Restock OS · Demand & reorder intelligence",
  description: "Forecast demand and time reorders for Kenyan beauty retailers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink font-sans flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-line bg-canvas-raised">
          <div className="max-w-7xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between text-2xs text-mute">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
              <span className="font-semibold text-ink-soft">Wezesha Restock OS</span>
              <span className="hidden sm:inline">· demand &amp; reorder intelligence for Kenyan beauty retailers</span>
            </div>
            <div>
              <span>&copy; {new Date().getFullYear()} </span>
              <a
                href="https://simplydone.africa"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-soft hover:text-ink"
              >
                SimplyDone Africa
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
