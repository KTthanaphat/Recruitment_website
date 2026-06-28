import type { Metadata } from "next";
import { Prompt } from "next/font/google";
import "./globals.css";

const prompt = Prompt({
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-prompt",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Recruitment Tracking",
  description: "Internal recruitment tracking system"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={prompt.variable}>
      <body>{children}</body>
    </html>
  );
}
