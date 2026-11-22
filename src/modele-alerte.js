// Modèle de message (template WhatsApp) utilisé pour les alertes quand la fenêtre de 24 heures est fermée.
// Un modèle doit être créé puis approuvé par Meta avant de pouvoir être envoyé (bouton dans /admin > Outils).

export const MODELE_ALERTE_PAR_DEFAUT = "alerte_agent";
export const LANGUE_MODELE_ALERTE_PAR_DEFAUT = "fr";

/** Texte du modèle : il commence et finit par du texte fixe, avec deux variables ({{1}} l'objet, {{2}} les détails). */
export const TEXTE_MODELE_ALERTE =
  "Bonjour, votre agent WhatsApp vous signale : {{1}}. Détails : {{2}}. Consultez la page d'administration de l'agent pour répondre.";

export const LONGUEUR_MAX_OBJET = 150;
export const LONGUEUR_MAX_DETAILS = 600;

/** Définition envoyée à Meta pour créer le modèle (catégorie Utilité). */
export function definitionModeleAlerte(nom, langue) {
  return {
    name: nom,
    language: langue,
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: TEXTE_MODELE_ALERTE,
        example: {
          body_text: [
            [
              "nouvelle pré-inscription PRE-20261122-1234",
              "Prospect : Awa Traoré · Filière : Finance & Comptabilité · Niveau d'entrée : Licence 1 · Rythme : Soir",
            ],
          ],
        },
      },
    ],
  };
}

/**
 * Prépare le texte d'une variable de modèle : WhatsApp refuse les retours à la ligne, les tabulations
 * et plus de 4 espaces à la suite. La ponctuation finale est retirée (le modèle ajoute la sienne).
 */
export function parametreModele(texte, longueurMax) {
  let t = String(texte ?? "")
    .replace(/[\r\n\t]+/g, " · ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[\s.·:;,]+$/u, "");
  if (t.length > longueurMax) t = `${t.slice(0, longueurMax - 1).trimEnd()}…`;
  return t || "-";
}

/** « Nouvelle pré-inscription » devient « nouvelle pré-inscription », pour s'insérer dans la phrase du modèle. */
export function debutEnMinuscule(texte) {
  const t = String(texte ?? "");
  if (t.length > 1 && t[1] === t[1].toUpperCase() && t[1] !== t[1].toLowerCase()) return t; // sigle : « EUTG… »
  return t.charAt(0).toLocaleLowerCase("fr") + t.slice(1);
}

/** Variables {{1}} et {{2}} d'une alerte. */
export function parametresAlerte({ titre, lignes = [] }) {
  const details = lignes
    .map((ligne) => String(ligne ?? "").trim().replace(/[\s.;,:]+$/u, ""))
    .filter(Boolean)
    .join(" · ");
  return [
    parametreModele(debutEnMinuscule(titre), LONGUEUR_MAX_OBJET),
    parametreModele(details || "aucun détail supplémentaire", LONGUEUR_MAX_DETAILS),
  ];
}

const STATUTS = {
  APPROVED: "approuvé : les alertes peuvent partir à tout moment",
  PENDING: "en cours d'examen par Meta (en général quelques minutes, parfois jusqu'à 48 heures)",
  IN_APPEAL: "en appel auprès de Meta",
  REJECTED: "refusé par Meta",
  PAUSED: "mis en pause par Meta",
  DISABLED: "désactivé par Meta",
  PENDING_DELETION: "en cours de suppression",
};

/** Résume en français la réponse de Meta à « Vérifier le statut du modèle ». */
export function resumerStatutModele(nom, reponse) {
  const modeles = Array.isArray(reponse?.data) ? reponse.data.filter((m) => m?.name === nom) : [];
  if (modeles.length === 0) {
    return `Aucun modèle « ${nom} » sur ce compte WhatsApp Business : cliquez sur « Créer le modèle d'alerte ».`;
  }
  return modeles
    .map((m) => {
      const statut = String(m.status ?? "").toUpperCase();
      const explication = STATUTS[statut] ?? "statut inconnu";
      const categorie = m.category ? `, catégorie ${m.category}` : "";
      return `Modèle « ${m.name} » (${m.language ?? "?"}${categorie}) : ${statut || "?"} — ${explication}.`;
    })
    .join(" ");
}
