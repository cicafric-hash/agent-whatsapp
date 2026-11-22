// Page d'administration /admin : conversations, commandes, journal et outils WhatsApp.
// Protégée par un mot de passe (authentification HTTP Basic, utilisateur « admin »).
import crypto from "node:crypto";
import express from "express";
import { apercu, dateLisible, echapperHtml as h, formaterMontant, formaterNumero, masquerNumero } from "./format.js";
import { egaliteSure, jetonFormulaire } from "./securite.js";
import { conseilPourCode, ErreurWhatsApp } from "./whatsapp.js";

const MINUTE = 60 * 1000;
const MAX_ECHECS_CONNEXION = 10;
const FENETRE_ECHECS = 15 * MINUTE;

const CSS = `
:root{--fond:#f5f6f8;--carte:#fff;--texte:#1c2230;--doux:#5a6375;--bord:#dce0e7;--accent:#0f7b6c;--accent-doux:#e2f2ef;
--alerte:#b42318;--alerte-doux:#fdeceb;--attention:#9a4a06;--attention-doux:#fef3e4;--client:#ffffff;--agent:#dff5d3;--humain:#e6edfb}
@media (prefers-color-scheme: dark){:root{--fond:#111419;--carte:#1a1f27;--texte:#e6e9ef;--doux:#a2aab8;--bord:#2b323e;
--accent:#2fb9a6;--accent-doux:#15302c;--alerte:#ff8d84;--alerte-doux:#3a1c1a;--attention:#ffb769;--attention-doux:#382916;
--client:#212733;--agent:#1d3628;--humain:#1e2a42}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--fond);color:var(--texte)}
header{background:var(--accent)}
nav{max-width:960px;margin:0 auto;display:flex;overflow-x:auto;padding:0 8px}
nav a{color:#fff;text-decoration:none;padding:14px 12px;white-space:nowrap;font-weight:600}
nav a[aria-current=page]{box-shadow:inset 0 -3px 0 #fff}
main{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:1.35rem;margin:8px 0 16px}h2{font-size:1.05rem;margin:24px 0 8px}
a{color:var(--accent)}
.carte{background:var(--carte);border:1px solid var(--bord);border-radius:12px;padding:16px;margin-bottom:16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--carte);border:1px solid var(--bord);border-radius:12px;padding:12px 16px}
.stat strong{display:block;font-size:1.5rem}
.doux{color:var(--doux);font-size:.9rem}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.8rem;font-weight:600;background:var(--accent-doux);color:var(--accent)}
.badge.pause{background:var(--attention-doux);color:var(--attention)}
.badge.erreur{background:var(--alerte-doux);color:var(--alerte)}
.message-flash{border-radius:10px;padding:12px 16px;margin-bottom:16px;background:var(--accent-doux)}
.message-flash.erreur{background:var(--alerte-doux);color:var(--alerte)}
.message-flash.attention{background:var(--attention-doux);color:var(--attention)}
ul.liste{list-style:none;margin:0;padding:0}
ul.liste li{border-top:1px solid var(--bord)}ul.liste li:first-child{border-top:0}
ul.liste a{display:block;padding:12px 4px;text-decoration:none;color:inherit}
.fil{display:flex;flex-direction:column;gap:8px}
.bulle{max-width:85%;border-radius:12px;padding:8px 12px;border:1px solid var(--bord);white-space:pre-wrap;overflow-wrap:anywhere}
.bulle.client{align-self:flex-start;background:var(--client)}
.bulle.agent{align-self:flex-end;background:var(--agent)}
.bulle.humain{align-self:flex-end;background:var(--humain)}
.bulle .meta{display:block;font-size:.78rem;color:var(--doux);margin-top:4px;white-space:normal}
.bulle.echec{border-color:var(--alerte)}
textarea,input[type=text],input[type=password]{width:100%;font:inherit;padding:10px;border:1px solid var(--bord);border-radius:8px;background:var(--carte);color:var(--texte)}
textarea{min-height:110px}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:10px 16px;background:var(--accent);color:#fff;cursor:pointer}
button.secondaire{background:transparent;color:var(--accent);border:1px solid var(--accent)}
button.danger{background:var(--alerte)}
form.ligne{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
.tableau{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{border-bottom:1px solid var(--bord);padding:8px;text-align:left;vertical-align:top}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--fond);border:1px solid var(--bord);border-radius:8px;padding:12px;font-size:.85rem}
label{display:block;margin:8px 0 4px;font-weight:600}
.carte p{margin:0 0 8px}.carte p:last-child{margin-bottom:0}.carte h2:first-child{margin-top:0}
ul.articles{margin:0 0 8px;padding-left:20px}
.entree{padding:10px 4px}
dl.config{margin:0}dl.config dt{font-weight:600;margin-top:12px}dl.config dt:first-child{margin-top:0}
dl.config dd{margin:2px 0 0;color:var(--doux);overflow-wrap:anywhere}
@media (max-width:420px){nav a{padding:12px 8px;font-size:.9rem}main{padding:12px}}
`;

