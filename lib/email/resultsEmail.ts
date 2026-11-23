// The "your scan results are ready" email. Plain HTML with inline styles and tables, because
// email apps ignore stylesheets, CSS variables and most layout. The colours are the values of
// the shared tokens (app/tokens.css), written out: an email can't read the tokens.
//
// Built server-side when a scan finishes (lib/scanJobs), sent with Resend (lib/email/send.ts).

export type ResultsEmailInput = {
  locale: 'en' | 'fr'
  host: string            // polaroid.com
  euroPerMonth: string    // "€7.5k" (already formatted for the locale); empty when /start answers are missing
  score: number           // 0-100
  toFix: number           // findings on this page
  checked: number         // checkpoints run on this page
  easyHigh: number        // high-impact and easy findings
  top: { title: string; fix: string }[]  // up to 3, highest impact first
  resultsUrl: string
  callUrl: string
  qualified: boolean      // €50k/month and up: offer a call; below: the full report
  logoUrl: string
  avatarUrl: string       // Louis, for the signature
  privacyUrl: string
}

// token values (app/tokens.css): text, muted, border, canvas, surface, fail, gain, finding
const C = {
  text: '#09090b', muted: '#71717a', subtle: '#a1a1aa', border: '#e4e4e7', canvas: '#fafafa', surface: '#ffffff',
  fail: '#d92d20', failBg: '#fdeceb', gain: '#22a06b', gainBg: '#e8f7ef', finding: '#c2620f', findingBg: '#fff3e8', cta: '#09090b',
}
const DISPLAY = "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif"
const BODY = "'Inter Tight', 'Inter', 'Helvetica Neue', Arial, sans-serif"

