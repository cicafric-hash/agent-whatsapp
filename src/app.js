// Application web (Express) : webhook WhatsApp, pages publiques et administration.
import express from "express";
import { creerRouteurAdmin } from "./admin.js";
import { pageAccueil, pageConfidentialite, pageSuppressionDonnees } from "./pages.js";
import { egaliteSure, signatureValide } from "./securite.js";

const MINUTE = 60 * 1000;

export function creerApp({ config, stockage, agent, whatsapp, connaissances }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Render place un proxy HTTPS devant l'application : on lui fait confiance, pas au client

  let dernierAvertissementSignature = 0;

  app.get("/", (req, res) => res.send(pageAccueil(connaissances.nomEntreprise)));
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.get("/confidentialite", (req, res) => res.send(pageConfidentialite(connaissances.nomEntreprise)));
  app.get("/suppression-donnees", (req, res) => res.send(pageSuppressionDonnees(connaissances.nomEntreprise)));

  // Vérification du webhook par Meta (bouton « Verify and save »).
  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const jeton = req.query["hub.verify_token"];
    const defi = req.query["hub.challenge"];
    if (mode === "subscribe" && typeof jeton === "string" && typeof defi === "string" && egaliteSure(jeton, config.verifyToken)) {
      stockage.journaliser("info", "Webhook vérifié par Meta.");
      return res.status(200).type("text/plain").send(defi);
    }
    if (mode === "subscribe") {
      stockage.journaliser("avertissement", "Vérification du webhook refusée : le jeton ne correspond pas à WHATSAPP_VERIFY_TOKEN.");
    }
    return res.sendStatus(403);
  });

  // Réception des messages : signature vérifiée, réponse 200 immédiate, traitement en arrière-plan.
  app.post("/webhook", express.raw({ type: () => true, limit: "5mb" }), (req, res) => {
    const corps = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!signatureValide(corps, req.get("x-hub-signature-256"), config.appSecret)) {
      if (Date.now() - dernierAvertissementSignature > MINUTE) {
        dernierAvertissementSignature = Date.now();
        stockage.journaliser(
          "avertissement",
          "Webhook refusé : signature invalide.",
          "Si cela concerne vos vrais messages, vérifiez que WHATSAPP_APP_SECRET est bien la clé secrète de votre application Meta.",
        );
      }
      return res.sendStatus(401);
    }
    let donnees;
    try {
      donnees = JSON.parse(corps.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }
    res.sendStatus(200);
    agent.traiterWebhook(donnees);
  });

  app.use("/admin", creerRouteurAdmin({ config, stockage, agent, whatsapp, connaissances }));

  app.use((req, res) => res.status(404).type("text/plain; charset=utf-8").send("Page introuvable."));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, suivant) => {
    stockage.journaliser("erreur", `Erreur du serveur sur ${req.method} ${req.path}`, err?.stack ?? String(err));
    if (!res.headersSent) res.status(500).type("text/plain; charset=utf-8").send("Erreur interne. Consultez le journal.");
  });

  return app;
}
