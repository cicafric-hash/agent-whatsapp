// Enregistrement des conversations, commandes et événements dans des fichiers JSON (dossier DATA_DIR).
// Chaque écriture passe par un fichier temporaire puis un renommage : un fichier n'est jamais à moitié écrit.
import fs from "node:fs";
import path from "node:path";

const FICHIERS = {
  conversations: () => ({}),
  commandes: () => [],
  traites: () => ({}),
  journal: () => [],
};

const HEURE = 60 * 60 * 1000;
const JOUR = 24 * HEURE;
export const DUREE_CONSERVATION_CONVERSATIONS = 30 * JOUR;
export const DUREE_DEDOUBLONNAGE = 48 * HEURE;
const TAILLE_MAX_JOURNAL = 300;

export class Stockage {
  constructor(dossier, { horloge = () => Date.now(), silencieux = false } = {}) {
    this.dossier = dossier;
    this.horloge = horloge;
    this.silencieux = silencieux;
    this.donnees = Object.fromEntries(Object.entries(FICHIERS).map(([nom, vide]) => [nom, vide()]));
  }

  charger() {
    fs.mkdirSync(this.dossier, { recursive: true });
    for (const [nom, vide] of Object.entries(FICHIERS)) {
      const fichier = this.chemin(nom);
      if (!fs.existsSync(fichier)) continue;
      try {
        const contenu = JSON.parse(fs.readFileSync(fichier, "utf8"));
        const attendu = vide();
        const formeCorrecte = Array.isArray(attendu)
          ? Array.isArray(contenu)
          : contenu !== null && typeof contenu === "object" && !Array.isArray(contenu);
        if (!formeCorrecte) throw new Error("contenu inattendu");
        this.donnees[nom] = contenu;
      } catch (err) {
        const copie = `${fichier}.illisible-${this.horloge()}`;
        fs.renameSync(fichier, copie);
        this.journaliser("erreur", `Fichier ${nom}.json illisible : mis de côté sous ${path.basename(copie)}`, err.message);
      }
    }
    return this;
  }

  chemin(nom) {
    return path.join(this.dossier, `${nom}.json`);
  }

  sauver(nom) {
    const fichier = this.chemin(nom);
    const temporaire = `${fichier}.tmp`;
    fs.writeFileSync(temporaire, JSON.stringify(this.donnees[nom]));
    fs.renameSync(temporaire, fichier);
  }

  maintenantIso() {
    return new Date(this.horloge()).toISOString();
  }

  // ---------- Conversations ----------

  conversation(cle) {
    return this.donnees.conversations[cle] ?? null;
  }

  /** Renvoie la conversation d'un client, en la créant si besoin, et met à jour son numéro, son identifiant et son nom. */
  obtenirConversation(cle, { telephone = null, userId = null, nom = null } = {}) {
    let conv = this.donnees.conversations[cle];
    if (!conv) {
      conv = {
        cle,
        telephone: null,
        userId: null,
        nom: null,
        messages: [],
        pause: false,
        pauseMotif: null,
        pauseSource: null,
        pauseDepuis: null,
        derniereActivite: this.maintenantIso(),
        dernierMessageClientAt: null,
      };
      this.donnees.conversations[cle] = conv;
    }
    if (telephone) conv.telephone = telephone;
    if (userId) conv.userId = userId;
    if (nom) conv.nom = nom;
    this.sauver("conversations");
    return conv;
  }

  ajouterMessage(cle, message) {
    const conv = this.donnees.conversations[cle];
    if (!conv) return null;
    const complet = { at: this.maintenantIso(), ...message };
    conv.messages.push(complet);
    conv.derniereActivite = complet.at;
    if (complet.role === "client") conv.dernierMessageClientAt = complet.at;
    this.sauver("conversations");
    return complet;
  }

  definirPause(cle, pause, motif = null, source = null) {
    const conv = this.donnees.conversations[cle];
    if (!conv) return null;
    conv.pause = Boolean(pause);
    conv.pauseMotif = pause ? motif : null;
    conv.pauseSource = pause ? source : null;
    conv.pauseDepuis = pause ? this.maintenantIso() : null;
    this.sauver("conversations");
    return conv;
  }

  /** Signale qu'un message envoyé n'a pas été délivré (statut « failed » renvoyé par Meta). */
  marquerEchecEnvoi(idWhatsApp, raison) {
    if (!idWhatsApp) return false;
    for (const conv of Object.values(this.donnees.conversations)) {
      for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
        const message = conv.messages[i];
        if (Array.isArray(message.idsWhatsApp) && message.idsWhatsApp.includes(idWhatsApp)) {
          message.echec = raison;
          this.sauver("conversations");
          return true;
        }
      }
    }
    return false;
  }

  listeConversations() {
    return Object.values(this.donnees.conversations).sort((a, b) =>
      String(b.derniereActivite).localeCompare(String(a.derniereActivite)),
    );
  }

  // ---------- Commandes ----------

  ajouterCommande(commande) {
    this.donnees.commandes.push(commande);
    this.sauver("commandes");
    return commande;
  }

  listeCommandes() {
    return [...this.donnees.commandes].reverse();
  }

  // ---------- Dédoublonnage des messages reçus ----------

  dejaTraite(idMessage) {
    return Object.hasOwn(this.donnees.traites, idMessage);
  }

  marquerTraite(idMessage) {
    this.donnees.traites[idMessage] = this.horloge();
    this.sauver("traites");
  }

  // ---------- Journal des événements ----------

  journaliser(niveau, message, details = null) {
    const entree = { at: this.maintenantIso(), niveau, message, details: details ?? null };
    this.donnees.journal.unshift(entree);
    if (this.donnees.journal.length > TAILLE_MAX_JOURNAL) this.donnees.journal.length = TAILLE_MAX_JOURNAL;
    try {
      this.sauver("journal");
    } catch (err) {
      if (!this.silencieux) console.error(`[stockage] journal non enregistré : ${err.message}`);
    }
    if (!this.silencieux) {
      const ligne = `[${niveau}] ${message}${details ? ` — ${details}` : ""}`;
      if (niveau === "erreur") console.error(ligne);
      else console.log(ligne);
    }
    return entree;
  }

  listeJournal() {
    return this.donnees.journal;
  }

  // ---------- Suppression et nettoyage ----------

  /** Efface la conversation d'un client et anonymise ses commandes (les montants restent pour la comptabilité). */
  supprimerClient(cle) {
    delete this.donnees.conversations[cle];
    for (const commande of this.donnees.commandes) {
      if (commande.client !== cle) continue;
      commande.client = null;
      commande.telephoneWhatsApp = null;
      commande.nom_client = "(supprimé à la demande du client)";
      commande.telephone = "";
      commande.adresse_ou_quartier = "(supprimée)";
      commande.remarques = "";
    }
    this.sauver("conversations");
    this.sauver("commandes");
  }

  /** Supprime les messages de plus de 30 jours et les identifiants de messages de plus de 48 heures. */
  nettoyer() {
    const maintenant = this.horloge();
    for (const [cle, conv] of Object.entries(this.donnees.conversations)) {
      conv.messages = conv.messages.filter(
        (m) => maintenant - Date.parse(m.at) < DUREE_CONSERVATION_CONVERSATIONS,
      );
      if (conv.messages.length === 0 && !conv.pause) delete this.donnees.conversations[cle];
    }
    for (const [id, quand] of Object.entries(this.donnees.traites)) {
      if (maintenant - quand > DUREE_DEDOUBLONNAGE) delete this.donnees.traites[id];
    }
    this.sauver("conversations");
    this.sauver("traites");
  }
}