const COPY = {
  en: {
    subject: (i: ResultsEmailInput) => i.euroPerMonth ? `Your product page leaves about ${i.euroPerMonth} a month on the table` : `Your conversion scan of ${i.host} is ready`,
    h1Plain: (i: ResultsEmailInput) => `Your conversion scan of ${i.host} is ready`,
    preheader: (i: ResultsEmailInput) => `${i.toFix} checkpoints to fix on ${i.host}. Start with the 3 inside.`,
    eyebrow: (i: ResultsEmailInput) => `Free conversion scan · ${i.host}`,
    h1a: 'Your product page leaves about', h1b: 'a month on the table',
    intro: (i: ResultsEmailInput) =>
      `We ran ${i.checked} conversion checkpoints on your page. ${i.toFix} need fixing${i.easyHigh ? `, ${i.easyHigh} of them high-impact and easy` : ''}. Here is where to start.`,
    score: 'Conversion score', tone: (s: number) => (s >= 80 ? 'Strong' : s >= 55 ? 'Room to grow' : 'Needs work'),
    start: 'Start with these 3',
    cta: (i: ResultsEmailInput) => `See all ${i.toFix} fixes`,
    ctaNote: 'Your results open on any device, with every issue pinned on your page.',
    call: 'Prefer to talk it through?', callLink: 'Book a call with us',
    report: 'Want every page checked, from homepage to checkout?', reportLink: 'Get the full-store report',
    sign: 'Louis', signRole: 'Founder, CXO Studio',
    footer: 'You get this email because you ran a free conversion scan on cxo.studio.',
    privacy: 'Privacy policy',
  },
  fr: {
    subject: (i: ResultsEmailInput) => i.euroPerMonth ? `Votre page produit laisse environ ${i.euroPerMonth} par mois sur la table` : `Votre scan de conversion de ${i.host} est prêt`,
    h1Plain: (i: ResultsEmailInput) => `Votre scan de conversion de ${i.host} est prêt`,
    preheader: (i: ResultsEmailInput) => `${i.toFix} points de contrôle à corriger sur ${i.host}. Commencez par les 3 à l’intérieur.`,
    eyebrow: (i: ResultsEmailInput) => `Scan de conversion gratuit · ${i.host}`,
    h1a: 'Votre page produit laisse environ', h1b: 'par mois sur la table',
    intro: (i: ResultsEmailInput) =>
      `Nous avons passé ${i.checked} points de contrôle sur votre page. ${i.toFix} sont à corriger${i.easyHigh ? `, dont ${i.easyHigh} à fort impact et faciles` : ''}. Voici par où commencer.`,
    score: 'Score de conversion', tone: (s: number) => (s >= 80 ? 'Solide' : s >= 55 ? 'Marge de progression' : 'À retravailler'),
    start: 'Commencez par ces 3',
    cta: (i: ResultsEmailInput) => `Voir les ${i.toFix} corrections`,
    ctaNote: 'Vos résultats s’ouvrent sur n’importe quel appareil, chaque problème épinglé sur votre page.',
    call: 'Vous préférez en parler ?', callLink: 'Réservez un appel avec nous',
    report: 'Vous voulez chaque page vérifiée, de l’accueil au paiement ?', reportLink: 'Obtenir le rapport complet',
    sign: 'Louis', signRole: 'Fondateur, CXO Studio',
    footer: 'Vous recevez cet e-mail parce que vous avez lancé un scan de conversion gratuit sur cxo.studio.',
    privacy: 'Politique de confidentialité',
  },
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildResultsEmail(i: ResultsEmailInput): { subject: string; html: string; text: string } {
  const t = COPY[i.locale] ?? COPY.en
  const tone = i.score >= 80 ? [C.gain, C.gainBg] : i.score >= 55 ? [C.finding, C.findingBg] : [C.fail, C.failBg]
  const top = i.top.slice(0, 3)

  const fixRows = top.map((f, n) => `
          <tr>
            <td valign="top" style="padding:14px 0;border-top:1px solid ${C.border};width:34px;">
              <div style="width:24px;height:24px;border-radius:12px;background:${C.fail};color:#ffffff;font:700 12px/24px ${BODY};text-align:center;">${n + 1}</div>
            </td>
            <td valign="top" style="padding:14px 0;border-top:1px solid ${C.border};">
              <div style="font:600 15px/1.4 ${BODY};color:${C.text};">${esc(f.title)}</div>
              <div style="font:400 14px/1.5 ${BODY};color:${C.muted};padding-top:4px;">${esc(f.fix)}</div>
            </td>
          </tr>`).join('')

  const html = `<!doctype html>
<html lang="${i.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(t.subject(i))}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet">
<style>
  @media (max-width: 560px) {
    .card { padding: 24px 20px !important; border-radius: 14px !important; }
    .h1 { font-size: 24px !important; }
    .wrap { padding: 16px 12px !important; }
  }
  a { color: ${C.text}; }
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.canvas};">${esc(t.preheader(i))}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
    <tr><td class="wrap" align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td align="center" style="padding:0 0 20px;">
          <img src="${esc(i.logoUrl)}" width="132" height="22" alt="CXO studio" style="display:block;border:0;width:132px;height:auto;">
        </td></tr>
        <tr><td class="card" style="background:${C.surface};border:1px solid ${C.border};border-radius:16px;padding:36px 36px 32px;">
          <div style="font:500 13px/1.4 ${BODY};color:${C.muted};">${esc(t.eyebrow(i))}</div>
          <h1 class="h1" style="margin:12px 0 0;font:700 28px/1.2 ${DISPLAY};letter-spacing:-0.5px;color:${C.text};">
            ${i.euroPerMonth ? `${esc(t.h1a)} <span style="color:${C.fail};">${esc(i.euroPerMonth)}</span> ${esc(t.h1b)}` : esc(t.h1Plain(i))}
          </h1>
          <p style="margin:14px 0 0;font:400 16px/1.55 ${BODY};color:${C.muted};">${esc(t.intro(i))}</p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
            <tr>
              <td style="background:${tone[1]};border-radius:999px;padding:6px 12px;font:600 13px/1.2 ${BODY};color:${tone[0]};">
                ${esc(t.score)} <span style="font:700 13px/1.2 ${DISPLAY};">${i.score}/100</span> · ${esc(t.tone(i.score))}
              </td>
            </tr>
          </table>

          ${top.length ? `<div style="margin:28px 0 4px;font:700 17px/1.3 ${DISPLAY};color:${C.text};">${esc(t.start)}</div>` : ''}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${fixRows}
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
            <tr><td align="center" style="border-radius:10px;background:${C.cta};">
              <a href="${esc(i.resultsUrl)}" style="display:block;padding:15px 20px;font:600 16px/1.2 ${BODY};color:#ffffff;text-decoration:none;border-radius:10px;">${esc(t.cta(i))} &rsaquo;</a>
            </td></tr>
          </table>
          <p style="margin:10px 0 0;font:400 13px/1.5 ${BODY};color:${C.muted};text-align:center;">${esc(t.ctaNote)}</p>

          <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid ${C.border};font:400 14px/1.6 ${BODY};color:${C.muted};">
            ${i.qualified ? esc(t.call) : esc(t.report)} <a href="${esc(i.qualified ? i.callUrl : `${i.resultsUrl}#full-report`)}" style="color:${C.text};font-weight:600;text-decoration:underline;">${esc(i.qualified ? t.callLink : t.reportLink)}</a>
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;">
            <tr>
              <td valign="middle" style="padding-right:12px;">
                <img src="${esc(i.avatarUrl)}" width="48" height="48" alt="${esc(t.sign)}" style="display:block;width:48px;height:48px;border-radius:24px;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(9,9,11,0.14);">
              </td>
              <td valign="middle" style="font:400 14px/1.45 ${BODY};color:${C.text};">
                <span style="font-weight:600;">${esc(t.sign)}</span><br><span style="color:${C.muted};">${esc(t.signRole)}</span>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:20px 12px 0;font:400 12px/1.6 ${BODY};color:${C.subtle};">
          ${esc(t.footer)}<br>CXO Studio · Amsterdam · <a href="${esc(i.privacyUrl)}" style="color:${C.subtle};">${esc(t.privacy)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    t.subject(i), '', t.intro(i), '', `${t.score}: ${i.score}/100 (${t.tone(i.score)})`, '', t.start,
    ...top.map((f, n) => `${n + 1}. ${f.title}\n   ${f.fix}`), '', `${t.cta(i)}: ${i.resultsUrl}`, '',
    i.qualified ? `${t.call} ${t.callLink}: ${i.callUrl}` : `${t.report} ${t.reportLink}: ${i.resultsUrl}`, '', `${t.sign}, ${t.signRole}`, '', t.footer,
  ].join('\n')

  return { subject: t.subject(i), html, text }
}
