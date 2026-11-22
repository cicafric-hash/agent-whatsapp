// Cœur de l'agent : réception des messages WhatsApp, regroupement, appel à Claude, outils, alertes.
import { expliquerErreurClaude, genererReponse } from "./claude.js";
import {
  chiffresSeulement,
  dateLisible,
  estDemandeSuppression,
  formaterMontant,
  formaterNumero,
  formaterPourWhatsApp,
  FUSEAU_PAR_DEFAUT,
  masquerNumero,
} from "./format.js";
import { conseilPourCode, ErreurWhatsApp } from "./whatsapp.js";

const MINUTE = 60 * 1000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

export const MAX_MESSAGES_PAR_HEURE = 30;
export const MAX_MESSAGES_HISTORIQUE = 30;
export const DUREE_HISTORIQUE = 30 * JOUR;
const TYPES_IMAGE_ACCEPTES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export const MESSAGES = {
  mediaNonPrisEnCharge:
    "Merci pour votre message ! Je ne peux pas encore écouter les messages vocaux ni ouvrir les vidéos et les fichiers. Pouvez-vous m'écrire votre demande ?",
  limite:
    "Vous m'avez envoyé beaucoup de messages en peu de temps. Je vous répondrai un peu plus tard, merci de votre patience.",
  erreur:
    "Désolé, je rencontre un petit souci technique. Réessayez dans quelques minutes ; une personne de l'équipe peut aussi vous répondre.",
  refus:
    "Je ne peux pas répondre à cette demande. Je peux en revanche vous aider pour nos produits, nos prix ou une commande.",
  vide: "Merci pour votre message ! Pouvez-vous préciser votre demande ?",
  transfert: "Une personne de notre équipe va vous répondre ici très bientôt.",
  suppression:
    "C'est fait : vos messages et vos informations personnelles ont été supprimés de notre système. Vous pouvez nous écrire à nouveau à tout moment.",
};

/** Traduit un message reçu de WhatsApp en élément exploitable par l'agent. */
export function convertirMessage(message) {
  switch (message?.type) {
    case "text": {
      const texte = String(message.text?.body ?? "").trim();
      return texte ? { type: "texte", texte } : { type: "ignorer" };
    }
    case "interactive": {
      const i = message.interactive ?? {};
      const choix = i.button_reply?.title ?? i.list_reply?.title;
      if (choix) {
        const precision = i.list_reply?.description ? ` (${i.list_reply.description})` : "";
        return { type: "texte", texte: `${choix}${precision}` };
      }
      return { type: "texte", texte: "[Le client a répondu à un formulaire interactif]" };
    }
    case "button": {
      const texte = String(message.button?.text ?? message.button?.payload ?? "").trim();
      return texte ? { type: "texte", texte } : { type: "ignorer" };
    }
    case "image": {
      const legende = String(message.image?.caption ?? "").trim();
      return {
        type: "image",
        idMedia: message.image?.id,
        texte: legende ? `[Photo envoyée par le client] ${legende}` : "[Photo envoyée par le client]",
      };
    }
    case "location": {
      const l = message.location ?? {};
      const lieu = [l.name, l.address].filter(Boolean).join(", ");
      return {
        type: "texte",
        texte: `[Position partagée par le client${lieu ? ` : ${lieu}` : ""} (latitude ${l.latitude}, longitude ${l.longitude})]`,
      };
    }
    case "contacts": {
      const noms = (message.contacts ?? [])
        .map((c) => c?.name?.formatted_name)
        .filter(Boolean)
        .join(", ");
      return { type: "texte", texte: `[Le client a partagé un contact${noms ? ` : ${noms}` : ""}]` };
    }
    case "order": {
      const articles = (message.order?.product_items ?? [])
        .map((p) => `${p.quantity} × ${p.product_retailer_id} (${p.item_price} ${p.currency})`)
        .join(" ; ");
      const note = message.order?.text ? ` ${message.order.text}` : "";
      return { type: "texte", texte: `[Commande envoyée depuis le catalogue WhatsApp : ${articles || "détails absents"}]${note}` };
    }
    case "sticker":
      return { type: "texte", texte: "[Le client a envoyé un autocollant]" };
    case "request_welcome":
      return { type: "texte", texte: "[Le client vient d'ouvrir la discussion pour la première fois]" };
    case "audio":
      return {
        type: "nonPrisEnCharge",
        texte: message.audio?.voice
          ? "[Le client a envoyé un message vocal, que l'agent ne peut pas écouter]"
          : "[Le client a envoyé un fichier audio, que l'agent ne peut pas écouter]",
      };
    case "video":
      return { type: "nonPrisEnCharge", texte: "[Le client a envoyé une vidéo, que l'agent ne peut pas regarder]" };
    case "document": {
      const nom = message.document?.filename ? ` (${message.document.filename})` : "";
      return { type: "nonPrisEnCharge", texte: `[Le client a envoyé un document${nom}, que l'agent ne peut pas ouvrir]` };
    }
    case "reaction":
    case "system":
    case "ephemeral":
      return { type: "ignorer" };
    default:
      return { type: "nonPrisEnCharge", texte: "[Le client a envoyé un type de message que l'agent ne peut pas lire]" };
  }
}

