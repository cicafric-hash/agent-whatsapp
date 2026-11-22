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
    name: "enregistrer_preinscription",
    description:
      "Enregistre la pré-inscription d'un prospect et prévient l'équipe des admissions. À appeler une seule fois par prospect, " +
      "uniquement après lui avoir récapitulé son nom, la filière, le niveau d'entrée, le rythme, son dernier diplôme, sa ville " +
      "et son intérêt pour le concours de bourses, ET après sa confirmation explicite. La filière doit figurer dans la fiche.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        nom_complet: { type: "string", description: "Nom et prénom du prospect." },
        filiere: { type: "string", description: "Filière choisie, telle qu'elle est écrite dans la fiche." },
        niveau_entree: {
          type: "string",
          enum: ["Licence 1", "Licence 2", "Licence 3", "Master 1", "Master 2", "À déterminer"],
          description: "Niveau d'entrée souhaité.",
        },
        rythme: {
          type: "string",
          enum: ["Jour", "Soir", "En ligne", "À déterminer"],
          description: "Rythme de cours souhaité.",
        },
        dernier_diplome: {
          type: "string",
          description: "Dernier diplôme obtenu ou en préparation, avec la série et l'année si connues (ex. « Bac TSE 2026 », « BTS Comptabilité »).",
        },
        ville: { type: "string", description: "Ville ou quartier du prospect." },
        concours_bourses: { type: "boolean", description: "Vrai si le prospect veut passer le concours de bourses d'excellence." },
        telephone: {
          type: "string",
          description: "Autre numéro à rappeler s'il diffère du numéro WhatsApp, sinon chaîne vide.",
        },
        remarques: {
          type: "string",
          description: "Précisions utiles (questions en suspens, disponibilité pour un appel…), sinon chaîne vide.",
        },
      },
      required: [
        "nom_complet",
        "filiere",
        "niveau_entree",
        "rythme",
        "dernier_diplome",
        "ville",
        "concours_bourses",
        "telephone",
        "remarques",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "demander_un_humain",
    description:
      "Confie la conversation à un conseiller de l'équipe : tu ne réponds plus à cette personne et l'équipe est prévenue. " +
      "À utiliser si la personne demande à parler à quelqu'un, si elle est mécontente ou si sa demande sort de la fiche.",
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
