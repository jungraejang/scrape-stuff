import type { Metadata } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";
import Footer from "@/components/Footer";
import ThemeBar from "@/components/theme-bar";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pressStart2P = Press_Start_2P({
  variable: "--font-pixel",
  weight: "400",
  subsets: ["latin"],
});

// SITE_URL can be a comma-separated list (dev server, production) for the
// scrapers' revalidation pings; the metadata base only needs one entry, so
// prefer the last (production) URL.
function getMetadataBase(): URL | undefined {
  const urls = (process.env.SITE_URL ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const pick = urls[urls.length - 1];
  if (!pick) return undefined;
  try {
    return new URL(pick);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  title: "JR's List",
  description: "Sub-3k rental listings in NYC",
  // Absolute URL base for the Open Graph / Twitter images (file convention
  // opengraph-image.tsx provides the image itself).
  metadataBase: getMetadataBase(),
  openGraph: {
    title: "JR's List",
    description: "NYC housing listings, mostly under $3,000.",
    siteName: "JR's List",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "JR's List",
    description: "NYC housing listings, mostly under $3,000.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart2P.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme-view");if(t==="8bit")document.documentElement.classList.add("theme-8bit")}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <ThemeBar />
          {children}
          <Footer />
        </ThemeProvider>
      </body>
      {process.env.NEXT_PUBLIC_GA_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
      )}
    </html>
  );
}
