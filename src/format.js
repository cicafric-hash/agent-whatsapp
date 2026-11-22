// Petits outils de mise en forme, partagés par tout le projet.

export const FUSEAU_PAR_DEFAUT = "Africa/Bamako";

const ENTITES_HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Protège un texte avant de l'insérer dans une page HTML. */
export function echapperHtml(valeur) {
  return String(valeur ?? "").replace(/[&<>"']/g, (c) => ENTITES_HTML[c]);
}

/** Garde uniquement les chiffres d'un numéro (« +223 75 75 86 70 » ou « 0022375758670 » donnent « 22375758670 »). */
export function chiffresSeulement(valeur) {
  let chiffres = String(valeur ?? "").replace(/\D/g, "");
  if (chiffres.startsWith("00")) chiffres = chiffres.slice(2);
  return chiffres;
}

/** Affiche un numéro international de façon lisible (format malien pour l'indicatif 223). */
export function formaterNumero(telephone) {
  if (!telephone) return "";
  if (telephone.startsWith("223") && telephone.length === 11) {
    const n = telephone.slice(3);
    return `+223 ${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)}`;
  }
  return `+${telephone}`;
}

/** Masque le milieu d'un numéro pour les journaux techniques. */
export function masquerNumero(telephone) {
  if (!telephone) return "inconnu";
  if (telephone.length <= 6) return "***";
  return `${telephone.slice(0, 5)}***${telephone.slice(-2)}`;
}

/** 52000 devient « 52 000 ». */
export function formaterMontant(valeur) {
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre)) return "?";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
    .format(nombre)
    .replace(/[  ]/g, " ");
}

/** Date et heure locales (par défaut à Bamako) : { date: "23/11/2026", heure: "14:05" }. */
export function dateHeure(valeur, fuseau = FUSEAU_PAR_DEFAUT) {
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: fuseau,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const partie = (type) => parties.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${partie("day")}/${partie("month")}/${partie("year")}`,
    heure: `${partie("hour")}:${partie("minute")}`,
  };
}

/** « 23/11/2026 à 14:05 ». */
export function dateLisible(valeur, fuseau = FUSEAU_PAR_DEFAUT) {
  const { date, heure } = dateHeure(valeur, fuseau);
  return `${date} à ${heure}`;
}

const LIGNE_SEPARATION_TABLEAU = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const LIGNE_TABLEAU = /^\s*\|.*\|\s*$/;

/**
 * Adapte un texte au format de WhatsApp : *gras*, _italique_, listes à tirets.
 * Supprime les tableaux, titres et liens au format Markdown que WhatsApp n'affiche pas.
 */
export function formaterPourWhatsApp(texte) {
  let t = String(texte ?? "").replace(/\r\n/g, "\n");
  t = t
    .split("\n")
    .filter((ligne) => !LIGNE_SEPARATION_TABLEAU.test(ligne))
    .map((ligne) => {
      if (!LIGNE_TABLEAU.test(ligne)) return ligne;
      return ligne
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cellule) => cellule.trim())
        .filter(Boolean)
        .join(" — ");
    })
    .join("\n");
  t = t.replace(/\*\*(.+?)\*\*/gs, "*$1*");
  t = t.replace(/__(.+?)__/gs, "_$1_");
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  t = t.replace(/^(\s*)[*+]\s+/gm, "$1- ");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 : $2");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Découpe un texte trop long en morceaux de `max` caractères au plus, si possible entre deux paragraphes. */
export function decouper(texte, max = 4096) {
  const morceaux = [];
  let reste = String(texte ?? "").trim();
  while (reste.length > max) {
    let coupe = reste.lastIndexOf("\n\n", max);
    if (coupe < max * 0.5) coupe = reste.lastIndexOf("\n", max);
    if (coupe < max * 0.5) coupe = reste.lastIndexOf(" ", max);
    if (coupe <= 0) {
      coupe = max;
      const code = reste.charCodeAt(coupe - 1);
      if (code >= 0xd800 && code <= 0xdbff) coupe -= 1; // ne pas couper un émoji en deux
    }
    const morceau = reste.slice(0, coupe).trim();
    if (morceau) morceaux.push(morceau);
    reste = reste.slice(coupe).trim();
  }
  if (reste) morceaux.push(reste);
  return morceaux;
}

/** Vrai si le client a écrit exactement « SUPPRIMER MES DONNÉES » (majuscules, accents et ponctuation ignorés). */
export function estDemandeSuppression(texte) {
  const normalise = String(texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalise === "SUPPRIMER MES DONNEES";
}

/** Raccourcit un texte pour un aperçu. */
export function apercu(texte, longueur = 80) {
  const t = String(texte ?? "").replace(/\s+/g, " ").trim();
  return t.length > longueur ? `${t.slice(0, longueur - 1)}…` : t;
}
