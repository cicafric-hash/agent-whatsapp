// Tests de la page /admin et des pages publiques.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { jetonFormulaire } from "../src/securite.js";
import {
  autorisation,
  demarrerServeur,
  environnement,
  messageTexte,
  NUMERO_CLIENT,
  posterWebhook,
  reponseTexte,
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

function formulaire(champs) {
  return { "content-type": "application/x-www-form-urlencoded", body: new URLSearchParams(champs).toString() };
}

describe("page /admin", () => {
  it("exige le mot de passe", async () => {
    const { base, config } = await preparer();
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    assert.equal((await fetch(`${base}/admin`, { headers: { authorization: autorisation("faux") } })).status, 401);
    const ok = await fetch(`${base}/admin`, { headers: { authorization: autorisation(config.adminPassword) } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /<h1>Conversations<\/h1>/);
  });

  it("bloque après 10 mauvais mots de passe", async () => {
    const { base } = await preparer();
    for (let i = 0; i < 10; i += 1) await fetch(`${base}/admin`, { headers: { authorization: autorisation("faux") } });
    assert.equal((await fetch(`${base}/admin`, { headers: { authorization: autorisation("faux") } })).status, 429);
  });

  it("protège le texte des clients dans les pages (pas d'injection HTML)", async () => {
    const { base, config, agent } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    await posterWebhook(base, webhook({ messages: [messageTexte("<script>alert(1)</script>")] }), config.appSecret);
    await agent.attendreInactivite();
    const page = await (await fetch(`${base}/admin/conversation/${NUMERO_CLIENT}`, { headers: { authorization: autorisation(config.adminPassword) } })).text();
    assert.equal(page.includes("<script>alert(1)</script>"), false);
    assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("envoie une réponse manuelle et met l'agent en pause", async () => {
    const { base, config, agent, whatsapp, stockage } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")] }), config.appSecret);
    await agent.attendreInactivite();

    const { body, ...entetes } = formulaire({ jeton: jetonFormulaire(config.adminPassword), texte: "Bonjour, c'est Moussa de la boutique." });
    const reponse = await fetch(`${base}/admin/conversation/${NUMERO_CLIENT}/repondre`, {
      method: "POST",
      headers: { authorization: autorisation(config.adminPassword), ...entetes },
      body,
      redirect: "manual",
    });
    assert.equal(reponse.status, 303);
    assert.equal(whatsapp.envois.at(-1).texte, "Bonjour, c'est Moussa de la boutique.");
    const conv = stockage.conversation(NUMERO_CLIENT);
    assert.equal(conv.pause, true);
    assert.equal(conv.pauseSource, "admin");
    assert.equal(conv.messages.at(-1).role, "humain");
  });

  it("refuse un formulaire sans jeton de sécurité", async () => {
    const { base, config, agent, whatsapp } = await preparer({ reponses: [reponseTexte("Bonjour !")] });
    await posterWebhook(base, webhook({ messages: [messageTexte("Bonjour")] }), config.appSecret);
    await agent.attendreInactivite();
    const { body, ...entetes } = formulaire({ texte: "Tentative" });
    const reponse = await fetch(`${base}/admin/conversation/${NUMERO_CLIENT}/repondre`, {
      method: "POST",
      headers: { authorization: autorisation(config.adminPassword), ...entetes },
      body,
    });
    assert.equal(reponse.status, 403);
    assert.equal(whatsapp.envois.some((e) => e.texte === "Tentative"), false);
  });

  it("enregistre le numéro seulement avec un PIN de 6 chiffres", async () => {
    const { base, config, whatsapp } = await preparer();
    const jeton = jetonFormulaire(config.adminPassword);
    const envoyer = (pin) => {
      const { body, ...entetes } = formulaire({ jeton, pin });
      return fetch(`${base}/admin/outils/enregistrer`, { method: "POST", headers: { authorization: autorisation(config.adminPassword), ...entetes }, body });
    };
    const refuse = await (await envoyer("12ab")).text();
    assert.match(refuse, /exactement 6 chiffres/);
    assert.equal(whatsapp.pins.length, 0);
    const accepte = await (await envoyer("123456")).text();
    assert.match(accepte, /Enregistrer le numéro : réussi/);
    assert.deepEqual(whatsapp.pins, ["123456"]);
  });

  it("crée le modèle d'alerte, affiche son statut et envoie une alerte test", async () => {
    const { base, config, whatsapp } = await preparer({ config: { modeleAlerte: "alerte_agent", langueModeleAlerte: "fr" } });
    const jeton = jetonFormulaire(config.adminPassword);
    const poster = (chemin) => {
      const { body, ...entetes } = formulaire({ jeton });
      return fetch(`${base}/admin/outils/${chemin}`, { method: "POST", headers: { authorization: autorisation(config.adminPassword), ...entetes }, body });
    };

    const creation = await (await poster("creer-modele")).text();
    assert.match(creation, /Créer le modèle d&#39;alerte : réussi/);
    assert.match(creation, /envoyé à Meta pour examen/);
    assert.equal(whatsapp.modelesCrees.length, 1);
    const [definition] = whatsapp.modelesCrees;
    assert.equal(definition.name, "alerte_agent");
    assert.equal(definition.language, "fr");
    assert.equal(definition.category, "UTILITY");

    const statut = await (await poster("statut-modele")).text();
    assert.match(statut, /APPROVED — approuvé/);

    const test = await (await poster("alerte-modele")).text();
    assert.match(test, /Alerte test avec le modèle : réussi/);
    assert.equal(whatsapp.modeles.length, 1);
    assert.equal(whatsapp.modeles[0].parametres[0], "test du modèle d'alerte");
  });

  it("explique que le modèle est désactivé quand MODELE_ALERTE vaut « aucun »", async () => {
    const { base, config, whatsapp } = await preparer({ config: { modeleAlerte: "" } });
    const { body, ...entetes } = formulaire({ jeton: jetonFormulaire(config.adminPassword) });
    const page = await (
      await fetch(`${base}/admin/outils/creer-modele`, { method: "POST", headers: { authorization: autorisation(config.adminPassword), ...entetes }, body })
    ).text();
    assert.match(page, /modèle d&#39;alerte est désactivé/);
    assert.equal(whatsapp.modelesCrees.length, 0);
  });
});

describe("pages publiques", () => {
  it("affichent la santé du service et les pages exigées par Meta", async () => {
    const { base } = await preparer();
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: "ok" });
    const confidentialite = await (await fetch(`${base}/confidentialite`)).text();
    assert.match(confidentialite, /Boutique Test/);
    assert.match(confidentialite, /2013-015/);
    const suppression = await (await fetch(`${base}/suppression-donnees`)).text();
    assert.match(suppression, /SUPPRIMER MES DONNÉES/);
  });
});
