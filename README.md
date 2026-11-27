# Ariane Outreach

Tour de contrôle des campagnes de prospection Ariane (LinkedIn et mail, via Unipile) pour toutes les professions ciblées : avocats, experts-comptables, notaires, CGP, banquiers privés.

## Principe

1. Les contacts sont importés et dédoublonnés dans une base unique (Upstash Redis), avec des exclusions globales (« stop », clients).
2. Une campagne (audience, séquence multicanal, textes, rythme) est validée **une seule fois** ; la liste, les textes et le rythme sont alors figés.
3. Un moteur quotidien (Vercel Cron) exécute les étapes dues dans les limites LinkedIn et mail, synchronise les réponses et met en pause en cas d'anomalie.
4. La tour de contrôle affiche campagnes, entonnoir et réponses à traiter ; un miroir Google Sheet est exporté chaque nuit.

## Variables d'environnement (Vercel)

Voir `.env.example`. Aucune clé n'est stockée dans le code.

## État

- Étape 1 : base contacts, import CSV, tour de contrôle, paramètres.
- Étape 2 : concepteur de campagne, validation unique, moteur quotidien.
- Étape 3 : synchronisation Unipile, miroir Sheet, résumé quotidien.
