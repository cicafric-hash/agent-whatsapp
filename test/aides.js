// Outils communs aux tests : faux WhatsApp, faux Claude, configuration et webhooks d'exemple.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Agent } from "../src/agent.js";
import { creerApp } from "../src/app.js";
import { Stockage } from "../src/stockage.js";

export const NUMERO_CLIENT = "22375758670";
export const NUMERO_PROPRIETAIRE = "22300000001";

export function configTest(surcharges = {}) {
  return {
    anthropicApiKey: "sk-ant-test",
    modele: "claude-opus-5-5",
    whatsappToken: "EAA-test",
    phoneNumberId: "111111111111111",
    wabaId: "222222222222222",
    verifyToken: "jeton-de-verification",
    appSecret: "secret-de-l-application",
    adminPassword: "mot-de-passe-admin-tres-long",
    graphVersion: "v26.0",
    proprietaire: NUMERO_PROPRIETAIRE,
    dataDir: "",
    fuseau: "Africa/Bamako",
    urlPublique: "",
    port: 0,
    ...surcharges,
  };
}

export class FauxWhatsApp {
  constructor() {
    this.envois = [];
    this.lus = [];
    this.medias = new Map();
    this.echecEnvoi = null;
    this.compteur = 0;
    this.pins = [];
    this.abonnements = 0;
  }

  async envoyerTexte(destinataire, texte) {
    if (this.echecEnvoi) throw this.echecEnvoi;
    this.envois.push({ destinataire, texte });
    this.compteur += 1;
    return [{ messaging_product: "whatsapp", messages: [{ id: `wamid.envoi.${this.compteur}` }] }];
  }

  async marquerLu(id) {
    this.lus.push(id);
    return { success: true };
  }

  async infosNumero() {
    return { display_phone_number: "+1 555 0100", verified_name: "Boutique Test", quality_rating: "GREEN" };
  }

  async enregistrerNumero(pin) {
    this.pins.push(pin);
    return { success: true };
  }

  async abonnerApplication() {
    this.abonnements += 1;
    return { success: true };
  }

  async telechargerMedia(id) {
    const media = this.medias.get(id);
    if (!media) throw new Error("média inconnu");
    return media;
  }
}

/** Faux client Claude : renvoie les réponses prévues dans l'ordre et garde une copie de chaque requête. */
export function fauxClaude(reponses) {
  const appels = [];
  const client = {
    beta: {
      messages: {
        create: async (parametres) => {
          appels.push(structuredClone(parametres));
          const reponse = reponses.shift();
          if (!reponse) throw new Error("Le test n'a pas prévu d'autre réponse de Claude.");
          if (reponse instanceof Error) throw reponse;
          return reponse;
        },
      },
    },
  };
  return { client, appels };
}

export function reponseTexte(texte, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: stopReason,
    content: texte ? [{ type: "thinking", thinking: "", signature: "sig-texte" }, { type: "text", text: texte }] : [],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

export function reponseOutil(nom, entree, id = "toolu_test_1") {
  return {
    id: "msg_outil",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "tool_use",
    content: [
      { type: "thinking", thinking: "", signature: "sig-outil" },
      { type: "tool_use", id, name: nom, input: entree },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

export function reponseRefus() {
  return {
    id: "msg_refus",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "refusal",
    stop_details: { type: "refusal", category: null, explanation: null },
    content: [],
    usage: { input_tokens: 10, output_tokens: 0 },
  };
}

/** Prépare un agent complet avec un dossier de données temporaire. */
export function environnement({ reponses = [], config: surcharges = {}, delaiRegroupement = 10 } = {}) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "agent-whatsapp-test-"));
  const config = configTest({ dataDir: dossier, ...surcharges });
  const stockage = new Stockage(dossier, { silencieux: true }).charger();
  const whatsapp = new FauxWhatsApp();
  const { client, appels } = fauxClaude([...reponses]);
  const agent = new Agent({ config, stockage, whatsapp, claude: client, systeme: "SYSTEME DE TEST", delaiRegroupement });
  const nettoyer = () => fs.rmSync(dossier, { recursive: true, force: true });
  return { config, stockage, whatsapp, agent, appels, dossier, nettoyer };
}

/** Démarre l'application web sur un port libre. */
export async function demarrerServeur(env, connaissances = {}) {
  const app = creerApp({
    config: env.config,
    stockage: env.stockage,
    agent: env.agent,
    whatsapp: env.whatsapp,
    connaissances: { nomEntreprise: "Boutique Test", avertissements: [], systeme: "SYSTEME DE TEST", ...connaissances },
  });
  const serveur = await new Promise((resoudre) => {
    const s = app.listen(0, "127.0.0.1", () => resoudre(s));
  });
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const fermer = () =>
    new Promise((resoudre) => {
      serveur.closeAllConnections();
      serveur.close(() => resoudre());
    });
  return { base, fermer };
}

export function signer(corps, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(corps).digest("hex")}`;
}

export function posterWebhook(base, donnees, secret) {
  const corps = JSON.stringify(donnees);
  return fetch(`${base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signer(corps, secret) },
    body: corps,
  });
}

export function webhook({ messages = [], contacts, statuses, phoneNumberId = "111111111111111", numeroAffiche = "15550100" } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "222222222222222",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: numeroAffiche, phone_number_id: phoneNumberId },
              contacts: contacts ?? [{ profile: { name: "Awa" }, wa_id: NUMERO_CLIENT }],
              messages,
              ...(statuses ? { statuses } : {}),
            },
          },
        ],
      },
    ],
  };
}

let numeroMessage = 0;
export function messageTexte(texte, { de = NUMERO_CLIENT, userId = null, id = null, horodatage = Math.floor(Date.now() / 1000) } = {}) {
  numeroMessage += 1;
  return {
    ...(de ? { from: de } : {}),
    ...(userId ? { from_user_id: userId } : {}),
    id: id ?? `wamid.test.${numeroMessage}`,
    timestamp: String(horodatage),
    type: "text",
    text: { body: texte },
  };
}

export function autorisation(motDePasse, utilisateur = "admin") {
  return `Basic ${Buffer.from(`${utilisateur}:${motDePasse}`).toString("base64")}`;
}
