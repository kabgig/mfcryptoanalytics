/**
 * Link-preview crawlers must never redeem a one-shot login token.
 *
 * Telegram fetches any URL it delivers so it can render a preview card. That
 * fetch hit /api/auth/exchange, consumed the token and took the session for
 * itself, leaving the real user with "?auth=expired" — reproduced at ~450ms
 * between mint and redemption.
 *
 * Disabling previews on the bot is the primary fix; this is defence in depth,
 * and also covers the other messengers that unfurl links (Slack, Discord,
 * WhatsApp, Signal) if a user ever forwards their link.
 *
 * Deliberately conservative: it matches only unambiguous bot identifiers, since
 * a false positive here would lock a real person out. A crawler that slips
 * through is no worse than today.
 */
const CRAWLER_UA = /\b(TelegramBot|WhatsApp|Slackbot|Discordbot|facebookexternalhit|Twitterbot|LinkedInBot|SkypeUriPreview|redditbot|Googlebot|bingbot|Applebot|vkShare|SignalPreview|iMessageBot)\b/i

export function isLinkPreviewCrawler(headers: Headers): boolean {
  const ua = headers.get("user-agent") ?? ""
  if (!ua) return false
  return CRAWLER_UA.test(ua)
}
