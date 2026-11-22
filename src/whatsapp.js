// Client de l'API WhatsApp Cloud de Meta (Graph API), avec fetch.
import { decouper } from "./format.js";

const BASE_GRAPH = "https://graph.facebook.com";
export const TAILLE_MAX_IMAGE = 5 * 1024 * 1024;

/** Erreur renvoyée par Meta, avec son code (par exemple 131047 ou 190). */
export class ErreurWhatsApp extends Error {
  constructor({ status = null, code = null, sousCode = null, message, details = null, fbtraceId = null }) {
    super(message || "Erreur inconnue de l'API WhatsApp");
    this.name = "ErreurWhatsApp";
    this.status = status;
    this.code = code;
    this.sousCode = sousCode;
    this.details = details;
    this.fbtraceId = fbtraceId;
  }

  get resume() {
    const code = this.code ? ` ${this.code}` : "";
    const details = this.details ? ` (${this.details})` : "";
    return `Erreur WhatsApp${code} : ${this.message}${details}`;
  }
}

/** Conseil en français pour les codes d'erreur Meta les plus fréquents. */
export function conseilPourCode(code) {
  switch (Number(code)) {
    case 190:
      return "Token expiré ou invalide : mettez le token permanent de l'utilisateur système dans WHATSAPP_TOKEN.";
    case 131030:
      return "Ce numéro n'est pas dans la liste des destinataires de test : ajoutez-le dans le champ « To » de l'API Setup.";
    case 131047:
      return "Plus de 24 h depuis le dernier message de cette personne : WhatsApp n'autorise qu'un modèle de message.";
    case 131042:
      return "Problème de paiement chez Meta : vérifiez le moyen de paiement dans WhatsApp Manager.";
    case 133010:
      return "Numéro non enregistré : utilisez le bouton « Enregistrer le numéro » de la page Outils.";
    case 133016:
      return "Trop d'essais d'enregistrement : attendez 72 heures.";
    default:
      return null;
  }
}

export class WhatsApp {
  constructor({ token, phoneNumberId, wabaId = "", version = "v26.0", fetchImpl = globalThis.fetch, delaiMs = 20000 }) {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.wabaId = wabaId;
    this.version = version;
    this.fetch = fetchImpl;
    this.delaiMs = delaiMs;
  }

  url(chemin) {
    return `${BASE_GRAPH}/${this.version}/${chemin}`;
  }

  async appel(methode, chemin, corps) {
    const reponse = await this.fetch(this.url(chemin), {
      method: methode,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(corps ? { "Content-Type": "application/json" } : {}),
      },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(this.delaiMs),
    });
    const brut = await reponse.text();
    let donnees = null;
    try {
      donnees = brut ? JSON.parse(brut) : null;
    } catch {
      donnees = { brut };
    }
    if (!reponse.ok || donnees?.error) {
      const e = donnees?.error ?? {};
      throw new ErreurWhatsApp({
        status: reponse.status,
        code: e.code ?? null,
        sousCode: e.error_subcode ?? null,
        message: e.message ?? `Réponse HTTP ${reponse.status}`,
        details: e.error_data?.details ?? null,
        fbtraceId: e.fbtrace_id ?? null,
      });
    }
    return donnees;
  }

  /**
   * Adresse d'un client : son numéro de téléphone s'il est connu (champ « to »),
   * sinon son identifiant WhatsApp propre à l'entreprise (champ « recipient »).
   */
  static adresse({ telephone, userId }) {
    if (telephone) return { recipient_type: "individual", to: telephone };
    if (userId) return { recipient: userId };
    throw new Error("Impossible d'écrire à ce client : ni numéro ni identifiant WhatsApp connu.");
  }

  /** Envoie un texte (découpé en plusieurs messages s'il dépasse 4 096 caractères). */
  async envoyerTexte(destinataire, texte) {
    const adresse = WhatsApp.adresse(destinataire);
    const resultats = [];
    for (const morceau of decouper(texte, 4096)) {
      resultats.push(
        await this.appel("POST", `${this.phoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          ...adresse,
          type: "text",
          text: { preview_url: false, body: morceau },
        }),
      );
    }
    return resultats;
  }

  /** Marque un message comme lu et affiche « en train d'écrire… » (jusqu'à la réponse ou 25 secondes). */
  marquerLu(idMessage, avecIndicateur = true) {
    return this.appel("POST", `${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: idMessage,
      ...(avecIndicateur ? { typing_indicator: { type: "text" } } : {}),
    });
  }

  infosNumero() {
    return this.appel("GET", this.phoneNumberId);
  }

  enregistrerNumero(pin) {
    return this.appel("POST", `${this.phoneNumberId}/register`, { messaging_product: "whatsapp", pin });
  }

  abonnerApplication() {
    if (!this.wabaId) {
      throw new Error("WHATSAPP_BUSINESS_ACCOUNT_ID n'est pas défini dans Render : ajoutez l'identifiant du compte WhatsApp Business.");
    }
    return this.appel("POST", `${this.wabaId}/subscribed_apps`);
  }

  /** Télécharge un média reçu (photo) et le renvoie en base64. */
  async telechargerMedia(idMedia, tailleMax = TAILLE_MAX_IMAGE) {
    const infos = await this.appel("GET", idMedia);
    if (Number(infos?.file_size) > tailleMax) throw new Error("image trop lourde (plus de 5 Mo)");
    if (!infos?.url) throw new Error("adresse du média absente de la réponse de Meta");
    const reponse = await this.fetch(infos.url, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(this.delaiMs),
    });
    if (!reponse.ok) {
      throw new ErreurWhatsApp({ status: reponse.status, message: `téléchargement du média impossible (HTTP ${reponse.status})` });
    }
    const octets = Buffer.from(await reponse.arrayBuffer());
    if (octets.length > tailleMax) throw new Error("image trop lourde (plus de 5 Mo)");
    const type = String(infos.mime_type || reponse.headers.get("content-type") || "").split(";")[0].trim();
    return { mimeType: type, base64: octets.toString("base64") };
  }
}
