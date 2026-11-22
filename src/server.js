// Démarrage du serveur : lit la configuration, prépare l'agent, écoute sur le port fourni par Render.
import { Agent } from "./agent.js";
import { creerApp } from "./app.js";
import { creerClientClaude } from "./claude.js";
import { ErreurConfiguration, lireConfig } from "./config.js";
import { chargerConnaissances } from "./connaissances.js";
import { masquerNumero } from "./format.js";
import { Stockage } from "./stockage.js";
import { WhatsApp } from "./whatsapp.js";

const HEURE = 60 * 60 * 1000;

let config;
try {
  config = lireConfig();
} catch (err) {
  if (err instanceof ErreurConfiguration) {
    console.error(`\nDémarrage impossible. ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const connaissances = chargerConnaissances();
const stockage = new Stockage(config.dataDir).charger();
stockage.nettoyer();
for (const avertissement of connaissances.avertissements) stockage.journaliser("avertissement", avertissement);
if (config.adminPassword.length < 12) {
  stockage.journaliser("avertissement", "ADMIN_PASSWORD est court : choisissez un mot de passe d'au moins 16 caractères.");
}

const whatsapp = new WhatsApp({
  token: config.whatsappToken,
  phoneNumberId: config.phoneNumberId,
  wabaId: config.wabaId,
  version: config.graphVersion,
});
const agent = new Agent({
  config,
  stockage,
  whatsapp,
  claude: creerClientClaude(config.anthropicApiKey),
  systeme: connaissances.systeme,
});
const app = creerApp({ config, stockage, agent, whatsapp, connaissances });

const serveur = app.listen(config.port, () => {
  const port = serveur.address().port;
  console.log(`Agent WhatsApp démarré sur le port ${port}`);
  console.log(
    `Modèle : ${config.modele} · API Graph ${config.graphVersion} · numéro ${config.phoneNumberId} · ` +
      `alertes : ${config.proprietaire ? masquerNumero(config.proprietaire) : "désactivées"} · données : ${config.dataDir}`,
  );
});

const nettoyage = setInterval(() => {
  try {
    stockage.nettoyer();
  } catch (err) {
    stockage.journaliser("erreur", "Nettoyage des données impossible", err.message);
  }
}, HEURE);
nettoyage.unref();

let enArret = false;
async function arreter(signal) {
  if (enArret) return;
  enArret = true;
  console.log(`${signal} reçu : fin des traitements en cours, puis arrêt.`);
  serveur.close();
  await agent.arreter(20000);
  process.exit(0);
}
process.on("SIGTERM", () => arreter("SIGTERM"));
process.on("SIGINT", () => arreter("SIGINT"));
