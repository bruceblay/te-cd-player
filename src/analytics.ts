import { inject, track as vercelTrack } from '@vercel/analytics'

/*
 * Vercel Web Analytics: page views, referrers, countries and devices come from
 * inject(). The events below record what people actually use. Development
 * stays out of the dashboard: events are only logged to the console there.
 */
if (import.meta.env.PROD) inject({ mode: 'production' })

type Props = Record<string, string | number | boolean>

export function track(event: string, props?: Props) {
  if (import.meta.env.PROD) vercelTrack(event, props)
  else console.debug('[analytics]', event, props ?? '')
}

/** Track an event only the first time it happens in this visit (e.g. the first play). */
const seen = new Set<string>()
export function trackOnce(event: string, props?: Props) {
  if (seen.has(event)) return
  seen.add(event)
  track(event, props)
}
