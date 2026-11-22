// Vérifie que le serveur démarre avec des variables factices, répond sur /health et s'arrête proprement.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENV_FACTICE = {
  ANTHROPIC_API_KEY: "sk-ant-factice",
  WHATSAPP_TOKEN: "EAA-factice",
  WHATSAPP_PHONE_NUMBER_ID: "111111111111111",
  WHATSAPP_VERIFY_TOKEN: "jeton-factice",
  WHATSAPP_APP_SECRET: "secret-factice",
  ADMIN_PASSWORD: "mot-de-passe-factice-long",
  PORT: "0",
};

function lancer(env) {
  return spawn(process.execPath, ["src/server.js"], {
    cwd: RACINE,
    env: { PATH: process.env.PATH, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("démarrage du serveur", () => {
  it("démarre, répond sur /health puis s'arrête proprement", async () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "agent-demarrage-"));
    const processus = lancer({ ...ENV_FACTICE, DATA_DIR: dossier });
    try {
      const port = await new Promise((resoudre, rejeter) => {
        let sortie = "";
        const minuteur = setTimeout(() => rejeter(new Error(`Pas de démarrage : ${sortie}`)), 15000);
        processus.stdout.on("data", (morceau) => {
          sortie += morceau;
          const trouve = sortie.match(/démarré sur le port (\d+)/);
          if (trouve) {
            clearTimeout(minuteur);
            resoudre(Number(trouve[1]));
          }
        });
        processus.on("exit", (code) => rejeter(new Error(`Arrêt inattendu (code ${code}) : ${sortie}`)));
      });
      const reponse = await fetch(`http://127.0.0.1:${port}/health`);
      assert.deepEqual(await reponse.json(), { status: "ok" });

      const code = await new Promise((resoudre) => {
        processus.removeAllListeners("exit");
        processus.on("exit", resoudre);
        processus.kill("SIGTERM");
      });
      assert.equal(code, 0);
    } finally {
      processus.kill("SIGKILL");
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  });

  it("refuse de démarrer sans les variables obligatoires et dit lesquelles manquent", async () => {
    const processus = lancer({ PORT: "0" });
    let erreurs = "";
    processus.stderr.on("data", (morceau) => {
      erreurs += morceau;
    });
    const code = await new Promise((resoudre) => processus.on("exit", resoudre));
    assert.equal(code, 1);
    assert.match(erreurs, /ANTHROPIC_API_KEY/);
    assert.match(erreurs, /ADMIN_PASSWORD/);
  });
});
