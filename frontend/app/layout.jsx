import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "AdPulse — Analitik Iklan Lintas Platform",
  description:
    "Semua data iklan Google, Meta & LinkedIn dalam satu dashboard, plus insight AI harian yang dikirim ke email Anda.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
