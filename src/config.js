// Lecture et vérification de la configuration (variables d'environnement).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chiffresSeulement, FUSEAU_PAR_DEFAUT } from "./format.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const RACINE = path.resolve(ICI, "..");

export const VARIABLES_OBLIGATOIRES = [
  "ANTHROPIC_API_KEY",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "ADMIN_PASSWORD",
];

export const MODELE_PAR_DEFAUT = "claude-opus-5-5";
export const VERSION_GRAPH_PAR_DEFAUT = "v26.0";

export class ErreurConfiguration extends Error {
  constructor(manquantes) {
    super(
      `Variables d'environnement manquantes : ${manquantes.join(", ")}. ` +
        "Ajoutez-les dans Render (onglet Environment) ; le fichier .env.example explique chacune.",
    );
    this.name = "ErreurConfiguration";
    this.manquantes = manquantes;
  }
}

function texte(env, nom, parDefaut = "") {
  const valeur = env[nom];
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur.trim() : parDefaut;
}

function versionGraph(valeur) {
  const v = valeur.trim();
  return v.startsWith("v") ? v : `v${v}`;
}

function fuseauValide(fuseau) {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau });
    return fuseau;
  } catch {
    return FUSEAU_PAR_DEFAUT;
  }
}

/** Construit l'objet de configuration ; lève ErreurConfiguration s'il manque une variable obligatoire. */
export function lireConfig(env = process.env) {
  const manquantes = VARIABLES_OBLIGATOIRES.filter((nom) => texte(env, nom) === "");
  if (manquantes.length > 0) throw new ErreurConfiguration(manquantes);

  const port = texte(env, "PORT");
  return {
    anthropicApiKey: texte(env, "ANTHROPIC_API_KEY"),
    modele: texte(env, "CLAUDE_MODEL", MODELE_PAR_DEFAUT),
    whatsappToken: texte(env, "WHATSAPP_TOKEN"),
    phoneNumberId: texte(env, "WHATSAPP_PHONE_NUMBER_ID"),
    wabaId: texte(env, "WHATSAPP_BUSINESS_ACCOUNT_ID"),
    verifyToken: texte(env, "WHATSAPP_VERIFY_TOKEN"),
    appSecret: texte(env, "WHATSAPP_APP_SECRET"),
    adminPassword: texte(env, "ADMIN_PASSWORD"),
    graphVersion: versionGraph(texte(env, "GRAPH_API_VERSION", VERSION_GRAPH_PAR_DEFAUT)),
    proprietaire: chiffresSeulement(texte(env, "OWNER_WHATSAPP")),
    dataDir: path.resolve(RACINE, texte(env, "DATA_DIR", "data")),
    fuseau: fuseauValide(texte(env, "FUSEAU_HORAIRE", FUSEAU_PAR_DEFAUT)),
    urlPublique: texte(env, "RENDER_EXTERNAL_URL", texte(env, "PUBLIC_URL")).replace(/\/+$/, ""),
    port: port === "" ? 3000 : Number(port),
  };
}
