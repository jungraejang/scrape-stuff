import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "data.heykorean.com",
      },
      {
        protocol: "https",
        hostname: "photos.zillowstatic.com",
      },
      {
        // Zillow uses a static satellite map as the photo for listings
        // without real photos.
        protocol: "https",
        hostname: "maps.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "photos.streeteasy.com",
      },
      {
        protocol: "https",
        hostname: "images.craigslist.org",
      },
      {
        // Facebook Marketplace photos (scontent-*.fbcdn.net)
        protocol: "https",
        hostname: "**.fbcdn.net",
      },
    ],
  },
};

export default nextConfig;