/** Fusionne les tours consécutifs d'un même rôle et retire les réponses de l'agent placées avant le premier message du client. */
export function fusionnerTours(tours) {
  const resultat = [];
  for (const tour of tours) {
    const blocs = typeof tour.content === "string" ? [{ type: "text", text: tour.content }] : [...tour.content];
    const dernier = resultat.at(-1);
    if (dernier && dernier.role === tour.role) dernier.content.push(...blocs);
    else resultat.push({ role: tour.role, content: blocs });
  }
  while (resultat.length > 0 && resultat[0].role !== "user") resultat.shift();
  return resultat;
}

function nomClient(conv) {
  const numero = conv.telephone ? formaterNumero(conv.telephone) : "numéro masqué";
  return conv.nom ? `${conv.nom} (${numero})` : numero;
}

function destinataire(conv) {
  return { telephone: conv.telephone, userId: conv.userId };
}

function genererReference(maintenant) {
  const d = new Date(maintenant);
  const jour = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const hasard = Math.floor(1000 + Math.random() * 9000);
  return `CMD-${jour}-${hasard}`;
}

export class Agent {
  constructor({ config, stockage, whatsapp, claude, systeme, delaiRegroupement = 3000, horloge = () => Date.now() }) {
    this.config = config;
    this.stockage = stockage;
    this.whatsapp = whatsapp;
    this.claude = claude;
    this.systeme = systeme;
    this.delaiRegroupement = delaiRegroupement;
    this.horloge = horloge;
    this.fuseau = config.fuseau ?? FUSEAU_PAR_DEFAUT;
    this.lots = new Map(); // messages en attente de regroupement, par client
    this.files = new Map(); // traitement en cours, par client (un lot à la fois)
    this.taches = new Set(); // toutes les tâches de fond, pour l'arrêt propre et les tests
    this.limites = new Map(); // compteur anti-abus, par client
    this.dernierJournal = new Map(); // anti-répétition du journal
    this.numeroAgent = null; // numéro de l'agent, lu dans les webhooks
    this.derniereAlerteClaude = 0;
  }

  // ---------- Réception ----------

