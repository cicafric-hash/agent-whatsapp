// Tests du webhook et du comportement de l'agent (Claude et Meta simulés, aucun appel réseau).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { MESSAGES } from "../src/agent.js";
import {
  demarrerServeur,
  environnement,
  messageTexte,
  NUMERO_CLIENT,
  NUMERO_PROPRIETAIRE,
  posterWebhook,
  reponseOutil,
  reponseRefus,
  reponseTexte,
  signer,
  webhook,
} from "./aides.js";

const aNettoyer = [];
afterEach(async () => {
  while (aNettoyer.length) await aNettoyer.pop()();
});

async function preparer(options) {
  const env = environnement(options);
  const serveur = await demarrerServeur(env);
  aNettoyer.push(env.nettoyer, serveur.fermer);
  return { ...env, ...serveur };
}

function dernierTourClient(appel) {
  const dernier = appel.messages.at(-1);
  assert.equal(dernier.role, "user");
  return dernier.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

describe("vérification du webhook (GET)", () => {
  it("renvoie le défi quand le jeton est bon", async () => {
    const { base, config } = await preparer();
    const url = `${base}/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(config.verifyToken)}&hub.challenge=12345`;
    const reponse = await fetch(url);
    assert.equal(reponse.status, 200);
    assert.equal(await reponse.text(), "12345");
  });

  it("refuse un mauvais jeton", async () => {
    const { base } = await preparer();
    const reponse = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=12345`);
    assert.equal(reponse.status, 403);
  });
});

describe("réception des messages (POST)", () => {
  it("refuse une signature invalide ou absente", async () => {
    const { base, agent, appels } = await preparer();
    const corps = JSON.stringify(webhook({ messages: [messageTexte("Bonjour")] }));
    const sansSignature = await fetch(`${base}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: corps });
    assert.equal(sansSignature.status, 401);
    const mauvaiseSignature = await fetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signer(corps, "autre-secret") },
      body: corps,
    });
    assert.equal(mauvaiseSignature.status, 401);
    await agent.attendreInactivite();
    assert.equal(appels.length, 0);
  });

  it("répond à un message texte avec Claude", async () => {
    const { base, config, agent, appels, whatsapp, stockage } = await preparer({
      reponses: [reponseTexte("Bonjour ! Le **bazin riche** coûte 25 000 FCFA.")],
    });
    const message = messageTexte("Bonjour, combien coûte le bazin ?");
    const reponse = await posterWebhook(base, webhook({ messages: [message] }), config.appSecret);
    assert.equal(reponse.status, 200);
    await agent.attendreInactivite();

    assert.equal(appels.length, 1);
    const appel = appels[0];
    assert.equal(appel.model, "claude-opus-5-5");
    assert.deepEqual(appel.output_config, { effort: "low" });
    assert.deepEqual(appel.cache_control, { type: "ephemeral" });
    assert.deepEqual(appel.system[0].cache_control, { type: "ephemeral" });
    assert.equal(appel.system[0].text, "SYSTEME DE TEST");
    assert.deepEqual(appel.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(appel.fallbacks, "default");
    assert.ok(appel.tools.every((outil) => outil.strict === true));
    for (const interdit of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) {
      assert.equal(interdit in appel, false, `${interdit} ne doit pas être envoyé`);
    }
    assert.match(dernierTourClient(appel), /^\[Reçu le \d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}\] Bonjour, combien coûte le bazin \?$/);

    assert.deepEqual(whatsapp.lus.includes(message.id), true);
    assert.equal(whatsapp.envois.length, 1);
    assert.deepEqual(whatsapp.envois[0].destinataire, { telephone: NUMERO_CLIENT, userId: null });
    assert.equal(whatsapp.envois[0].texte, "Bonjour ! Le *bazin riche* coûte 25 000 FCFA.");

    const conv = stockage.conversation(NUMERO_CLIENT);
    assert.equal(conv.nom, "Awa");
    assert.deepEqual(
      conv.messages.map((m) => m.role),
      ["client", "agent"],
    );
  });

  it("ne traite qu'une fois un message renvoyé par Meta", async () => {
    const { base, config, agent, appels, whatsapp } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    const donnees = webhook({ messages: [messageTexte("Bonjour", { id: "wamid.double" })] });
    await posterWebhook(base, donnees, config.appSecret);
    await posterWebhook(base, donnees, config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels.length, 1);
    assert.equal(whatsapp.envois.length, 1);
  });

  it("enregistre sans répondre quand la conversation est en pause", async () => {
    const { base, config, agent, appels, whatsapp, stockage } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")] }), config.appSecret);
    await agent.attendreInactivite();
    agent.mettreEnPause(NUMERO_CLIENT);

    await posterWebhook(base, webhook({ messages: [messageTexte("Vous êtes là ?")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels.length, 1);
    assert.equal(whatsapp.envois.length, 1);
    const conv = stockage.conversation(NUMERO_CLIENT);
    assert.equal(conv.messages.at(-1).texte, "Vous êtes là ?");
    assert.equal(conv.pause, true);
  });

  it("enregistre une pré-inscription confirmée, alerte l'équipe et confirme au prospect", async () => {
    const preinscription = {
      nom_complet: "Awa Traoré",
      filiere: "Finance & Comptabilité",
      niveau_entree: "Licence 1",
      rythme: "Soir",
      dernier_diplome: "Bac TSECO 2026",
      ville: "Bamako, Kalaban Coura",
      concours_bourses: true,
      telephone: "",
      remarques: "Souhaite recevoir les frais par WhatsApp",
    };
    const { base, config, agent, appels, whatsapp, stockage } = await preparer({
      reponses: [
        reponseOutil("enregistrer_preinscription", preinscription),
        reponseTexte("C'est noté ! Votre pré-inscription est enregistrée."),
      ],
    });
    await posterWebhook(base, webhook({ messages: [messageTexte("Oui, je confirme ma pré-inscription")] }), config.appSecret);
    await agent.attendreInactivite();

    const preinscriptions = stockage.listePreinscriptions();
    assert.equal(preinscriptions.length, 1);
    assert.match(preinscriptions[0].id, /^PRE-\d{8}-\d{4}$/);
    assert.equal(preinscriptions[0].filiere, "Finance & Comptabilité");
    assert.equal(preinscriptions[0].concours_bourses, true);
    assert.equal(preinscriptions[0].client, NUMERO_CLIENT);

    const alerte = whatsapp.envois.find((e) => e.destinataire.telephone === NUMERO_PROPRIETAIRE);
    assert.ok(alerte, "l'équipe doit être alertée");
    assert.match(alerte.texte, /^\[ALERTE PROPRIÉTAIRE\]\nNouvelle pré-inscription PRE-/);
    assert.match(alerte.texte, /Filière : Finance & Comptabilité/);
    assert.match(alerte.texte, /Niveau d'entrée : Licence 1 · Rythme : Soir/);
    assert.match(alerte.texte, /Concours de bourses : oui/);

    const auProspect = whatsapp.envois.filter((e) => e.destinataire.telephone === NUMERO_CLIENT);
    assert.equal(auProspect.length, 1);
    assert.equal(auProspect[0].texte, "C'est noté ! Votre pré-inscription est enregistrée.");

    // Le second appel renvoie le contenu de l'assistant tel quel, suivi du résultat de l'outil.
    assert.equal(appels.length, 2);
    const echanges = appels[1].messages;
    assert.deepEqual(echanges.at(-2), { role: "assistant", content: reponseOutil("enregistrer_preinscription", preinscription).content });
    const resultat = echanges.at(-1).content[0];
    assert.equal(resultat.type, "tool_result");
    assert.equal(resultat.tool_use_id, "toolu_test_1");
    assert.match(resultat.content, /Pré-inscription enregistrée sous la référence PRE-/);
  });

  it("refuse une pré-inscription sans filière et le signale à Claude", async () => {
    const incomplete = {
      nom_complet: "Moussa Keïta",
      filiere: "",
      niveau_entree: "À déterminer",
      rythme: "À déterminer",
      dernier_diplome: "",
      ville: "",
      concours_bourses: false,
      telephone: "",
      remarques: "",
    };
    const { base, config, agent, appels, stockage } = await preparer({
      reponses: [reponseOutil("enregistrer_preinscription", incomplete), reponseTexte("Quelle filière vous intéresse ?")],
    });
    await posterWebhook(base, webhook({ messages: [messageTexte("Inscrivez-moi")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(stockage.listePreinscriptions().length, 0);
    const resultat = appels[1].messages.at(-1).content[0];
    assert.equal(resultat.is_error, true);
    assert.match(resultat.content, /il manque le nom du prospect ou la filière/);
  });

  it("confie la conversation à l'équipe quand Claude demande un humain", async () => {
    const { base, config, agent, appels, whatsapp, stockage } = await preparer({
      reponses: [reponseOutil("demander_un_humain", { motif: "Le client est mécontent." }), reponseTexte("Une personne va vous répondre ici.")],
    });
    await posterWebhook(base, webhook({ messages: [messageTexte("Je veux parler à quelqu'un !")] }), config.appSecret);
    await agent.attendreInactivite();

    const conv = stockage.conversation(NUMERO_CLIENT);
    assert.equal(conv.pause, true);
    assert.equal(conv.pauseSource, "agent");
    assert.ok(whatsapp.envois.some((e) => e.destinataire.telephone === NUMERO_PROPRIETAIRE && /demande un conseiller/.test(e.texte)));
    assert.ok(whatsapp.envois.some((e) => e.destinataire.telephone === NUMERO_CLIENT && e.texte === "Une personne va vous répondre ici."));

    await posterWebhook(base, webhook({ messages: [messageTexte("Allô ?")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels.length, 2, "plus d'appel à Claude une fois la conversation confiée à l'équipe");
  });

  it("regroupe les messages envoyés à la suite en une seule réponse", async () => {
    const { base, config, agent, appels, whatsapp } = await preparer({ reponses: [reponseTexte("Voici nos prix.")] });
    const donnees = webhook({ messages: [messageTexte("Bonjour"), messageTexte("Je cherche du bazin"), messageTexte("Quels sont vos prix ?")] });
    await posterWebhook(base, donnees, config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels.length, 1);
    const blocs = appels[0].messages.at(-1).content;
    assert.equal(blocs.length, 3);
    assert.match(blocs[2].text, /Quels sont vos prix \?$/);
    assert.equal(whatsapp.envois.length, 1);
  });

  it("répond poliment à un message vocal sans appeler Claude", async () => {
    const { base, config, agent, appels, whatsapp } = await preparer();
    const vocal = { from: NUMERO_CLIENT, id: "wamid.vocal", timestamp: "1795400000", type: "audio", audio: { id: "media1", voice: true } };
    await posterWebhook(base, webhook({ messages: [vocal] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels.length, 0);
    assert.equal(whatsapp.envois.length, 1);
    assert.equal(whatsapp.envois[0].texte, MESSAGES.mediaNonPrisEnCharge);
  });

  it("montre une photo reçue à Claude", async () => {
    const { base, config, agent, appels, whatsapp } = await preparer({ reponses: [reponseTexte("Très joli modèle !")] });
    whatsapp.medias.set("media-photo", { mimeType: "image/jpeg", base64: "AAAA" });
    const photo = { from: NUMERO_CLIENT, id: "wamid.photo", timestamp: "1795400000", type: "image", image: { id: "media-photo", caption: "Vous avez ce modèle ?" } };
    await posterWebhook(base, webhook({ messages: [photo] }), config.appSecret);
    await agent.attendreInactivite();
    const blocs = appels[0].messages.at(-1).content;
    assert.deepEqual(blocs[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    assert.match(blocs[1].text, /\[Photo envoyée par le client\] Vous avez ce modèle \?$/);
  });

  it("répond par identifiant WhatsApp quand le numéro est masqué", async () => {
    const { base, config, agent, whatsapp, stockage } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    const message = messageTexte("Bonjour", { de: null, userId: "ML.13491208655302741918" });
    await posterWebhook(base, webhook({ messages: [message], contacts: [{ profile: { name: "Moussa" }, user_id: "ML.13491208655302741918" }] }), config.appSecret);
    await agent.attendreInactivite();
    assert.deepEqual(whatsapp.envois[0].destinataire, { telephone: null, userId: "ML.13491208655302741918" });
    assert.equal(stockage.conversation("ML.13491208655302741918").nom, "Moussa");
  });

  it("ignore les messages destinés à un autre numéro", async () => {
    const { base, config, agent, appels, stockage } = await preparer();
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")], phoneNumberId: "999" }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels.length, 0);
    assert.ok(stockage.listeJournal().some((e) => /autre numéro WhatsApp/.test(e.message)));
  });

  it("efface les données du client qui envoie SUPPRIMER MES DONNÉES", async () => {
    const { base, config, agent, appels, whatsapp, stockage } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")] }), config.appSecret);
    await agent.attendreInactivite();
    await posterWebhook(base, webhook({ messages: [messageTexte("supprimer mes données")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(stockage.conversation(NUMERO_CLIENT), null);
    assert.equal(appels.length, 1);
    assert.equal(whatsapp.envois.at(-1).texte, MESSAGES.suppression);
  });

  it("limite à 30 messages par heure et par client", async () => {
    const { base, config, agent, appels, whatsapp } = await preparer({ reponses: [reponseTexte("Réponse groupée")] });
    const messages = Array.from({ length: 32 }, (_, i) => messageTexte(`message ${i}`));
    await posterWebhook(base, webhook({ messages }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels.length, 1);
    assert.equal(whatsapp.envois.filter((e) => e.texte === MESSAGES.limite).length, 1);
  });

  it("n'envoie pas de repli côté serveur avec Claude Haiku 5.5", async () => {
    const { base, config, agent, appels } = await preparer({ reponses: [reponseTexte("Bonjour !")], config: { modele: "claude-haiku-5-5" } });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(appels[0].model, "claude-haiku-5-5");
    assert.equal("fallbacks" in appels[0], false);
    assert.equal("betas" in appels[0], false);
  });

  it("s'excuse et alerte le propriétaire quand Claude est injoignable", async () => {
    const panne = new Anthropic.APIConnectionError({ message: "réseau coupé" });
    const { base, config, agent, whatsapp, stockage } = await preparer({ reponses: [panne] });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.ok(whatsapp.envois.some((e) => e.destinataire.telephone === NUMERO_CLIENT && e.texte === MESSAGES.erreur));
    assert.ok(whatsapp.envois.some((e) => e.destinataire.telephone === NUMERO_PROPRIETAIRE && /Claude/.test(e.texte)));
    assert.ok(stockage.listeJournal().some((e) => e.niveau === "erreur" && /Claude/.test(e.message)));
  });

  it("répond poliment quand Claude décline une demande", async () => {
    const { base, config, agent, whatsapp } = await preparer({ reponses: [reponseRefus()] });
    await posterWebhook(base, webhook({ messages: [messageTexte("Question hors sujet")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(whatsapp.envois[0].texte, MESSAGES.refus);
  });

  it("signale dans la conversation un message que Meta n'a pas pu délivrer", async () => {
    const { base, config, agent, stockage } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")] }), config.appSecret);
    await agent.attendreInactivite();
    const statut = {
      id: "wamid.envoi.1",
      status: "failed",
      recipient_id: NUMERO_CLIENT,
      errors: [{ code: 131047, title: "Re-engagement message" }],
    };
    await posterWebhook(base, webhook({ statuses: [statut] }), config.appSecret);
    await agent.attendreInactivite();
    const message = stockage.conversation(NUMERO_CLIENT).messages.at(-1);
    assert.equal(message.role, "agent");
    assert.match(message.echec, /131047/);
  });

  it("n'envoie pas d'alerte au numéro de l'agent lui-même", async () => {
    const { base, config, agent, whatsapp, stockage } = await preparer({
      reponses: [reponseOutil("demander_un_humain", { motif: "Question de garantie." }), reponseTexte("Une personne va vous répondre.")],
      config: { proprietaire: "15550100" },
    });
    await posterWebhook(base, webhook({ messages: [messageTexte("Et la garantie ?")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(whatsapp.envois.filter((e) => e.destinataire.telephone === "15550100").length, 0);
    assert.ok(stockage.listeJournal().some((e) => /numéro de l'agent lui-même/.test(e.message)));
  });
});

describe("alertes avec le modèle de message", () => {
  const AVEC_MODELE = { modeleAlerte: "alerte_agent", langueModeleAlerte: "fr" };
  const transfert = () => [
    reponseOutil("demander_un_humain", { motif: "Veut connaître les frais exacts." }),
    reponseTexte("Un conseiller va vous répondre ici."),
  ];

  it("utilise le modèle quand le numéro des alertes n'a pas écrit depuis 24 heures", async () => {
    const { base, config, agent, whatsapp } = await preparer({ reponses: transfert(), config: AVEC_MODELE });
    await posterWebhook(base, webhook({ messages: [messageTexte("Combien coûte la licence ?")] }), config.appSecret);
    await agent.attendreInactivite();

    assert.equal(whatsapp.envois.filter((e) => e.destinataire.telephone === NUMERO_PROPRIETAIRE).length, 0);
    assert.equal(whatsapp.modeles.length, 1);
    const [envoi] = whatsapp.modeles;
    assert.deepEqual(envoi.destinataire, { telephone: NUMERO_PROPRIETAIRE });
    assert.equal(envoi.nom, "alerte_agent");
    assert.equal(envoi.langue, "fr");
    assert.equal(envoi.parametres.length, 2);
    assert.equal(envoi.parametres[0], "un prospect demande un conseiller");
    assert.match(envoi.parametres[1], /^Prospect : Awa \(\+223 75 75 86 70\) · Motif : Veut connaître les frais exacts · Répondez/);
    for (const parametre of envoi.parametres) {
      assert.equal(/[\n\t]| {5,}/.test(parametre), false, "WhatsApp refuse les retours à la ligne et les longues suites d'espaces");
    }
  });

  it("envoie un message libre quand le numéro des alertes a écrit depuis moins de 24 heures", async () => {
    const { base, config, agent, whatsapp } = await preparer({
      reponses: [reponseTexte("Bonjour !"), ...transfert()],
      config: AVEC_MODELE,
    });
    await posterWebhook(
      base,
      webhook({ messages: [messageTexte("Bonjour, ici l'équipe", { de: NUMERO_PROPRIETAIRE })], contacts: [{ profile: { name: "Admissions" }, wa_id: NUMERO_PROPRIETAIRE }] }),
      config.appSecret,
    );
    await agent.attendreInactivite();
    await posterWebhook(base, webhook({ messages: [messageTexte("Combien coûte la licence ?")] }), config.appSecret);
    await agent.attendreInactivite();

    assert.equal(whatsapp.modeles.length, 0);
    const alerte = whatsapp.envois.find((e) => e.destinataire.telephone === NUMERO_PROPRIETAIRE && e.texte.startsWith("[ALERTE"));
    assert.ok(alerte);
    assert.match(alerte.texte, /^\[ALERTE PROPRIÉTAIRE\]\nUn prospect demande un conseiller\nProspect : Awa/);
  });

  it("renvoie avec le modèle une alerte que Meta signale non délivrée (code 131047)", async () => {
    const { base, config, agent, whatsapp } = await preparer({
      reponses: [reponseTexte("Bonjour !"), ...transfert()],
      config: AVEC_MODELE,
    });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour", { de: NUMERO_PROPRIETAIRE })] }), config.appSecret);
    await agent.attendreInactivite();
    await posterWebhook(base, webhook({ messages: [messageTexte("Combien coûte la licence ?")] }), config.appSecret);
    await agent.attendreInactivite();
    const alerte = whatsapp.envois.find((e) => e.destinataire.telephone === NUMERO_PROPRIETAIRE && e.texte.startsWith("[ALERTE"));
    assert.ok(alerte);

    const statut = { id: alerte.id, status: "failed", recipient_id: NUMERO_PROPRIETAIRE, errors: [{ code: 131047, title: "Re-engagement message" }] };
    await posterWebhook(base, webhook({ statuses: [statut] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(whatsapp.modeles.length, 1);
    assert.equal(whatsapp.modeles[0].parametres[0], "un prospect demande un conseiller");
  });

  it("bascule tout de suite sur le modèle si Meta refuse le message libre (erreur 131047)", async () => {
    const { base, config, agent, whatsapp } = await preparer({
      reponses: [reponseTexte("Bonjour !"), ...transfert()],
      config: AVEC_MODELE,
    });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour", { de: NUMERO_PROPRIETAIRE })] }), config.appSecret);
    await agent.attendreInactivite();
    whatsapp.horsFenetre.add(NUMERO_PROPRIETAIRE);
    await posterWebhook(base, webhook({ messages: [messageTexte("Combien coûte la licence ?")] }), config.appSecret);
    await agent.attendreInactivite();
    assert.equal(whatsapp.modeles.length, 1);
    assert.equal(whatsapp.modeles[0].nom, "alerte_agent");
  });
});
