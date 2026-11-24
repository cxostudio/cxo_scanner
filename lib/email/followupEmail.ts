// Follow-ups after a free scan (lib/followups): a short, personal note from Louis, same look as the
// results email. Every one carries an unsubscribe link that stops all follow-ups for that address.
import { BODY, C, DISPLAY, esc } from './resultsEmail'

export type FollowupKind = 'offer' | 'call1' | 'call2'
export type FollowupInput = {
  kind: FollowupKind
  locale: 'en' | 'fr'
  host: string
  toFix: number                 // issues the free scan found
  topIssue?: string             // the first fix to make (call emails)
  topFix?: string
  euroPerMonth?: string         // "€7.5k", already formatted; empty without /start answers
  resultsUrl: string            // the free results (offer: with #full-report)
  callUrl: string
  unsubscribeUrl: string
  logoUrl: string
  avatarUrl: string
}

type Copy = { subject: string; preheader: string; eyebrow: string; h1: string; body: string[]; cta: string; url: string; note?: string }

function copy(i: FollowupInput): Copy {
  const fr = i.locale === 'fr'
  if (i.kind === 'offer') return fr ? {
    subject: `Plus que 15 minutes : votre rapport complet à 69 €`,
    preheader: `Le prix de 69 € au lieu de 89 € se termine dans 15 minutes.`,
    eyebrow: `Rapport complet · ${i.host}`,
    h1: `Plus que 15 minutes pour votre rapport à 69 €`,
    body: [
      `Votre scan gratuit de ${i.host} a trouvé ${i.toFix} points à corriger, sur une seule page.`,
      `Le rapport complet passe les 184 points de contrôle sur votre accueil, une collection, votre meilleure vente, le panier et le paiement, sur desktop et mobile. Chaque problème est épinglé sur la page, avec la correction et des exemples. Il arrive dans votre boîte mail en quelques minutes.`,
      `Votre prix de 69 € au lieu de 89 € se termine dans 15 minutes.`,
    ],
    cta: `Obtenir le rapport complet à 69 €`, url: `${i.resultsUrl}#full-report`,
  } : {
    subject: `15 minutes left: your full report at €69`,
    preheader: `Your €69 price (instead of €89) ends in 15 minutes.`,
    eyebrow: `Full conversion report · ${i.host}`,
    h1: `15 minutes left for your full report at €69`,
    body: [
      `Your free scan of ${i.host} found ${i.toFix} issues, on one page.`,
      `The full report runs all 184 checkpoints on your homepage, a collection, your best seller, the cart and checkout, on desktop and mobile. Every issue is pinned on the page, with the fix and real-store examples. It lands in your inbox in a few minutes.`,
      `Your €69 price, instead of €89, ends in 15 minutes.`,
    ],
    cta: `Get the full report for €69`, url: `${i.resultsUrl}#full-report`,
  }
  if (i.kind === 'call1') return fr ? {
    subject: `${i.host} : la correction par laquelle je commencerais`,
    preheader: i.topIssue ? `${i.topIssue}` : `Votre scan, en 30 minutes, avec nous.`,
    eyebrow: `Votre scan de ${i.host}`,
    h1: i.euroPerMonth ? `Environ ${i.euroPerMonth} par mois en jeu sur ${i.host}` : `La première correction pour ${i.host}`,
    body: [
      `Bonjour, merci d'avoir scanné ${i.host} hier.`,
      ...(i.topFix ? [`La correction par laquelle je commencerais : ${i.topFix}`] : []),
      ...(i.topIssue ? [`Ce que nous avons vu : ${i.topIssue}`] : []),
      `Votre scan a trouvé ${i.toFix} points à corriger sur une seule page. En 30 minutes, je parcours vos résultats avec vous, je vous dis quoi corriger en premier pour vos chiffres, et si travailler ensemble serait rentable. Sans engagement.`,
    ],
    cta: `Réserver un appel`, url: i.callUrl, note: `Si vous avez déjà réservé, ignorez ce message.`,
  } : {
    subject: `${i.host}: the one fix I'd start with`,
    preheader: i.topIssue ? `${i.topIssue}` : `Your scan, gone through with us in 30 minutes.`,
    eyebrow: `Your scan of ${i.host}`,
    h1: i.euroPerMonth ? `About ${i.euroPerMonth} a month at stake on ${i.host}` : `The first fix for ${i.host}`,
    body: [
      `Hi, thanks for scanning ${i.host} yesterday.`,
      ...(i.topFix ? [`The fix I'd start with: ${i.topFix}`] : []),
      ...(i.topIssue ? [`What we saw: ${i.topIssue}`] : []),
      `Your scan found ${i.toFix} issues on one page alone. On a 30-minute call I go through your results with you, tell you what to fix first for your numbers, and whether working together would pay off. No strings attached.`,
    ],
    cta: `Book a call`, url: i.callUrl, note: `If you've already booked, ignore this.`,
  }
  return fr ? {
    subject: `Comment Skinlovers a gagné 11,7 % de revenu par visiteur`,
    preheader: `Dernier message de ma part au sujet de ${i.host}.`,
    eyebrow: `Votre scan de ${i.host}`,
    h1: `+11,7 % de revenu par visiteur pour Skinlovers`,
    body: [
      `Dernier message de ma part à ce sujet.`,
      `Skinlovers est arrivé avec le même genre de constats que ${i.host}. Nous avons corrigé dans l'ordre, et testé en A/B les plus gros changements : +11,7 % de revenu par visiteur.`,
      `Si vous voulez la même chose pour ${i.host}, réservez un appel. Sinon, je ne vous écris plus à ce sujet.`,
    ],
    cta: `Réserver un appel`, url: i.callUrl, note: `Si vous avez déjà réservé, ignorez ce message.`,
  } : {
    subject: `How Skinlovers added 11.7% revenue per visitor`,
    preheader: `Last note from me about ${i.host}.`,
    eyebrow: `Your scan of ${i.host}`,
    h1: `+11.7% revenue per visitor for Skinlovers`,
    body: [
      `Last note from me on this.`,
      `Skinlovers came to us with the same kind of findings as ${i.host}. We fixed them in order and A/B tested the big changes: +11.7% revenue per visitor.`,
      `If you want the same for ${i.host}, book a call. If not, this is the last email from me about it.`,
    ],
    cta: `Book a call`, url: i.callUrl, note: `If you've already booked, ignore this.`,
  }
}

