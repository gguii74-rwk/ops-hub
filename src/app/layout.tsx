import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ops-hub",
  description: "내부 업무 운영 허브",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
