# agent-whatsapp

agent-whatsapp joue le rôle commercial de l'EUTG pour répondre automatiquement aux requêtes des prospects.

Cet agent répond aux prospects de l'EUTG sur WhatsApp, 24 h/24 : il les oriente vers une formation, explique l'admission et les bourses, puis enregistre leur pré-inscription. Il utilise l'API WhatsApp Cloud de Meta et l'API Claude d'Anthropic, et s'héberge sur Render.

## Ce que fait l'agent

- Il répond aux messages texte, aux boutons, aux positions partagées et aux photos (il les voit).
- Il demande poliment d'écrire quand il reçoit un message vocal, une vidéo ou un document.
- Il attend 3 secondes de silence et répond en une seule fois aux messages envoyés à la suite.
- Il enregistre les pré-inscriptions confirmées par les prospects et vous envoie une alerte sur WhatsApp.
- Il ne donne jamais de montant de frais : la grille n'est pas publiée, il propose qu'un conseiller l'envoie.
- Il passe la main à un conseiller quand le prospect le demande ou quand la demande sort de la fiche. Vous répondez alors depuis la page `/admin`.
- Il efface les données d'une personne qui lui écrit « SUPPRIMER MES DONNÉES ».
- Il traite au plus 30 messages par personne et par heure, pour éviter les abus.

## Ce que vous modifiez vous-même, sans coder

| Fichier | Contenu |
| --- | --- |
| `connaissances/fiche-entreprise.md` | Formations, admission, frais, bourses, contacts, questions fréquentes de l'EUTG |
| `connaissances/consignes.md` | Rôle, ton et limites de l'agent |

Pour modifier un fichier : sur GitHub, ouvrez-le, cliquez sur l'icône crayon (**Edit this file**), changez le texte, puis cliquez sur **Commit changes**. Render redéploie l'agent automatiquement en quelques minutes.

