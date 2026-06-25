# Private Collective Intelligence — Signal Protocol

## Pitch
Un protocole où des agents AI soumettent des prédictions de marché chiffrées. Les Garbled Circuits agrègent les prédictions sans qu'aucun agent ne voie celles des autres. L'agrégat résultant est vendu comme signal premium.

## L'insight clé
La privacy ne protège pas juste les stratégies — elle rend la prédiction collective structurellement plus précise.

Dans tous les prediction markets publics (Polymarket, Numerai), les agents se herdent : tu vois le gros wallet bet sur BTC, tu copies. Résultat : les prédictions convergent, l'agrégat est biaisé.

La wisdom of crowds ne fonctionne que si les prédictions sont **indépendantes**. Dès qu'elles sont visibles, elles ne le sont plus.

Avec COTI + GC : indépendance garantie cryptographiquement. L'agrégat est structurellement meilleur que tout ce qui existe.

## Comparaison
- **Numerai** : même concept mais centralisé — Numerai voit toutes les prédictions
- **Polymarket** : tout est public, herding massif
- **Ce projet** : zéro partie centrale ne voit les prédictions individuelles. Le GC est le seul juge.

## Mécanique

1. Des agents AI soumettent des prédictions chiffrées sur des actifs (BTC, ETH, etc.)
2. GC calcule l'agrégat pondéré par réputation — sans révéler les prédictions individuelles
3. L'oracle résout les outcomes
4. Les agents qui ont raison accumulent de la réputation → plus de poids dans l'agrégat → plus de revenus
5. L'agrégat est vendu comme signal à des institutions, fonds, protocoles DeFi
6. Les déposants dans la pool gagnent une part des fees de vente du signal

## Business model
- Fees sur la vente du signal agrégé (institutions, fonds)
- Performance fees sur les agents gagnants
- Pas besoin de DeFi sur COTI — le yield vient de la vente du signal

## Stack COTI utilisé
- **Garbled Circuits** : agrégation des prédictions sans révéler les inputs
- **Private ERC-20** : dépôts et récompenses avec balances chiffrées
- **coti-agent-messaging** : soumission chiffrée des prédictions
- **Private NFT** : réputation des agents (score accumulé)
- **MCP** : `submit_prediction()`, `get_aggregate_signal()`, `get_agent_score()`

## Architecture 60 jours
- Semaines 1-2 : contrat de pool + soumission de prédictions chiffrées
- Semaines 3-4 : circuit GC pour agrégation pondérée
- Semaines 5-6 : système de réputation (Private NFT)
- Semaines 7-8 : oracle de résolution + distribution des rewards
- Semaines 9-10 : 3 agents Claude en compétition live (démo)
- Semaines 11-12 : frontend leaderboard (scores sans prédictions), mainnet

## Pourquoi ça gagne
- Impossible sur une chaîne publique (herding inévitable)
- COTI est la seule chaîne où le GC permet une vraie agrégation privée
- Business model réel post-hackathon (vente de signal)
- "Bloomberg terminal des agents IA" — pitch clair pour les juges et les investisseurs
