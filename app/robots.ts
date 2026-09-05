import type { MetadataRoute } from "next"

/**
 * Keeps the API and the app-only pages out of search and AI crawlers.
 *
 * `/share/` and `/viz/share/` are excluded too: the tokens in those URLs are the
 * only thing protecting a user's full trade history, and an indexed one is a
 * public one.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/auth", "/share/", "/viz/share/", "/import/"],
      },
    ],
  }
}