export function buildFollowupEmail(i: FollowupInput): { subject: string; html: string; text: string } {
  const t = copy(i)
  const fr = i.locale === 'fr'
  const sign = 'Louis', role = fr ? 'Fondateur, CXO studio' : 'Founder, CXO studio'
  const unsub = fr ? 'Ne plus recevoir ces emails' : 'Stop these emails'
  const footer = fr ? 'Vous recevez cet email après votre scan de conversion gratuit sur cxo.studio.' : 'You get this email after your free conversion scan on cxo.studio.'
  const html = `<!doctype html>
<html lang="${i.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(t.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet">
<style>@media (max-width: 560px) { .card { padding: 24px 20px !important; } .h1 { font-size: 24px !important; } .wrap { padding: 16px 12px !important; } }</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.canvas};">${esc(t.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
    <tr><td class="wrap" align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td align="center" style="padding:0 0 20px;"><img src="${esc(i.logoUrl)}" width="132" alt="CXO studio" style="display:block;border:0;width:132px;height:auto;"></td></tr>
        <tr><td class="card" style="background:${C.surface};border:1px solid ${C.border};border-radius:16px;padding:36px 36px 32px;">
          <div style="font:500 13px/1.4 ${BODY};color:${C.muted};">${esc(t.eyebrow)}</div>
          <h1 class="h1" style="margin:12px 0 0;font:700 28px/1.2 ${DISPLAY};letter-spacing:-0.5px;color:${C.text};">${esc(t.h1)}</h1>
          ${t.body.map((p) => `<p style="margin:14px 0 0;font:400 16px/1.6 ${BODY};color:${C.muted};">${esc(p)}</p>`).join('\n          ')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
            <tr><td align="center" style="border-radius:10px;background:${C.cta};">
              <a href="${esc(t.url)}" style="display:block;padding:15px 20px;font:600 16px/1.2 ${BODY};color:#ffffff;text-decoration:none;border-radius:10px;">${esc(t.cta)} &rsaquo;</a>
            </td></tr>
          </table>
          ${t.note ? `<p style="margin:10px 0 0;font:400 13px/1.5 ${BODY};color:${C.muted};text-align:center;">${esc(t.note)}</p>` : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
            <tr>
              <td valign="middle" style="padding-right:12px;"><img src="${esc(i.avatarUrl)}" width="48" height="48" alt="${sign}" style="display:block;width:48px;height:48px;border-radius:24px;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(9,9,11,0.14);"></td>
              <td valign="middle" style="font:400 14px/1.45 ${BODY};color:${C.text};"><span style="font-weight:600;">${sign}</span><br><span style="color:${C.muted};">${esc(role)}</span></td>
            </tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:20px 12px 0;font:400 12px/1.6 ${BODY};color:${C.subtle};">
          ${esc(footer)}<br>CXO studio · Amsterdam · <a href="${esc(i.unsubscribeUrl)}" style="color:${C.subtle};">${esc(unsub)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  const text = [t.h1, '', ...t.body.flatMap((p) => [p, '']), `${t.cta}: ${t.url}`, ...(t.note ? [t.note] : []), '', `${sign}, ${role}`, '', footer, `${unsub}: ${i.unsubscribeUrl}`].join('\n')
  return { subject: t.subject, html, text }
}