La fiche a été remplie avec les informations du site www.eutg-mali.com. Ce que le site ne publie pas (frais, moyens de paiement, dates, horaires, logement, débouchés de l'Agronomie) est marqué `[à compléter]` : l'agent répond alors qu'un conseiller précisera. Tant qu'il en reste, la page `/admin` affiche un avertissement.

## Mettre l'agent en ligne sur Render

Le fichier `render.yaml` contient déjà toute la configuration (Node, région Frankfurt, plan gratuit, commandes, contrôle de santé `/health`). Render ne vous demande que vos clés.

1. Sur [dashboard.render.com](https://dashboard.render.com), cliquez sur **New +**, puis **Blueprint**.
2. Choisissez ce dépôt. Si Render ne le voit pas, autorisez-le à accéder au dépôt sur GitHub.
3. Donnez un nom au Blueprint (par exemple agent-whatsapp), puis remplissez les 8 valeurs demandées (tableau ci-dessous).
4. Validez, puis attendez que le service `agent-whatsapp` passe au statut **Live**.
5. Ouvrez `https://VOTRE-ADRESSE.onrender.com/health` : la page doit afficher `{"status":"ok"}`.

Sans Blueprint, vous pouvez aussi créer le service à la main (**New +**, puis **Web Service**) : Language Node, Region Frankfurt, Branch main, Build Command `npm ci`, Start Command `npm start`, Health Check Path `/health`.

En production, passez en **Starter**, ajoutez un disque (**Disks** : Mount Path `/var/data`, 1 Go) et la variable `DATA_DIR` = `/var/data`. Sans disque, les conversations et les pré-inscriptions s'effacent à chaque redéploiement.

## Variables d'environnement

| Variable | Obligatoire | Où trouver la valeur |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Oui | platform.claude.com > Settings > API keys (commence par `sk-ant-`) |
| `WHATSAPP_TOKEN` | Oui | Token permanent de l'utilisateur système (Paramètres de l'entreprise Meta > Utilisateurs système) |
| `WHATSAPP_PHONE_NUMBER_ID` | Oui | Application Meta > WhatsApp > API Setup > Phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Oui | Une phrase secrète que vous inventez, à recopier dans la configuration du webhook |
| `WHATSAPP_APP_SECRET` | Oui | Application Meta > App settings > Basic > App secret |
| `ADMIN_PASSWORD` | Oui | Un mot de passe long que vous inventez, pour la page `/admin` |
| `CLAUDE_MODEL` | Non | `claude-opus-5-5` par défaut ; `claude-sonnet-5-5` ou `claude-haiku-5-5` pour réduire les coûts |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Non | Application Meta > WhatsApp > API Setup > WhatsApp Business Account ID |
| `OWNER_WHATSAPP` | Non | Numéro qui reçoit les alertes, chiffres seulement, avec l'indicatif (ex. `22375758670`) |
| `MODELE_ALERTE` | Non | `alerte_agent` par défaut : nom du modèle de message des alertes ; `aucun` pour ne jamais l'utiliser |
| `MODELE_ALERTE_LANGUE` | Non | `fr` par défaut : langue du modèle d'alerte |
| `GRAPH_API_VERSION` | Non | `v26.0` par défaut |
| `DATA_DIR` | Non | `/var/data` en production avec un disque Render |
| `FUSEAU_HORAIRE` | Non | `Africa/Bamako` par défaut |

Le fichier `.env.example` reprend cette liste. Ne mettez jamais les vraies valeurs dans GitHub.

## Brancher WhatsApp

Dans votre application Meta, ouvrez **WhatsApp > Configuration** :

1. **Callback URL** : `https://VOTRE-ADRESSE.onrender.com/webhook`
2. **Verify token** : la valeur de `WHATSAPP_VERIFY_TOKEN`
3. Cliquez sur **Verify and save**, puis abonnez-vous au champ **messages** dans **Webhook fields**.

## La page d'administration

Ouvrez `https://VOTRE-ADRESSE.onrender.com/admin`. Identifiant : `admin`. Mot de passe : la valeur de `ADMIN_PASSWORD`.

- **Conversations** : chaque prospect, ses messages, la fenêtre de 24 heures pendant laquelle WhatsApp autorise une réponse, un champ pour répondre vous-même et un bouton pour mettre l'agent en pause ou le relancer. Répondre vous-même met l'agent en pause pour ce prospect.
- **Pré-inscriptions** : les pré-inscriptions enregistrées par l'agent, avec leur référence, la filière, le niveau d'entrée, le rythme et l'intérêt pour le concours de bourses.
- **Outils** : tester la connexion WhatsApp, enregistrer votre numéro avec un code PIN à 6 chiffres, abonner l'application au compte WhatsApp, envoyer un message test au propriétaire, créer le modèle d'alerte, vérifier son statut et envoyer une alerte test avec ce modèle.

## Recevoir les alertes à tout moment

WhatsApp n'autorise un message libre vers le numéro `OWNER_WHATSAPP` que s'il a écrit à l'agent dans les 24 heures précédentes. Au-delà, l'agent utilise un modèle de message approuvé par Meta :

1. Dans `/admin`, page **Outils**, carte « Modèle de message d'alerte », cliquez sur **Créer le modèle d'alerte**.
2. Quelques minutes plus tard, cliquez sur **Vérifier son statut** : il doit indiquer `APPROVED`. L'examen par Meta peut parfois prendre jusqu'à 48 heures.
3. Cliquez sur **Envoyer une alerte test avec le modèle** : le numéro `OWNER_WHATSAPP` doit la recevoir.

Ensuite, l'agent envoie l'alerte en message libre si ce numéro a écrit depuis moins de 24 heures, et avec le modèle dans le cas contraire. Une alerte libre refusée par Meta pour cette raison est renvoyée avec le modèle. Chaque alerte envoyée avec le modèle est facturée par Meta. Les modèles appartiennent à un compte WhatsApp Business : recréez-le si `WHATSAPP_BUSINESS_ACCOUNT_ID` change, par exemple au passage du numéro de test à votre vrai numéro.
- **Journal** : les erreurs et les événements, avec un conseil pour les codes d'erreur WhatsApp courants.

## Passer en production avec votre vrai numéro

1. Ajoutez le numéro dans l'application Meta (**WhatsApp > API Setup > Add phone number**), puis mettez à jour `WHATSAPP_PHONE_NUMBER_ID` et `WHATSAPP_BUSINESS_ACCOUNT_ID` sur Render.
2. Dans `/admin`, page **Outils** : **Enregistrer le numéro** avec un code PIN que vous notez, puis **Abonner l'application**.
3. Publiez l'application Meta. Elle demande ces deux adresses :
    - politique de confidentialité : `https://VOTRE-ADRESSE.onrender.com/confidentialite`
    - suppression des données : `https://VOTRE-ADRESSE.onrender.com/suppression-donnees`
4. Ajoutez un moyen de paiement dans WhatsApp Manager : au-delà de 1 000 réponses gratuites par mois et par numéro, Meta ne livre plus les réponses sans moyen de paiement.
5. `OWNER_WHATSAPP` doit être un autre numéro que celui de l'agent.
6. Si le compte WhatsApp Business a changé, recréez le modèle d'alerte (page **Outils**) et attendez son approbation.

## Pour les développeurs

- Node.js 22 ou plus. Installation : `npm install`. Tests : `npm test` (sans réseau : Claude et Meta sont simulés).
- `src/server.js` démarre le service ; `src/app.js` définit les routes ; `src/agent.js` contient la logique (regroupement, file par client, outils, alertes) ; `src/claude.js` appelle l'API Claude ; `src/whatsapp.js` appelle l'API Graph de Meta ; `src/admin.js` produit la page d'administration ; `src/stockage.js` écrit les fichiers JSON de `DATA_DIR`.
- Appels à Claude : SDK officiel `@anthropic-ai/sdk`, réflexion adaptative par défaut, `output_config.effort` à `low`, prompt système et conversation mis en cache, repli côté serveur (`fallbacks: "default"`) pour Opus et Sonnet. L'historique envoyé à Claude ne contient que du texte : 30 messages au plus, de moins de 30 jours.
- Le webhook vérifie la signature `X-Hub-Signature-256` avec `WHATSAPP_APP_SECRET`, répond 200 tout de suite et traite les messages ensuite. Les messages déjà reçus sont ignorés pendant 48 heures.
