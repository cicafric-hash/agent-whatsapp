// Tests des petits outils : mise en forme, signature, connaissances, client WhatsApp.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { fusionnerTours } from "../src/agent.js";
import { chargerConnaissances, extraireNomEntreprise } from "../src/connaissances.js";
import { lireConfig } from "../src/config.js";
import {
  chiffresSeulement,
  decouper,
  estDemandeSuppression,
  formaterMontant,
  formaterNumero,
  formaterPourWhatsApp,
} from "../src/format.js";
import {
  definitionModeleAlerte,
  parametreModele,
  parametresAlerte,
  resumerStatutModele,
  TEXTE_MODELE_ALERTE,
} from "../src/modele-alerte.js";
import { signatureValide } from "../src/securite.js";
import { ErreurWhatsApp, WhatsApp } from "../src/whatsapp.js";

describe("modèle de message d'alerte", () => {
  it("respecte les règles de Meta : texte fixe au début et à la fin, un exemple par variable", () => {
    const definition = definitionModeleAlerte("alerte_agent", "fr");
    assert.equal(definition.category, "UTILITY");
    const corps = definition.components[0];
    assert.equal(corps.type, "BODY");
    assert.equal(corps.text, TEXTE_MODELE_ALERTE);
    assert.equal(/^\{\{|\}\}$/.test(corps.text.trim()), false);
    assert.deepEqual(corps.text.match(/\{\{\d+\}\}/g), ["{{1}}", "{{2}}"]);
    assert.equal(corps.example.body_text[0].length, 2);
  });

  it("nettoie les variables : pas de retour à la ligne, pas d'espaces en série, pas de point final", () => {
    assert.equal(parametreModele("Ligne 1\nLigne 2\t\tfin.   ", 100), "Ligne 1 · Ligne 2 · fin");
    assert.equal(parametreModele("a      b", 100), "a b");
    assert.equal(parametreModele("", 100), "-");
    assert.equal(parametreModele("x".repeat(200), 50).length, 50);
    assert.deepEqual(parametresAlerte({ titre: "Nouvelle pré-inscription PRE-1", lignes: ["Filière : Droit", "Ville : Kati"] }), [
      "nouvelle pré-inscription PRE-1",
      "Filière : Droit · Ville : Kati",
    ]);
  });

  it("résume le statut renvoyé par Meta en français", () => {
    assert.match(resumerStatutModele("alerte_agent", { data: [{ name: "alerte_agent", status: "PENDING", language: "fr" }] }), /en cours d'examen/);
    assert.match(resumerStatutModele("alerte_agent", { data: [] }), /Aucun modèle/);
  });
});

describe("mise en forme", () => {
  it("adapte le Markdown au format WhatsApp", () => {
    const texte = "# Nos prix\n\n**Bazin** : 25 000 FCFA\n* livraison rapide\n| Produit | Prix |\n| --- | --- |\n| Pagne | 5 000 |\n[Voir](https://exemple.com)";
    assert.equal(
      formaterPourWhatsApp(texte),
      "*Nos prix*\n\n*Bazin* : 25 000 FCFA\n- livraison rapide\nProduit — Prix\nPagne — 5 000\nVoir : https://exemple.com",
    );
  });

  it("découpe les textes de plus de 4 096 caractères", () => {
    const long = `${"a".repeat(3000)}\n\n${"b".repeat(3000)}`;
    const morceaux = decouper(long, 4096);
    assert.equal(morceaux.length, 2);
    assert.ok(morceaux.every((m) => m.length <= 4096));
  });

  it("normalise et affiche les numéros", () => {
    assert.equal(chiffresSeulement("0022375758670"), "22375758670");
    assert.equal(chiffresSeulement("+223 75 75 86 70"), "22375758670");
    assert.equal(formaterNumero("22375758670"), "+223 75 75 86 70");
    assert.equal(formaterMontant(51500), "51 500");
  });

  it("reconnaît la demande de suppression", () => {
    assert.equal(estDemandeSuppression("Supprimer mes données"), true);
    assert.equal(estDemandeSuppression("  SUPPRIMER MES DONNEES !"), true);
    assert.equal(estDemandeSuppression("Comment supprimer mes données ?"), false);
  });

  it("fusionne les tours d'un même rôle et commence par le client", () => {
    const tours = fusionnerTours([
      { role: "assistant", content: "Bonjour" },
      { role: "user", content: "a" },
      { role: "user", content: [{ type: "text", text: "b" }] },
      { role: "assistant", content: "c" },
    ]);
    assert.deepEqual(tours, [
      { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      { role: "assistant", content: [{ type: "text", text: "c" }] },
    ]);
  });
});

describe("signature des webhooks", () => {
  it("accepte la bonne signature et refuse les autres", () => {
    const corps = Buffer.from('{"object":"whatsapp_business_account"}');
    const bonne = `sha256=${crypto.createHmac("sha256", "secret").update(corps).digest("hex")}`;
    assert.equal(signatureValide(corps, bonne, "secret"), true);
    assert.equal(signatureValide(corps, bonne, "autre"), false);
    assert.equal(signatureValide(corps, "sha256=abc", "secret"), false);
    assert.equal(signatureValide(corps, undefined, "secret"), false);
  });
});

describe("configuration et connaissances", () => {
  it("signale les variables obligatoires manquantes", () => {
    assert.throws(() => lireConfig({}), /ANTHROPIC_API_KEY, WHATSAPP_TOKEN/);
  });

  it("applique les valeurs par défaut", () => {
    const config = lireConfig({
      ANTHROPIC_API_KEY: "a",
      WHATSAPP_TOKEN: "b",
      WHATSAPP_PHONE_NUMBER_ID: "c",
      WHATSAPP_VERIFY_TOKEN: "d",
      WHATSAPP_APP_SECRET: "e",
      ADMIN_PASSWORD: "f",
      OWNER_WHATSAPP: "+223 75 75 86 70",
      GRAPH_API_VERSION: "26.0",
      PORT: "0",
    });
    assert.equal(config.modele, "claude-opus-5-5");
    assert.equal(config.graphVersion, "v26.0");
    assert.equal(config.proprietaire, "22375758670");
    assert.equal(config.fuseau, "Africa/Bamako");
    assert.equal(config.port, 0);
    assert.equal(config.modeleAlerte, "alerte_agent");
    assert.equal(config.langueModeleAlerte, "fr");
  });

  it("désactive le modèle d'alerte avec MODELE_ALERTE=aucun", () => {
    const base = { ANTHROPIC_API_KEY: "a", WHATSAPP_TOKEN: "b", WHATSAPP_PHONE_NUMBER_ID: "c", WHATSAPP_VERIFY_TOKEN: "d", WHATSAPP_APP_SECRET: "e", ADMIN_PASSWORD: "f" };
    assert.equal(lireConfig({ ...base, MODELE_ALERTE: "aucun" }).modeleAlerte, "");
    assert.equal(lireConfig({ ...base, MODELE_ALERTE: "mon_alerte" }).modeleAlerte, "mon_alerte");
  });

  it("construit le prompt système à partir de la fiche EUTG et des consignes", () => {
    const connaissances = chargerConnaissances();
    assert.match(connaissances.systeme, /<consignes>[\s\S]*conseiller d'orientation et d'admission de l'EUTG[\s\S]*<\/consignes>/);
    assert.match(connaissances.systeme, /<fiche_entreprise>[\s\S]*Concours de bourses d'excellence 2026-2027[\s\S]*<\/fiche_entreprise>/);
    assert.equal(connaissances.nomEntreprise, "Université d'Excellence EUTG (École Universitaire de Technologie et de Gestion)");
    assert.equal(connaissances.avertissements.length, 1, "seul l'avertissement « à compléter » doit rester");
    assert.match(connaissances.avertissements[0], /\[à compléter\]/);
  });

  it("ne donne aucun montant de frais dans la fiche EUTG", () => {
    const { fiche } = chargerConnaissances();
    assert.equal(/\d[\d\s]*(F\s?CFA|FCFA)/i.test(fiche), false, "la fiche ne doit contenir aucun montant en FCFA tant que l'EUTG ne l'a pas fourni");
  });

  it("lit le nom de l'entreprise dans la fiche", () => {
    assert.equal(extraireNomEntreprise("- Nom de l'entreprise : Boutique Awa Mode"), "Boutique Awa Mode");
    assert.equal(extraireNomEntreprise("- Nom de l'entreprise : [ex. Boutique]"), null);
  });
});

describe("client WhatsApp", () => {
  function fauxFetch(reponses) {
    const appels = [];
    const fetchImpl = async (url, options) => {
      appels.push({ url, options });
      const { status = 200, corps } = reponses.shift();
      return new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });
    };
    return { appels, fetchImpl };
  }

  it("envoie un texte au bon numéro, avec le token", async () => {
    const { appels, fetchImpl } = fauxFetch([{ corps: { messages: [{ id: "wamid.1" }] } }]);
    const whatsapp = new WhatsApp({ token: "EAA", phoneNumberId: "111", version: "v26.0", fetchImpl });
    await whatsapp.envoyerTexte({ telephone: "22375758670" }, "Bonjour");
    assert.equal(appels[0].url, "https://graph.facebook.com/v26.0/111/messages");
    assert.equal(appels[0].options.headers.Authorization, "Bearer EAA");
    assert.deepEqual(JSON.parse(appels[0].options.body), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "22375758670",
      type: "text",
      text: { preview_url: false, body: "Bonjour" },
    });
  });

  it("écrit par identifiant WhatsApp quand le numéro est inconnu", async () => {
    const { appels, fetchImpl } = fauxFetch([{ corps: { messages: [{ id: "wamid.2" }] } }]);
    const whatsapp = new WhatsApp({ token: "EAA", phoneNumberId: "111", fetchImpl });
    await whatsapp.envoyerTexte({ telephone: null, userId: "ML.123" }, "Bonjour");
    const corps = JSON.parse(appels[0].options.body);
    assert.equal(corps.recipient, "ML.123");
    assert.equal("to" in corps, false);
  });

  it("transforme les erreurs de Meta en ErreurWhatsApp avec leur code", async () => {
    const { fetchImpl } = fauxFetch([
      { status: 400, corps: { error: { message: "Re-engagement message", code: 131047, error_data: { details: "plus de 24 h" } } } },
    ]);
    const whatsapp = new WhatsApp({ token: "EAA", phoneNumberId: "111", fetchImpl });
    await assert.rejects(whatsapp.envoyerTexte({ telephone: "22375758670" }, "Bonjour"), (err) => {
      assert.ok(err instanceof ErreurWhatsApp);
      assert.equal(err.code, 131047);
      assert.match(err.resume, /131047.*plus de 24 h/);
      return true;
    });
  });

  it("enregistre le numéro avec le code PIN", async () => {
    const { appels, fetchImpl } = fauxFetch([{ corps: { success: true } }]);
    const whatsapp = new WhatsApp({ token: "EAA", phoneNumberId: "111", fetchImpl });
    await whatsapp.enregistrerNumero("123456");
    assert.equal(appels[0].url, "https://graph.facebook.com/v26.0/111/register");
    assert.deepEqual(JSON.parse(appels[0].options.body), { messaging_product: "whatsapp", pin: "123456" });
  });

  it("envoie un modèle de message avec ses variables", async () => {
    const { appels, fetchImpl } = fauxFetch([{ corps: { messages: [{ id: "wamid.3" }] } }]);
    const whatsapp = new WhatsApp({ token: "EAA", phoneNumberId: "111", fetchImpl });
    await whatsapp.envoyerModele({ telephone: "22377254035" }, { nom: "alerte_agent", langue: "fr", parametres: ["objet", "détails"] });
    assert.equal(appels[0].url, "https://graph.facebook.com/v26.0/111/messages");
    assert.deepEqual(JSON.parse(appels[0].options.body), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "22377254035",
      type: "template",
      template: {
        name: "alerte_agent",
        language: { code: "fr" },
        components: [{ type: "body", parameters: [{ type: "text", text: "objet" }, { type: "text", text: "détails" }] }],
      },
    });
  });

  it("crée le modèle et lit son statut sur le compte WhatsApp Business", async () => {
    const { appels, fetchImpl } = fauxFetch([{ corps: { id: "1", status: "PENDING" } }, { corps: { data: [] } }]);
    const whatsapp = new WhatsApp({ token: "EAA", phoneNumberId: "111", wabaId: "222", fetchImpl });
    await whatsapp.creerModele(definitionModeleAlerte("alerte_agent", "fr"));
    assert.equal(appels[0].url, "https://graph.facebook.com/v26.0/222/message_templates");
    assert.equal(appels[0].options.method, "POST");
    assert.equal(JSON.parse(appels[0].options.body).name, "alerte_agent");
    await whatsapp.statutModele("alerte_agent");
    assert.equal(appels[1].url, "https://graph.facebook.com/v26.0/222/message_templates?name=alerte_agent");
    assert.equal(appels[1].options.method, "GET");
  });

  it("demande WHATSAPP_BUSINESS_ACCOUNT_ID pour gérer les modèles", () => {
    const whatsapp = new WhatsApp({ token: "EAA", phoneNumberId: "111", fetchImpl: async () => new Response("{}") });
    assert.throws(() => whatsapp.creerModele({}), /WHATSAPP_BUSINESS_ACCOUNT_ID/);
  });
});
