// Pages publiques : accueil, politique de confidentialité, suppression des données (exigées par Meta).
import { echapperHtml as h } from "./format.js";

const CSS = `body{margin:0;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f5f6f8;color:#1c2230}
main{max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:28px}
a{color:#0f7b6c}code{background:#e8ebef;padding:2px 6px;border-radius:6px}
@media (prefers-color-scheme: dark){body{background:#111419;color:#e6e9ef}code{background:#262c36}a{color:#2fb9a6}}`;

function gabarit(titre, contenu) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(titre)}</title><style>${CSS}</style></head><body><main>${contenu}</main></body></html>`;
}

function nom(nomEntreprise) {
  return nomEntreprise ? h(nomEntreprise) : "notre entreprise";
}

export function pageAccueil(nomEntreprise) {
  return gabarit(
    "Agent WhatsApp en ligne",
    `<h1>Agent WhatsApp de ${nom(nomEntreprise)} : en ligne</h1>
<p>Ce service répond aux messages WhatsApp des clients.</p>
<p><a href="/confidentialite">Politique de confidentialité</a> · <a href="/suppression-donnees">Supprimer mes données</a></p>`,
  );
}

export function pageConfidentialite(nomEntreprise) {
  const entreprise = nom(nomEntreprise);
  return gabarit(
    `Politique de confidentialité — ${nomEntreprise ?? "Agent WhatsApp"}`,
    `<h1>Politique de confidentialité</h1>
<p>Cette page explique comment ${entreprise} traite les informations que vous partagez lorsque vous nous écrivez sur WhatsApp.</p>
<h2>Qui traite vos données</h2>
<p>${entreprise} est responsable du traitement. Pour toute question, écrivez-nous sur le même numéro WhatsApp.</p>
<h2>Données collectées</h2>
<ul><li>Votre numéro WhatsApp ou l'identifiant fourni par WhatsApp, et le nom de votre profil.</li>
<li>Le contenu de vos messages et des photos que vous nous envoyez.</li>
<li>Les informations de pré-inscription que vous nous donnez : nom, filière souhaitée, niveau d'entrée, rythme, dernier diplôme, ville.</li></ul>
<h2>Pourquoi</h2>
<p>Pour répondre à vos questions sur nos formations, enregistrer votre pré-inscription et vous accompagner jusqu'à votre inscription. Un assistant automatique rédige une partie des réponses ; un conseiller de l'équipe peut reprendre la conversation à tout moment.</p>
<h2>Prestataires</h2>
<p>Vos messages transitent par Meta (WhatsApp). Les réponses automatiques sont rédigées avec Claude, d'Anthropic. Le service est hébergé chez Render. Nous ne vendons pas vos données.</p>
<h2>Durée de conservation</h2>
<p>Les conversations sont effacées automatiquement après 30 jours. Les informations de pré-inscription sont conservées le temps nécessaire au traitement de votre candidature et au respect de nos obligations légales.</p>
<h2>Vos droits</h2>
<p>Vous pouvez demander l'accès à vos données, leur correction ou leur suppression. Pour tout supprimer immédiatement, envoyez sur WhatsApp le message <code>SUPPRIMER MES DONNÉES</code> (voir <a href="/suppression-donnees">la page dédiée</a>).</p>
<p>Ces droits sont prévus par la loi malienne n° 2013-015 du 21 mai 2013 relative à la protection des données à caractère personnel. Vous pouvez aussi saisir l'Autorité de protection des données à caractère personnel (APDP).</p>`,
  );
}

export function pageSuppressionDonnees(nomEntreprise) {
  return gabarit(
    "Supprimer mes données",
    `<h1>Supprimer mes données</h1>
<p>Pour effacer vos données chez ${nom(nomEntreprise)}, envoyez ce message, sur WhatsApp, au numéro auquel vous nous avez écrit :</p>
<p><code>SUPPRIMER MES DONNÉES</code></p>
<p>La suppression est immédiate et un message vous la confirme : l'historique de vos conversations est effacé, et vos coordonnées sont retirées de vos pré-inscriptions.</p>
<p>Vous pouvez aussi demander la suppression à un conseiller de l'équipe sur le même numéro.</p>
<p><a href="/confidentialite">Politique de confidentialité</a></p>`,
  );
}