  /** Point d'entrée des webhooks : renvoie une promesse (le serveur répond 200 à Meta sans l'attendre). */
  traiterWebhook(donnees) {
    return this.#suivre(
      this.#traiterWebhook(donnees).catch((err) =>
        this.stockage.journaliser("erreur", "Erreur pendant le traitement d'un webhook", err?.stack ?? String(err)),
      ),
    );
  }

  async #traiterWebhook(donnees) {
    if (donnees?.object !== "whatsapp_business_account") return;
    for (const entree of donnees.entry ?? []) {
      for (const changement of entree.changes ?? []) {
        if (changement.field !== "messages") continue;
        const valeur = changement.value ?? {};
        const idNumero = valeur.metadata?.phone_number_id;
        if (idNumero && String(idNumero) !== String(this.config.phoneNumberId)) {
          this.#journaliserUneFois(
            `autre-numero-${idNumero}`,
            "avertissement",
            `Message reçu pour un autre numéro WhatsApp (identifiant ${idNumero}) : ignoré.`,
            "Si c'est votre nouveau numéro, mettez cet identifiant dans WHATSAPP_PHONE_NUMBER_ID sur Render.",
          );
          continue;
        }
        if (valeur.metadata?.display_phone_number) {
          this.numeroAgent = chiffresSeulement(valeur.metadata.display_phone_number);
        }
        for (const statut of valeur.statuses ?? []) this.#traiterStatut(statut);
        for (const message of valeur.messages ?? []) {
          try {
            await this.#recevoir(message, valeur.contacts ?? []);
          } catch (err) {
            this.stockage.journaliser("erreur", "Message reçu non traité", err?.stack ?? String(err));
          }
        }
      }
    }
  }

  #traiterStatut(statut) {
    if (statut?.status !== "failed") return;
    const e = statut.errors?.[0] ?? {};
    const raison = `code ${e.code ?? "?"} : ${e.title ?? e.message ?? "raison inconnue"}${e.error_data?.details ? ` (${e.error_data.details})` : ""}`;
    this.stockage.marquerEchecEnvoi(statut.id, raison);
    this.stockage.journaliser(
      "erreur",
      `Message non délivré à ${masquerNumero(chiffresSeulement(statut.recipient_id))} — ${raison}`,
      conseilPourCode(e.code),
    );
  }

  async #recevoir(message, contacts) {
    const id = message?.id;
    if (!id || this.stockage.dejaTraite(id)) return;
    this.stockage.marquerTraite(id);

    const element = convertirMessage(message);
    if (element.type === "ignorer") return;

    const telephone = message.from ? chiffresSeulement(message.from) : null;
    const contact =
      contacts.find(
        (c) =>
          (telephone && chiffresSeulement(c.wa_id) === telephone) ||
          (message.from_user_id && c.user_id === message.from_user_id),
      ) ?? (contacts.length === 1 ? contacts[0] : undefined);
    const userId = message.from_user_id ?? contact?.user_id ?? null;
    const cle = userId || telephone;
    if (!cle) {
      this.stockage.journaliser("avertissement", "Message reçu sans numéro ni identifiant d'expéditeur : ignoré.");
      return;
    }

    const conv = this.stockage.obtenirConversation(cle, { telephone, userId, nom: contact?.profile?.name ?? null });

    if (element.type === "texte" && estDemandeSuppression(element.texte)) {
      await this.#supprimerALaDemande(conv);
      return;
    }

    const recuLe = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(this.horloge());
    this.stockage.ajouterMessage(cle, { id, role: "client", texte: element.texte, at: recuLe.toISOString() });

    if (conv.pause) return; // une personne de l'équipe a la main : l'agent ne répond pas

    const limite = this.#verifierLimite(cle);
    if (limite === "silence") return;
    if (limite === "avertir") {
      await this.#envoyer(conv, MESSAGES.limite);
      return;
    }

    this.whatsapp.marquerLu(id).catch((err) => this.#erreurWhatsApp("Accusé de lecture non envoyé", err, "info"));
    this.#ajouterAuLot(cle, { id, element, recuLe });
  }

  #verifierLimite(cle) {
    const maintenant = this.horloge();
    const etat = this.limites.get(cle) ?? { horodatages: [], silenceJusqua: 0 };
    etat.horodatages = etat.horodatages.filter((t) => maintenant - t < HEURE);
    etat.horodatages.push(maintenant);
    this.limites.set(cle, etat);
    if (etat.horodatages.length <= MAX_MESSAGES_PAR_HEURE) return "ok";
    if (maintenant < etat.silenceJusqua) return "silence";
    etat.silenceJusqua = maintenant + HEURE;
    this.stockage.journaliser("avertissement", `Client trop insistant (${masquerNumero(cle)}) : pause d'une heure des réponses automatiques.`);
    return "avertir";
  }

  // ---------- Regroupement et file d'attente par client ----------

  #ajouterAuLot(cle, element) {
    let lot = this.lots.get(cle);
    if (!lot) {
      lot = { elements: [], minuteur: null };
      this.lots.set(cle, lot);
    }
    lot.elements.push(element);
    clearTimeout(lot.minuteur);
    lot.minuteur = setTimeout(() => this.#lancerLot(cle), this.delaiRegroupement);
  }

  #lancerLot(cle) {
    const lot = this.lots.get(cle);
    if (!lot) return;
    clearTimeout(lot.minuteur);
    this.lots.delete(cle);
    const precedent = this.files.get(cle) ?? Promise.resolve();
    const suivant = precedent
      .then(() => this.#traiterLot(cle, lot.elements))
      .catch((err) => this.stockage.journaliser("erreur", "Erreur pendant la préparation d'une réponse", err?.stack ?? String(err)))
      .finally(() => {
        if (this.files.get(cle) === suivant) this.files.delete(cle);
      });
    this.files.set(cle, suivant);
    this.#suivre(suivant);
  }

  async #traiterLot(cle, elements) {
    const conv = this.stockage.conversation(cle);
    if (!conv || conv.pause) return;

    if (elements.every((e) => e.element.type === "nonPrisEnCharge")) {
      await this.#envoyer(conv, MESSAGES.mediaNonPrisEnCharge);
      return;
    }

    this.whatsapp.marquerLu(elements.at(-1).id).catch(() => {}); // relance l'indicateur « en train d'écrire »

    const idsDuLot = new Set(elements.map((e) => e.id));
    const historique = this.#historique(conv.messages.filter((m) => !idsDuLot.has(m.id)));
    const tour = await this.#tourClient(elements);
    const messages = fusionnerTours([...historique, tour]);

    let resultat;
    try {
      resultat = await genererReponse({
        client: this.claude,
        modele: this.config.modele,
        systeme: this.systeme,
        messages,
        executerOutil: (nom, entree) => this.#executerOutil(conv, nom, entree),
      });
    } catch (err) {
      await this.#signalerErreurClaude(err);
      await this.#envoyer(conv, MESSAGES.erreur);
      return;
    }

    const apres = this.stockage.conversation(cle);
    if (!apres || (apres.pause && apres.pauseSource === "admin")) return; // l'équipe a repris la main entre-temps

    let texte = formaterPourWhatsApp(resultat.texte);
    if (resultat.statut === "refus") {
      this.stockage.journaliser("info", `Demande déclinée par Claude (${resultat.categorie ?? "catégorie inconnue"}) pour ${nomClient(conv)}.`);
      texte = MESSAGES.refus;
    }
    if (!texte) texte = apres.pause ? MESSAGES.transfert : MESSAGES.vide;
    await this.#envoyer(conv, texte);
  }

  /** Historique en texte seul (30 derniers messages de moins de 30 jours), daté pour Claude. */
  #historique(messages) {
    const limite = this.horloge() - DUREE_HISTORIQUE;
    return messages
      .filter((m) => !m.echec && Date.parse(m.at) >= limite)
      .slice(-MAX_MESSAGES_HISTORIQUE)
      .map((m) => {
        if (m.role === "client") return { role: "user", content: `[Reçu le ${dateLisible(m.at, this.fuseau)}] ${m.texte}` };
        if (m.role === "humain") return { role: "assistant", content: `[Réponse de l'équipe] ${m.texte}` };
        return { role: "assistant", content: m.texte };
      });
  }

  async #tourClient(elements) {
    const blocs = [];
    for (const { element, recuLe } of elements) {
      const entete = `[Reçu le ${dateLisible(recuLe, this.fuseau)}]`;
      if (element.type === "image" && element.idMedia) {
        try {
          const media = await this.whatsapp.telechargerMedia(element.idMedia);
          if (!TYPES_IMAGE_ACCEPTES.has(media.mimeType)) throw new Error(`format ${media.mimeType || "inconnu"} non pris en charge`);
          blocs.push({ type: "image", source: { type: "base64", media_type: media.mimeType, data: media.base64 } });
        } catch (err) {
          this.stockage.journaliser("avertissement", "Photo reçue mais impossible à ouvrir", err?.message ?? String(err));
          blocs.push({ type: "text", text: `${entete} [Le client a envoyé une photo qui n'a pas pu être ouverte]` });
          continue;
        }
      }
      blocs.push({ type: "text", text: `${entete} ${element.texte}` });
    }
    return { role: "user", content: blocs };
  }

  // ---------- Outils appelés par Claude ----------

  async #executerOutil(conv, nom, entree) {
    if (nom === "enregistrer_commande") return this.#enregistrerCommande(conv, entree ?? {});
    if (nom === "demander_un_humain") return this.#demanderUnHumain(conv, entree ?? {});
    return { texte: `Outil inconnu : ${nom}`, erreur: true };
  }

  async #enregistrerCommande(conv, e) {
    const articles = (Array.isArray(e.articles) ? e.articles : [])
      .map((a) => ({
        produit: String(a?.produit ?? "").trim(),
        quantite: Number(a?.quantite),
        prix_unitaire: Number(a?.prix_unitaire),
      }))
      .filter((a) => a.produit && Number.isFinite(a.quantite) && a.quantite > 0 && Number.isFinite(a.prix_unitaire));
    if (articles.length === 0) {
      return { texte: "Commande non enregistrée : aucun article valide. Redemande au client ce qu'il souhaite commander.", erreur: true };
    }
    const maintenant = this.horloge();
    const sousTotal = articles.reduce((somme, a) => somme + a.quantite * a.prix_unitaire, 0);
    const fraisLivraison = Number(e.frais_livraison) || 0;
    const total = Number(e.total) || sousTotal + fraisLivraison;
    const commande = {
      id: genererReference(maintenant),
      creeeLe: new Date(maintenant).toISOString(),
      client: conv.cle,
      telephoneWhatsApp: conv.telephone,
      nom_client: String(e.nom_client ?? "").trim() || conv.nom || "(non précisé)",
      articles,
      frais_livraison: fraisLivraison,
      total,
      sous_total_calcule: sousTotal,
      adresse_ou_quartier: String(e.adresse_ou_quartier ?? "").trim(),
      mode_paiement: String(e.mode_paiement ?? "").trim(),
      telephone: String(e.telephone ?? "").trim(),
      remarques: String(e.remarques ?? "").trim(),
    };
    const ecart = Math.abs(total - (sousTotal + fraisLivraison)) >= 1;
    this.stockage.ajouterCommande(commande);
    this.stockage.journaliser("info", `Nouvelle commande ${commande.id} (${formaterMontant(total)} FCFA) de ${nomClient(conv)}.`);

    const lignes = [
      `Nouvelle commande ${commande.id}`,
      `Client : ${commande.nom_client} — ${conv.telephone ? formaterNumero(conv.telephone) : "numéro masqué"}`,
      ...articles.map((a) => `- ${a.quantite} × ${a.produit} : ${formaterMontant(a.prix_unitaire)} FCFA`),
      `Livraison : ${formaterMontant(fraisLivraison)} FCFA`,
      `Total : ${formaterMontant(total)} FCFA${ecart ? ` (attention : articles + livraison = ${formaterMontant(sousTotal + fraisLivraison)} FCFA)` : ""}`,
      `Adresse : ${commande.adresse_ou_quartier || "non précisée"}`,
      `Paiement : ${commande.mode_paiement || "non précisé"}`,
      ...(commande.telephone ? [`Téléphone de livraison : ${commande.telephone}`] : []),
      ...(commande.remarques ? [`Remarques : ${commande.remarques}`] : []),
      ...(this.config.urlPublique ? [`Détails : ${this.config.urlPublique}/admin/commandes`] : []),
    ];
    await this.#alerter(lignes.join("\n"));

    const avertissement = ecart
      ? " Attention : le total ne correspond pas à la somme des articles et de la livraison ; dis au client que l'équipe confirmera le montant."
      : "";
    return { texte: `Commande enregistrée sous la référence ${commande.id}.${avertissement} Confirme-la maintenant au client en donnant cette référence.` };
  }

  async #demanderUnHumain(conv, e) {
    const motif = String(e.motif ?? "").trim() || "Le client souhaite parler à une personne.";
    this.stockage.definirPause(conv.cle, true, motif, "agent");
    this.stockage.journaliser("info", `Conversation confiée à l'équipe : ${nomClient(conv)}.`, motif);
    const lien = this.config.urlPublique
      ? `\nRépondre : ${this.config.urlPublique}/admin/conversation/${encodeURIComponent(conv.cle)}`
      : "\nRépondez depuis la page /admin de l'agent.";
    await this.#alerter(`Un client demande une personne de l'équipe.\nClient : ${nomClient(conv)}\nMotif : ${motif}${lien}`);
    return {
      texte:
        "La conversation est confiée à l'équipe : tu ne répondras plus à ce client tant qu'une personne n'aura pas relancé l'agent. " +
        "Dis-lui maintenant, en une phrase, qu'une personne de l'équipe va lui répondre ici.",
    };
  }

  // ---------- Envois, alertes, erreurs ----------

  async #envoyer(conv, texte, role = "agent") {
    try {
      const resultats = await this.whatsapp.envoyerTexte(destinataire(conv), texte);
      const ids = resultats.flatMap((r) => (r?.messages ?? []).map((m) => m.id)).filter(Boolean);
      this.stockage.ajouterMessage(conv.cle, { role, texte, idsWhatsApp: ids });
      return true;
    } catch (err) {
      const raison = err instanceof ErreurWhatsApp ? err.resume : err?.message ?? String(err);
      this.#erreurWhatsApp(`Réponse non envoyée à ${nomClient(conv)}`, err);
      this.stockage.ajouterMessage(conv.cle, { role, texte, echec: raison });
      return false;
    }
  }

  async #alerter(texte) {
    const proprietaire = this.config.proprietaire;
    if (!proprietaire) return false;
    if (this.numeroAgent && proprietaire === this.numeroAgent) {
      this.#journaliserUneFois(
        "alerte-meme-numero",
        "avertissement",
        "OWNER_WHATSAPP est le numéro de l'agent lui-même : alerte non envoyée.",
        "Mettez dans OWNER_WHATSAPP un autre numéro (votre seconde puce, par exemple), ou suivez les commandes dans /admin.",
      );
      return false;
    }
    try {
      await this.whatsapp.envoyerTexte({ telephone: proprietaire }, `[ALERTE PROPRIÉTAIRE]\n${texte}`);
      return true;
    } catch (err) {
      this.#erreurWhatsApp("Alerte non envoyée au propriétaire", err);
      return false;
    }
  }

  async #signalerErreurClaude(err) {
    const explication = expliquerErreurClaude(err);
    this.stockage.journaliser("erreur", "Réponse impossible : l'appel à Claude a échoué", explication);
    const maintenant = this.horloge();
    if (maintenant - this.derniereAlerteClaude < HEURE) return;
    this.derniereAlerteClaude = maintenant;
    await this.#alerter(`L'agent n'arrive pas à obtenir de réponse de Claude.\n${explication}`);
  }

  #erreurWhatsApp(contexte, err, niveau = "erreur") {
    if (err instanceof ErreurWhatsApp) {
      this.stockage.journaliser(niveau, `${contexte} — ${err.resume}`, conseilPourCode(err.code));
    } else {
      this.stockage.journaliser(niveau, `${contexte} — ${err?.message ?? err}`);
    }
  }

  #journaliserUneFois(cle, niveau, message, details, delai = 10 * MINUTE) {
    const maintenant = this.horloge();
    if (maintenant - (this.dernierJournal.get(cle) ?? 0) < delai) return;
    this.dernierJournal.set(cle, maintenant);
    this.stockage.journaliser(niveau, message, details);
  }

  async #supprimerALaDemande(conv) {
    const adresse = destinataire(conv);
    this.#oublier(conv.cle);
    this.stockage.supprimerClient(conv.cle);
    this.stockage.journaliser("info", "Données d'un client supprimées à sa demande.");
    try {
      await this.whatsapp.envoyerTexte(adresse, MESSAGES.suppression);
    } catch (err) {
      this.#erreurWhatsApp("Confirmation de suppression non envoyée", err);
    }
  }

  #oublier(cle) {
    const lot = this.lots.get(cle);
    if (lot) clearTimeout(lot.minuteur);
    this.lots.delete(cle);
    this.limites.delete(cle);
  }

  #suivre(promesse) {
    this.taches.add(promesse);
    promesse.finally(() => this.taches.delete(promesse)).catch(() => {});
    return promesse;
  }

  // ---------- Actions de la page /admin ----------

  /** Envoie une réponse écrite par l'équipe ; l'agent se met en pause pour ce client. */
  async repondreManuellement(cle, texte) {
    const conv = this.stockage.conversation(cle);
    if (!conv) throw new Error("Conversation introuvable.");
    const propre = String(texte ?? "").trim();
    if (!propre) throw new Error("Le message est vide.");
    this.#oublier(cle);
    this.stockage.definirPause(cle, true, "Réponse manuelle depuis l'administration", "admin");
    const resultats = await this.whatsapp.envoyerTexte(destinataire(conv), propre);
    const ids = resultats.flatMap((r) => (r?.messages ?? []).map((m) => m.id)).filter(Boolean);
    this.stockage.ajouterMessage(cle, { role: "humain", texte: propre, idsWhatsApp: ids });
  }

  mettreEnPause(cle) {
    this.#oublier(cle);
    return this.stockage.definirPause(cle, true, "Mise en pause depuis l'administration", "admin");
  }

  reprendre(cle) {
    return this.stockage.definirPause(cle, false);
  }

  supprimerClient(cle) {
    this.#oublier(cle);
    this.stockage.supprimerClient(cle);
    this.stockage.journaliser("info", "Données d'un client supprimées depuis l'administration.");
  }

  async envoyerMessageTest() {
    if (!this.config.proprietaire) throw new Error("OWNER_WHATSAPP n'est pas défini sur Render.");
    if (this.numeroAgent && this.config.proprietaire === this.numeroAgent) {
      throw new Error("OWNER_WHATSAPP est le numéro de l'agent lui-même : choisissez un autre numéro.");
    }
    return this.whatsapp.envoyerTexte(
      { telephone: this.config.proprietaire },
      "[TEST] Message de test de votre agent WhatsApp. Si vous le lisez, les alertes fonctionnent.",
    );
  }

  /** Vrai si le client a écrit il y a moins de 24 heures (fenêtre où WhatsApp autorise les réponses libres). */
  fenetreOuverte(conv) {
    if (!conv?.dernierMessageClientAt) return false;
    return this.horloge() - Date.parse(conv.dernierMessageClientAt) < 24 * HEURE;
  }

  // ---------- Arrêt et tests ----------

  /** Attend la fin de tous les traitements en cours (utile à l'arrêt du serveur et dans les tests). */
  async attendreInactivite() {
    for (;;) {
      if (this.taches.size > 0) {
        await Promise.allSettled([...this.taches]);
        continue;
      }
      if (this.lots.size > 0) {
        await new Promise((resoudre) => setTimeout(resoudre, 5));
        continue;
      }
      return;
    }
  }

  /** À l'arrêt : traite tout de suite les messages en attente de regroupement, puis attend (au plus `delaiMs`). */
  async arreter(delaiMs = 20000) {
    for (const cle of [...this.lots.keys()]) this.#lancerLot(cle);
    let minuteur;
    await Promise.race([
      this.attendreInactivite(),
      new Promise((resoudre) => {
        minuteur = setTimeout(resoudre, delaiMs);
      }),
    ]);
    clearTimeout(minuteur);
  }
}