const PAGES_MENU = [
  ["/admin", "Conversations"],
  ["/admin/commandes", "Commandes"],
  ["/admin/outils", "Outils"],
  ["/admin/journal", "Journal"],
];

function page({ titre, actif, contenu }) {
  const menu = PAGES_MENU.map(
    ([lien, nom]) => `<a href="${lien}"${lien === actif ? ' aria-current="page"' : ""}>${nom}</a>`,
  ).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${h(titre)} · Agent WhatsApp</title><style>${CSS}</style></head><body><header><nav>${menu}</nav></header><main><h1>${h(titre)}</h1>${contenu}</main></body></html>`;
}

function badgeNiveau(niveau) {
  if (niveau === "erreur") return '<span class="badge erreur">Erreur</span>';
  if (niveau === "avertissement") return '<span class="badge pause">Attention</span>';
  return '<span class="badge">Info</span>';
}

function listeJournalAvecFuseau(entrees, fuseau) {
  return `<ul class="liste">${entrees
    .map(
      (e) =>
        `<li><div class="entree">${badgeNiveau(e.niveau)} ${h(e.message)}<br><span class="doux">${h(dateLisible(e.at, fuseau))}${e.details ? ` · ${h(e.details)}` : ""}</span></div></li>`,
    )
    .join("")}</ul>`;
}

function resumeErreur(err) {
  if (err instanceof ErreurWhatsApp) {
    const conseil = conseilPourCode(err.code);
    return `${err.resume}${conseil ? ` — ${conseil}` : ""}`;
  }
  return err?.message ?? String(err);
}

export function creerRouteurAdmin({ config, stockage, agent, whatsapp, connaissances }) {
  const routeur = express.Router();
  const jeton = jetonFormulaire(config.adminPassword);
  const echecs = new Map(); // adresse IP -> { nombre, depuis }
  const flashs = new Map(); // messages affichés une seule fois après une action

  const champJeton = `<input type="hidden" name="jeton" value="${jeton}">`;
  const listeJournal = (entrees) => listeJournalAvecFuseau(entrees, config.fuseau);

  function flash(type, texte) {
    const id = crypto.randomBytes(8).toString("hex");
    flashs.set(id, { type, texte, expire: Date.now() + 5 * MINUTE });
    for (const [cle, valeur] of flashs) if (valeur.expire < Date.now()) flashs.delete(cle);
    return id;
  }

  function lireFlash(req) {
    const id = typeof req.query.f === "string" ? req.query.f : null;
    const valeur = id ? flashs.get(id) : null;
    if (!valeur) return "";
    flashs.delete(id);
    const classe = valeur.type === "erreur" ? "message-flash erreur" : "message-flash";
    return `<div class="${classe}" role="status">${h(valeur.texte)}</div>`;
  }

  // --- Sécurité : en-têtes, mot de passe, anti-falsification ---
  routeur.use((req, res, suivant) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    suivant();
  });

  routeur.use((req, res, suivant) => {
    const ip = req.ip ?? "inconnue";
    const etat = echecs.get(ip);
    if (etat && Date.now() - etat.depuis > FENETRE_ECHECS) echecs.delete(ip);
    if ((echecs.get(ip)?.nombre ?? 0) >= MAX_ECHECS_CONNEXION) {
      return res.status(429).type("text/plain; charset=utf-8").send("Trop d'essais de mot de passe. Réessayez dans 15 minutes.");
    }
    const entete = req.get("authorization") ?? "";
    let utilisateur = "";
    let motDePasse = "";
    if (entete.startsWith("Basic ")) {
      const decode = Buffer.from(entete.slice(6), "base64").toString("utf8");
      const separateur = decode.indexOf(":");
      if (separateur >= 0) {
        utilisateur = decode.slice(0, separateur);
        motDePasse = decode.slice(separateur + 1);
      }
    }
    const valide = egaliteSure(utilisateur, "admin") & egaliteSure(motDePasse, config.adminPassword);
    if (!valide) {
      if (entete) {
        const courant = echecs.get(ip) ?? { nombre: 0, depuis: Date.now() };
        courant.nombre += 1;
        echecs.set(ip, courant);
      }
      res.set("WWW-Authenticate", 'Basic realm="Administration de l\'agent", charset="UTF-8"');
      return res.status(401).type("text/plain; charset=utf-8").send("Identifiant : admin. Mot de passe : la valeur de ADMIN_PASSWORD.");
    }
    echecs.delete(ip);
    suivant();
  });

  routeur.use(express.urlencoded({ extended: false, limit: "50kb" }));

  routeur.use((req, res, suivant) => {
    if (req.method !== "POST") return suivant();
    if (!egaliteSure(req.body?.jeton ?? "", jeton)) {
      return res.status(403).type("text/plain; charset=utf-8").send("Formulaire refusé (jeton de sécurité invalide). Rechargez la page et recommencez.");
    }
    suivant();
  });

  // --- Tableau de bord : conversations ---
  routeur.get("/", (req, res) => {
    const conversations = stockage.listeConversations();
    const commandes = stockage.listeCommandes();
    const aujourdHui = dateLisible(new Date(), config.fuseau).slice(0, 10);
    const commandesDuJour = commandes.filter((c) => dateLisible(c.creeeLe, config.fuseau).slice(0, 10) === aujourdHui);
    const enPause = conversations.filter((c) => c.pause);
    const alertes = stockage.listeJournal().filter((e) => e.niveau !== "info").slice(0, 5);

    const avertissements = (connaissances.avertissements ?? [])
      .map((a) => `<div class="message-flash attention">${h(a)}</div>`)
      .join("");

    const lignes = conversations
      .map((c) => {
        const dernier = c.messages.at(-1);
        const qui = dernier?.role === "client" ? "" : dernier?.role === "humain" ? "Équipe : " : "Agent : ";
        const nom = c.nom ? h(c.nom) : "Client";
        const numero = c.telephone ? formaterNumero(c.telephone) : "numéro masqué";
        const statut = c.pause ? ' <span class="badge pause">En pause</span>' : "";
        return `<li><a href="/admin/conversation/${encodeURIComponent(c.cle)}"><strong>${nom}</strong> <span class="doux">${h(numero)}</span>${statut}<br><span class="doux">${h(qui)}${h(apercu(dernier?.texte ?? ""))} · ${h(dateLisible(c.derniereActivite, config.fuseau))}</span></a></li>`;
      })
      .join("");

    const blocAlertes = alertes.length
      ? `<h2>Dernières alertes</h2><div class="carte">${listeJournal(alertes)}<p><a href="/admin/journal">Tout le journal</a></p></div>`
      : "";

    res.send(
      page({
        titre: "Conversations",
        actif: "/admin",
        contenu: `${lireFlash(req)}${avertissements}
<div class="stats">
<div class="stat"><strong>${conversations.length}</strong><span class="doux">conversations (30 derniers jours)</span></div>
<div class="stat"><strong>${enPause.length}</strong><span class="doux">en attente d'une personne</span></div>
<div class="stat"><strong>${commandesDuJour.length}</strong><span class="doux">commandes aujourd'hui</span></div>
</div>
<div class="carte">${lignes ? `<ul class="liste">${lignes}</ul>` : '<p class="doux">Aucune conversation pour le moment. Écrivez à votre numéro WhatsApp pour tester l\'agent.</p>'}</div>
${blocAlertes}`,
      }),
    );
  });

  // --- Une conversation ---
  routeur.get("/conversation/:cle", (req, res) => {
    const conv = stockage.conversation(req.params.cle);
    if (!conv) return res.status(404).send(page({ titre: "Conversation introuvable", actif: "/admin", contenu: '<p><a href="/admin">Retour aux conversations</a></p>' }));
    const action = `/admin/conversation/${encodeURIComponent(conv.cle)}`;
    const numero = conv.telephone ? formaterNumero(conv.telephone) : "numéro masqué par le client";
    const ouverte = agent.fenetreOuverte(conv);
    let fenetre;
    if (ouverte) {
      const ecoule = Math.max(0, Date.now() - Date.parse(conv.dernierMessageClientAt));
      const resteMs = 24 * 60 * MINUTE - ecoule;
      const heures = Math.floor(resteMs / (60 * MINUTE));
      const minutes = Math.floor((resteMs % (60 * MINUTE)) / MINUTE);
      fenetre = `<span class="badge">Fenêtre de réponse ouverte</span> <span class="doux">encore ${heures} h ${minutes} min</span>`;
    } else {
      fenetre = '<span class="badge erreur">Fenêtre de réponse fermée</span> <span class="doux">Le client doit vous réécrire avant que vous puissiez lui répondre.</span>';
    }
    const statut = conv.pause
      ? `<span class="badge pause">Agent en pause</span> <span class="doux">${h(conv.pauseMotif ?? "")} · depuis le ${h(dateLisible(conv.pauseDepuis, config.fuseau))}</span>
<form class="ligne" method="post" action="${action}/reprendre">${champJeton}<button type="submit">Relancer l'agent</button></form>`
      : `<span class="badge">Agent actif</span>
<form class="ligne" method="post" action="${action}/pause">${champJeton}<button type="submit" class="secondaire">Mettre l'agent en pause</button></form>`;

    const libelles = { client: "Client", agent: "Agent", humain: "Équipe" };
    const bulles = conv.messages
      .map((m) => {
        const echec = m.echec ? ` <span class="badge erreur">Non délivré</span> ${h(m.echec)}` : "";
        return `<div class="bulle ${h(m.role)}${m.echec ? " echec" : ""}">${h(m.texte)}<span class="meta">${libelles[m.role] ?? h(m.role)} · ${h(dateLisible(m.at, config.fuseau))}${echec}</span></div>`;
      })
      .join("");

    res.send(
      page({
        titre: conv.nom ? conv.nom : "Client",
        actif: "/admin",
        contenu: `${lireFlash(req)}
<div class="carte"><p><strong>${h(numero)}</strong>${conv.userId ? `<br><span class="doux">Identifiant WhatsApp : ${h(conv.userId)}</span>` : ""}</p>
<p>${statut}</p><p>${fenetre}</p></div>
<div class="carte"><div class="fil">${bulles || '<p class="doux">Aucun message.</p>'}</div></div>
<div class="carte"><form method="post" action="${action}/repondre">${champJeton}
<label for="texte">Répondre vous-même</label>
<textarea id="texte" name="texte" maxlength="4000" required placeholder="Votre message au client…"></textarea>
<p class="doux">Envoyer une réponse met l'agent en pause pour ce client. Relancez-le quand vous avez fini.</p>
<button type="submit">Envoyer sur WhatsApp</button></form></div>
<div class="carte"><h2>Effacer ce client</h2><p class="doux">Supprime la conversation et anonymise ses commandes. Action définitive.</p>
<form method="post" action="${action}/supprimer">${champJeton}
<label><input type="checkbox" name="confirmation" value="oui" required> Je confirme la suppression</label>
<button type="submit" class="danger">Effacer les données de ce client</button></form></div>`,
      }),
    );
  });

  const retour = (res, cle, type, texte) =>
    res.redirect(303, `/admin/conversation/${encodeURIComponent(cle)}?f=${flash(type, texte)}`);

  routeur.post("/conversation/:cle/repondre", async (req, res) => {
    const cle = req.params.cle;
    if (!stockage.conversation(cle)) return res.redirect(303, "/admin");
    try {
      await agent.repondreManuellement(cle, req.body?.texte ?? "");
      return retour(res, cle, "ok", "Message envoyé. L'agent est en pause pour ce client.");
    } catch (err) {
      return retour(res, cle, "erreur", `Message non envoyé : ${resumeErreur(err)}`);
    }
  });

  routeur.post("/conversation/:cle/pause", (req, res) => {
    const cle = req.params.cle;
    if (!stockage.conversation(cle)) return res.redirect(303, "/admin");
    agent.mettreEnPause(cle);
    return retour(res, cle, "ok", "L'agent ne répondra plus à ce client jusqu'à ce que vous le relanciez.");
  });

  routeur.post("/conversation/:cle/reprendre", (req, res) => {
    const cle = req.params.cle;
    if (!stockage.conversation(cle)) return res.redirect(303, "/admin");
    agent.reprendre(cle);
    return retour(res, cle, "ok", "L'agent répondra au prochain message de ce client.");
  });

  routeur.post("/conversation/:cle/supprimer", (req, res) => {
    const cle = req.params.cle;
    if (req.body?.confirmation !== "oui") return retour(res, cle, "erreur", "Cochez la case de confirmation pour effacer.");
    agent.supprimerClient(cle);
    return res.redirect(303, `/admin?f=${flash("ok", "Les données de ce client ont été effacées.")}`);
  });

  // --- Commandes ---
  routeur.get("/commandes", (req, res) => {
    const commandes = stockage.listeCommandes();
    const cartes = commandes
      .map((c) => {
        const articles = c.articles
          .map((a) => `<li>${h(a.quantite)} × ${h(a.produit)} — ${formaterMontant(a.prix_unitaire)} FCFA</li>`)
          .join("");
        const lienClient = c.client
          ? `<a href="/admin/conversation/${encodeURIComponent(c.client)}">${h(c.nom_client)}</a>`
          : h(c.nom_client);
        const numeros = [c.telephoneWhatsApp ? formaterNumero(c.telephoneWhatsApp) : "", c.telephone ? `livraison : ${c.telephone}` : ""]
          .filter(Boolean)
          .join(" · ");
        const ecart = Math.abs(Number(c.total) - (Number(c.sous_total_calcule) + Number(c.frais_livraison))) >= 1;
        return `<div class="carte"><p><strong>${h(c.id)}</strong> <span class="doux">· ${h(dateLisible(c.creeeLe, config.fuseau))}</span>${ecart ? ' <span class="badge erreur">Total à vérifier</span>' : ""}</p>
<p>${lienClient}${numeros ? `<br><span class="doux">${h(numeros)}</span>` : ""}</p>
<ul class="articles">${articles}</ul>
<p><strong>Total : ${formaterMontant(c.total)} FCFA</strong> <span class="doux">(dont livraison ${formaterMontant(c.frais_livraison)} FCFA)</span></p>
<p class="doux">Adresse : ${h(c.adresse_ou_quartier || "non précisée")}<br>Paiement : ${h(c.mode_paiement || "non précisé")}${c.remarques ? `<br>Remarques : ${h(c.remarques)}` : ""}</p></div>`;
      })
      .join("");
    res.send(
      page({
        titre: "Commandes",
        actif: "/admin/commandes",
        contenu: cartes || '<div class="carte"><p class="doux">Aucune commande pour le moment.</p></div>',
      }),
    );
  });

  // --- Journal ---
  routeur.get("/journal", (req, res) => {
    const entrees = stockage.listeJournal();
    res.send(
      page({
        titre: "Journal",
        actif: "/admin/journal",
        contenu: entrees.length
          ? `<div class="carte">${listeJournal(entrees)}</div>`
          : '<div class="carte"><p class="doux">Aucun événement enregistré.</p></div>',
      }),
    );
  });

  // --- Outils WhatsApp ---
  function pageOutils(req, resultat = "") {
    const resume = [
      ["Modèle Claude", config.modele],
      ["Version de l'API Graph", config.graphVersion],
      ["Identifiant du numéro (WHATSAPP_PHONE_NUMBER_ID)", config.phoneNumberId],
      ["Identifiant du compte WhatsApp Business", config.wabaId || "non défini"],
      ["Numéro de l'agent (vu dans les messages reçus)", agent.numeroAgent ? formaterNumero(agent.numeroAgent) : "pas encore vu"],
      ["Numéro des alertes (OWNER_WHATSAPP)", config.proprietaire ? formaterNumero(config.proprietaire) : "non défini"],
      ["Dossier des données (DATA_DIR)", config.dataDir],
    ]
      .map(([nom, valeur]) => `<dt>${h(nom)}</dt><dd>${h(valeur)}</dd>`)
      .join("");
    return page({
      titre: "Outils",
      actif: "/admin/outils",
      contenu: `${resultat}
<div class="carte"><h2>1. Tester la connexion WhatsApp</h2><p class="doux">Affiche le numéro, le nom vérifié et la qualité du numéro configuré.</p>
<form method="post" action="/admin/outils/tester">${champJeton}<button type="submit">Tester la connexion WhatsApp</button></form></div>
<div class="carte"><h2>2. Enregistrer le numéro</h2><p class="doux">À faire une fois, après l'ajout de votre vrai numéro chez Meta. Le code PIN à 6 chiffres protège votre numéro : notez-le. Meta autorise 10 essais par 72 heures.</p>
<form method="post" action="/admin/outils/enregistrer">${champJeton}<label for="pin">Code PIN (6 chiffres)</label>
<input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" required>
<p><button type="submit">Enregistrer le numéro</button></p></form></div>
<div class="carte"><h2>3. Abonner l'application au compte WhatsApp</h2><p class="doux">Nécessaire pour recevoir les messages de votre vrai numéro. Demande WHATSAPP_BUSINESS_ACCOUNT_ID.</p>
<form method="post" action="/admin/outils/abonner">${champJeton}<button type="submit">Abonner l'application</button></form></div>
<div class="carte"><h2>4. Envoyer un message test au propriétaire</h2><p class="doux">Envoie un message au numéro OWNER_WHATSAPP. Il n'arrive que si ce numéro a écrit à l'agent dans les dernières 24 heures.</p>
<form method="post" action="/admin/outils/message-test">${champJeton}<button type="submit">Envoyer le message test</button></form></div>
<div class="carte"><h2>Configuration actuelle</h2><dl class="config">${resume}</dl></div>`,
    });
  }

  function blocResultat(titre, ok, contenu) {
    const classe = ok ? "message-flash" : "message-flash erreur";
    return `<div class="${classe}" role="status"><strong>${h(titre)} : ${ok ? "réussi" : "échec"}</strong><pre>${h(contenu)}</pre></div>`;
  }

  async function executerOutil(res, req, titre, action) {
    try {
      const reponse = await action();
      stockage.journaliser("info", `Outil « ${titre} » : réussi.`);
      res.send(pageOutils(req, blocResultat(titre, true, JSON.stringify(reponse, null, 2))));
    } catch (err) {
      stockage.journaliser("erreur", `Outil « ${titre} » : échec.`, resumeErreur(err));
      res.send(pageOutils(req, blocResultat(titre, false, resumeErreur(err))));
    }
  }

  routeur.get("/outils", (req, res) => res.send(pageOutils(req)));
  routeur.post("/outils/tester", (req, res) => executerOutil(res, req, "Tester la connexion", () => whatsapp.infosNumero()));
  routeur.post("/outils/enregistrer", (req, res) => {
    const pin = String(req.body?.pin ?? "");
    if (!/^[0-9]{6}$/.test(pin)) {
      return res.send(pageOutils(req, blocResultat("Enregistrer le numéro", false, "Le code PIN doit contenir exactement 6 chiffres.")));
    }
    return executerOutil(res, req, "Enregistrer le numéro", () => whatsapp.enregistrerNumero(pin));
  });
  routeur.post("/outils/abonner", (req, res) => executerOutil(res, req, "Abonner l'application", () => whatsapp.abonnerApplication()));
  routeur.post("/outils/message-test", (req, res) =>
    executerOutil(res, req, "Message test au propriétaire", async () => {
      const reponse = await agent.envoyerMessageTest();
      return { envoye_a: masquerNumero(config.proprietaire), reponse };
    }),
  );

  return routeur;
}
