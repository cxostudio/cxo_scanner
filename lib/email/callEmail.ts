// Emails around a booked call (lib/calls): reminders to the attendee, and a heads-up to the team.
// Same look as the follow-ups. Transactional: no unsubscribe link, they booked this call.
import { BODY, C, DISPLAY, esc } from './resultsEmail'

export type ReminderInput = {
  kind: '24h' | '1h'
  locale: 'en' | 'fr'
  firstName: string
  when: string              // "Wednesday 26 November at 14:00", in their time zone
  time: string              // "14:00"
  today?: boolean           // the call is later today, not tomorrow
  zone?: string             // short code: CET, GMT, EST...
  store?: string
  joinUrl?: string
  prepUrl?: string          // their report or free scan
  prepIsReport?: boolean
  rescheduleUrl: string
  cancelUrl: string
  logoUrl: string
  avatarUrl: string
}

export function buildReminderEmail(i: ReminderInput): { subject: string; html: string; text: string } {
  const fr = i.locale === 'fr'
  const hi = i.firstName ? (fr ? `Bonjour ${i.firstName},` : `Hi ${i.firstName},`) : (fr ? 'Bonjour,' : 'Hi,')
  const about = i.store ? (fr ? ` sur ${i.store}` : ` about ${i.store}`) : (fr ? ' sur votre site' : ' about your website')
  const prep = i.prepUrl
    ? fr
      ? `Pour profiter des 30 minutes : ouvrez ${i.prepIsReport ? 'votre rapport' : 'les résultats de votre scan'} et notez les 2 ou 3 points dont vous voulez parler. On part de là.`
      : `To get the most out of the 30 minutes: open your ${i.prepIsReport ? 'report' : 'scan results'} and note the 2 or 3 findings you want to go through. We start from there.`
    : fr
      ? `Pour profiter des 30 minutes : ayez sous la main votre chiffre d'affaires mensuel, votre taux de conversion et les pages qui vous inquiètent le plus.`
      : `To get the most out of the 30 minutes: have your monthly revenue, conversion rate and the pages you worry about most at hand.`
  const t = i.kind === '24h'
    ? {
        subject: fr ? `${i.today ? "Aujourd'hui" : 'Demain'} à ${i.time} : notre appel${about}` : `${i.today ? 'Today' : 'Tomorrow'} at ${i.time}: our call${about}`,
        h1: fr ? `On se parle ${i.today ? "aujourd'hui" : 'demain'} à ${i.time}` : `Talk ${i.today ? 'today' : 'tomorrow'} at ${i.time}`,
        body: [hi, fr ? `Petit rappel de notre appel de 30 minutes${about}, ${i.when}.` : `A quick reminder of our 30-minute call${about}, ${i.when}.`, prep],
        cta: i.prepUrl ? (fr ? (i.prepIsReport ? 'Ouvrir mon rapport' : 'Ouvrir mes résultats') : (i.prepIsReport ? 'Open my report' : 'Open my scan results')) : (fr ? "Lien de l'appel" : 'Call link'),
        url: i.prepUrl || i.joinUrl || i.rescheduleUrl,
      }
    : {
        subject: fr ? `Dans 1 heure : notre appel${about}` : `In 1 hour: our call${about}`,
        h1: fr ? `On se parle dans 1 heure` : `We talk in 1 hour`,
        body: [hi, fr ? `Notre appel commence à ${i.time}${i.zone ? ` (${i.zone})` : ''}. Le lien est ci-dessous.` : `Our call starts at ${i.time}${i.zone ? ` (${i.zone})` : ''}. The link is below.`],
        cta: fr ? "Rejoindre l'appel" : 'Join the call',
        url: i.joinUrl || i.rescheduleUrl,
      }
  const links = [
    ...(i.kind === '24h' && i.prepUrl && i.joinUrl ? [[fr ? "Lien de l'appel" : 'Call link', i.joinUrl]] : []),
    [fr ? 'Déplacer' : 'Reschedule', i.rescheduleUrl],
    [fr ? 'Annuler' : 'Cancel', i.cancelUrl],
  ] as [string, string][]
  const sign = 'Louis', role = fr ? 'Fondateur, CXO studio' : 'Founder, CXO studio'
  const footer = fr ? 'Vous recevez cet email car vous avez réservé un appel avec CXO studio.' : 'You get this email because you booked a call with CXO studio.'
  const html = `<!doctype html>
<html lang="${i.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(t.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet">
<style>@media (max-width: 560px) { .card { padding: 24px 20px !important; } .h1 { font-size: 24px !important; } .wrap { padding: 16px 12px !important; } }</style></head>
<body style="margin:0;padding:0;background:${C.canvas};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
    <tr><td class="wrap" align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td align="center" style="padding:0 0 20px;"><img src="${esc(i.logoUrl)}" width="132" alt="CXO studio" style="display:block;border:0;width:132px;height:auto;"></td></tr>
        <tr><td class="card" style="background:${C.surface};border:1px solid ${C.border};border-radius:16px;padding:36px 36px 32px;">
          <div style="font:500 13px/1.4 ${BODY};color:${C.muted};">${esc(fr ? 'Votre appel avec CXO studio' : 'Your call with CXO studio')} · ${esc(i.when)}</div>
          <h1 class="h1" style="margin:12px 0 0;font:700 28px/1.2 ${DISPLAY};letter-spacing:-0.5px;color:${C.text};">${esc(t.h1)}</h1>
          ${t.body.map((p) => `<p style="margin:14px 0 0;font:400 16px/1.6 ${BODY};color:${C.muted};">${esc(p)}</p>`).join('\n          ')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
            <tr><td align="center" style="border-radius:10px;background:${C.cta};"><a href="${esc(t.url)}" style="display:block;padding:15px 20px;font:600 16px/1.2 ${BODY};color:#ffffff;text-decoration:none;border-radius:10px;">${esc(t.cta)} &rsaquo;</a></td></tr>
          </table>
          <p style="margin:12px 0 0;font:400 13px/1.5 ${BODY};color:${C.muted};text-align:center;">${links.map(([l, u]) => `<a href="${esc(u)}" style="color:${C.muted};">${esc(l)}</a>`).join(' &nbsp;·&nbsp; ')}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;"><tr>
            <td valign="middle" style="padding-right:12px;"><img src="${esc(i.avatarUrl)}" width="48" height="48" alt="${sign}" style="display:block;width:48px;height:48px;border-radius:24px;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(9,9,11,0.14);"></td>
            <td valign="middle" style="font:400 14px/1.45 ${BODY};color:${C.text};"><span style="font-weight:600;">${sign}</span><br><span style="color:${C.muted};">${esc(role)}</span></td>
          </tr></table>
        </td></tr>
        <tr><td align="center" style="padding:20px 12px 0;font:400 12px/1.6 ${BODY};color:${C.subtle};">${esc(footer)}<br>CXO studio · Amsterdam</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
  const text = [t.h1, '', ...t.body.flatMap((p) => [p, '']), `${t.cta}: ${t.url}`, ...links.map(([l, u]) => `${l}: ${u}`), '', `${sign}, ${role}`, '', footer].join('\n')
  return { subject: t.subject, html, text }
}

/** Plain heads-up to the team inbox: who booked, with what we know about them. */
export function buildBookedAlert(b: { name: string; email: string; when: string; source?: string; store?: string; revenue?: string; links: [string, string][]; answers: [string, string][]; rescheduled?: boolean }) {
  const subject = `${b.rescheduled ? 'Call moved' : 'New call'}: ${b.name || b.email}${b.store ? ` (${b.store})` : ''}, ${b.when}`
  const rows: [string, string][] = [['Who', `${b.name} <${b.email}>`], ['When', b.when], ...(b.store ? [['Store', b.store] as [string, string]] : []), ...(b.revenue ? [['Revenue band', b.revenue] as [string, string]] : []), ['Booked from', b.source || 'direct link'], ...b.answers]
  const text = [...rows.map(([k, v]) => `${k}: ${v}`), '', ...b.links.map(([k, v]) => `${k}: ${v}`)].join('\n')
  const html = `<div style="font:14px/1.6 -apple-system,Segoe UI,sans-serif;color:#18181b">${rows.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}<p>${b.links.map(([k, v]) => `<a href="${esc(v)}">${esc(k)}</a>`).join(' · ')}</p></div>`
  return { subject, html, text }
}
