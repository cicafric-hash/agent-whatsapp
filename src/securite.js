// Vérifications cryptographiques : signature des webhooks Meta et comparaisons à temps constant.
import crypto from "node:crypto";

/**
 * Vérifie l'en-tête X-Hub-Signature-256 envoyé par Meta :
 * « sha256= » suivi du HMAC SHA-256 (en hexadécimal) du corps brut, calculé avec la clé secrète de l'application.
 */
export function signatureValide(corpsBrut, entete, cleSecrete) {
  if (typeof entete !== "string" || !entete.startsWith("sha256=")) return false;
  const hex = entete.slice("sha256=".length).trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const recue = Buffer.from(hex, "hex");
  const attendue = crypto.createHmac("sha256", cleSecrete).update(corpsBrut).digest();
  return crypto.timingSafeEqual(recue, attendue);
}

/** Compare deux textes sans révéler, par le temps de réponse, à quel endroit ils diffèrent. */
export function egaliteSure(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Jeton anti-falsification des formulaires de /admin, dérivé du mot de passe. */
export function jetonFormulaire(motDePasse) {
  return crypto.createHmac("sha256", String(motDePasse)).update("formulaires-admin").digest("hex");
}
