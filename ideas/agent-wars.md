# Agent Wars — PvP de stratégies IA

## Pitch
Tu défies quelqu'un. Vous misez chacun 10$. Vos agents tradent en simulation sur de vrais prix de marché (BTC, ETH via oracle) pendant 24h. À la fin, un circuit GC compare les deux performances sans jamais révéler les trades de l'autre. Le gagnant prend tout. Trustless, automatique.

## Pourquoi ça marche sur COTI sans DeFi
Les agents font du paper trading sur de vrais prix — pas besoin de liquidité. Le seul vrai token c'est la mise en COTI tokens. Tout le reste est simulation vérifiable on-chain.

## Pourquoi la privacy est indispensable
Sans COTI, ton adversaire voit tes trades en temps réel et contre-trade exactement l'opposé. Avec GC, les stratégies restent chiffrées pendant toute la bataille. Tu développes un vrai edge que personne peut copier.

## Pourquoi c'est viral
"Mon IA vs ton IA, 10$, 24h." Immédiatement compréhensible. Les gens veulent naturellement prouver que leur agent est meilleur.

## Mécanique
1. Player A crée un duel, mise 10$ en COTI tokens
2. Player B accepte, mise 10$
3. Les deux agents reçoivent les mêmes conditions de départ (capital virtuel identique, mêmes assets disponibles)
4. Chaque agent soumet ses trades via COTI messaging (chiffrés)
5. Oracle de prix résout les positions en continu
6. À la fin de la période : GC compare les deux portfolios virtuels ("qui a le PnL le plus élevé ?") sans révéler les montants ni les trades individuels
7. Smart contract envoie les 20$ au gagnant automatiquement

## Stack COTI utilisé
- **Garbled Circuits** : comparaison finale des performances sans révéler les stratégies
- **coti-agent-messaging** : soumission chiffrée des trades pendant la bataille
- **Private ERC-20** : gestion des mises et du paiement
- **Private NFT** : réputation des agents gagnants (leaderboard)
- **MCP** : `submit_trade(asset, side, size)`, `get_battle_status()`, `claim_winnings()`

## Extensions
- Tournois : bracket éliminatoire 8/16 agents
- Spectateurs : suivre la bataille sans voir les stratégies
- Leaderboard : les meilleurs agents gagnent un Private NFT de réputation
- Multi : 5+ agents, last man standing prend tout
- Handicap : agents avec différents niveaux de capital de départ

## Monétisation
- 5% des mises pris par le protocole
- Private NFT de réputation vendus/échangeables
- Accès premium aux tournois

## Architecture 60 jours
- Semaines 1-2 : smart contract de matchmaking, staking, payout
- Semaines 3-4 : intégration oracle de prix (prix réels BTC/ETH)
- Semaines 5-6 : système de soumission de trades chiffrés via COTI messaging
- Semaines 7-8 : circuit GC pour comparaison de performance finale
- Semaines 9-10 : frontend matchmaking + suivi de bataille en temps réel
- Semaines 11-12 : démo, polish, deploy mainnet

## Pourquoi ça gagne le hackathon
- Demo spectaculaire : deux agents Claude en battle en temps réel
- Privacy indispensable : sans GC le concept ne fonctionne pas
- Aucun DeFi requis sur COTI
- Viral et fun : "mon IA vs ton IA"
- Monétisation claire dès le jour 1
