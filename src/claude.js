// Appels à l'API Claude (SDK officiel @anthropic-ai/sdk) : rédaction des réponses et outils de l'agent.
import Anthropic from "@anthropic-ai/sdk";

/**
 * Modèles qui acceptent le repli côté serveur (« fallbacks ») : si le modèle refuse une demande,
 * l'API la confie automatiquement au modèle de secours recommandé par Anthropic.
 * Claude Haiku 5.5 n'a pas de repli côté serveur : le paramètre n'est donc pas envoyé pour lui.
 */
export const MODELES_AVEC_REPLI = new Set([
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5",
  "claude-fable-5-2",
  "claude-fable-5-1",
]);

const BETA_REPLI = "server-side-fallback-2026-07-01";
const MAX_TOURS_OUTILS = 5;

export const OUTILS = [
  {
    name: "enregistrer_commande",
    description:
      "Enregistre une commande ferme et prévient le propriétaire. À appeler une seule fois par commande, " +
      "uniquement après avoir récapitulé au client les articles, quantités, prix, frais de livraison, total, " +
      "adresse et mode de paiement, ET après sa confirmation explicite. Utilise seulement les produits et les prix de la fiche entreprise.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        nom_client: { type: "string", description: "Nom du client." },
        articles: {
          type: "array",
          description: "Articles commandés.",
          items: {
            type: "object",
            properties: {
              produit: { type: "string", description: "Nom du produit, tel qu'il est écrit dans la fiche." },
              quantite: { type: "integer", description: "Quantité commandée." },
              prix_unitaire: { type: "number", description: "Prix unitaire en FCFA, tiré de la fiche." },
            },
            required: ["produit", "quantite", "prix_unitaire"],
            additionalProperties: false,
          },
        },
        frais_livraison: { type: "number", description: "Frais de livraison en FCFA, 0 s'il n'y en a pas." },
        total: { type: "number", description: "Total à payer en FCFA, livraison comprise." },
        adresse_ou_quartier: {
          type: "string",
          description: "Adresse, quartier ou ville de livraison, ou « retrait en boutique ».",
        },
        mode_paiement: { type: "string", description: "Mode de paiement choisi par le client." },
        telephone: {
          type: "string",
          description: "Numéro à appeler pour la livraison s'il diffère du numéro WhatsApp, sinon chaîne vide.",
        },
        remarques: {
          type: "string",
          description: "Précisions utiles (taille, couleur, horaire de livraison…), sinon chaîne vide.",
        },
      },
      required: [
        "nom_client",
        "articles",
        "frais_livraison",
        "total",
        "adresse_ou_quartier",
        "mode_paiement",
        "telephone",
        "remarques",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "demander_un_humain",
    description:
      "Confie la conversation à une personne de l'entreprise : tu ne réponds plus à ce client et le propriétaire est prévenu. " +
      "À utiliser si le client demande à parler à quelqu'un, s'il est mécontent ou si sa demande sort de la fiche entreprise.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        motif: { type: "string", description: "Raison du transfert, en une phrase." },
      },
      required: ["motif"],
      additionalProperties: false,
    },
  },
];

export function creerClientClaude(apiKey) {
  // Le SDK réessaie seul les erreurs passagères (surcharge, limite de débit, coupure réseau).
  return new Anthropic({ apiKey, maxRetries: 3, timeout: 120 * 1000 });
}

/** Paramètres d'une requête : prompt système et conversation mis en cache, réflexion adaptative par défaut, effort bas. */
export function parametresRequete({ modele, systeme, messages }) {
  const parametres = {
    model: modele,
    max_tokens: 16000,
    system: [{ type: "text", text: systeme, cache_control: { type: "ephemeral" } }],
    cache_control: { type: "ephemeral" },
    tools: OUTILS,
    messages,
    output_config: { effort: "low" },
  };
  if (MODELES_AVEC_REPLI.has(modele)) {
    parametres.betas = [BETA_REPLI];
    parametres.fallbacks = "default";
  }
  return parametres;
}

/**
 * Fait rédiger la réponse par Claude, en exécutant les outils qu'il appelle.
 * `messages` : historique en texte seul, terminé par le message du client.
 * Pendant les appels d'outils, le contenu de l'assistant est renvoyé tel quel, sans modification.
 */
export async function genererReponse({ client, modele, systeme, messages, executerOutil }) {
  const echanges = [...messages];
  for (let tour = 0; tour < MAX_TOURS_OUTILS; tour += 1) {
    const reponse = await client.beta.messages.create(parametresRequete({ modele, systeme, messages: echanges }));

    if (reponse.stop_reason === "refusal") {
      return { statut: "refus", texte: "", categorie: reponse.stop_details?.category ?? null, usage: reponse.usage };
    }

    const appels = reponse.content.filter((bloc) => bloc.type === "tool_use");
    if (reponse.stop_reason === "tool_use" && appels.length > 0) {
      echanges.push({ role: "assistant", content: reponse.content });
      const resultats = [];
      for (const appel of appels) {
        const resultat = await executerOutil(appel.name, appel.input);
        resultats.push({
          type: "tool_result",
          tool_use_id: appel.id,
          content: resultat.texte,
          ...(resultat.erreur ? { is_error: true } : {}),
        });
      }
      echanges.push({ role: "user", content: resultats });
      continue;
    }

    if (reponse.stop_reason === "pause_turn") {
      echanges.push({ role: "assistant", content: reponse.content });
      continue;
    }

    const texte = reponse.content
      .filter((bloc) => bloc.type === "text")
      .map((bloc) => bloc.text)
      .join("\n")
      .trim();
    return { statut: "ok", texte, stopReason: reponse.stop_reason, modele: reponse.model, usage: reponse.usage };
  }
  return { statut: "trop_d_outils", texte: "" };
}

/** Explication en français d'une erreur de l'API Claude, pour le journal. */
export function expliquerErreurClaude(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Clé API Claude refusée (401) : vérifiez ANTHROPIC_API_KEY sur Render.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Accès refusé par l'API Claude (403) : vérifiez la clé et l'accès au modèle choisi.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Modèle introuvable (404) : vérifiez la valeur de CLAUDE_MODEL.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de débit de l'API Claude atteinte (429) : réessayez plus tard ou vérifiez vos limites sur platform.claude.com.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Requête refusée par l'API Claude (400) : ${err.message}. Si le message parle de « credit balance », rechargez vos crédits.`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Impossible de joindre l'API Claude (problème réseau).";
  }
  if (err instanceof Anthropic.APIError) {
    return `Erreur de l'API Claude (${err.status ?? "?"}) : ${err.message}`;
  }
  return `Erreur inattendue pendant l'appel à Claude : ${err?.message ?? err}`;
}
