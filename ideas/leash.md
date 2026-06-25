# Leash — Agent Performance Competition

## Pitch
Tu mises 10$. Quelqu'un en face mise 10$. Vos agents s'affrontent sur une période définie. Chaque agent a une stratégie privée — personne ne voit les trades de l'autre pendant le duel. À la fin, le GC compare les performances et envoie les 20$ au gagnant. Trustless, automatique.

---

## Le problème que ça résout
Les agents IA de trading n'ont pas d'arène pour se mesurer sans se faire copier. Publier sa stratégie = la tuer. Les benchmarks existants (Numerai, etc.) sont centralisés — quelqu'un voit toujours tout. Il n'existe aucun endroit où deux agents peuvent s'affronter honnêtement avec des vrais enjeux, en gardant leurs stratégies secrètes.

---

## Pourquoi la privacy est indispensable
Sans GC, ton adversaire voit tes positions en temps réel et peut contre-trader exactement l'inverse. La compétition est truquée dès le départ. Avec COTI, les trades sont chiffrés pendant toute la durée du duel — impossible de copier ce qu'on ne voit pas. La stratégie est l'actif. GC protège l'actif.

---

## Pourquoi ça marche sans DeFi sur COTI
Les agents tradent en simulation sur de vrais prix de marché (BTC, ETH, SOL via oracle on-chain). Pas besoin de liquidité réelle. La seule vraie transaction c'est la mise en COTI tokens. Le reste est simulation vérifiable et trustless on-chain.

---

## Mécanique détaillée

### Création d'un duel
- Player A crée un duel : choisit la durée (1h / 6h / 24h / 7j), le montant de la mise, les assets autorisés
- Player B accepte et dépose sa mise
- Le smart contract lock les fonds

### Pendant le duel
- Les deux agents partent avec un capital virtuel identique (ex : $1000)
- Chaque agent soumet ses trades via **COTI messaging chiffré** : `{asset, side, size, timestamp}`
- Un oracle de prix (Chainlink bridgé) résout les positions en continu
- Les positions de chaque agent sont **invisibles** — même le contrat ne peut pas les lire

### Fin du duel
- Le circuit **GC** prend : historique des trades chiffrés de A + historique des trades chiffrés de B + historique des prix publics
- Il calcule les deux PnL finaux et retourne uniquement : winner + écart de performance
- Les trades individuels ne sont jamais révélés
- Le smart contract envoie automatiquement les mises au gagnant (moins 5% de frais protocole)

---

## Stack COTI utilisé

COTI a livré 8 skills avec 48+ MCP tools sur 2 serveurs. Voilà exactement ce que Leash utilise :

| Skill | Serveur | Utilisation dans Leash |
|-------|---------|------------------------|
| `coti-account-setup` | coti-mcp | Chaque agent crée son wallet + AES key au démarrage (`create_account`, `generate_aes_key`) |
| `coti-starter-grant` | coti-agent-messaging | Nouveaux agents reçoivent du COTI gratuit pour leur première mise (`request_starter_grant`) |
| `coti-private-messaging` | coti-agent-messaging | Agents soumettent leurs trades chiffrés pendant le duel (`send_message`) |
| `coti-private-erc20` | coti-mcp | Staking des mises + payout automatique au gagnant (`transfer_private_erc20`) |
| `coti-private-nft` | coti-mcp | NFT de réputation minté à chaque victoire (`mint_private_erc721_token`) |
| `coti-smart-contracts` | coti-mcp | Contrat de duel custom avec GC pour comparaison de PnL (`compile_and_deploy_contract`, `encrypt_value`) |
| `coti-transaction-tools` | coti-mcp | Debug + monitoring des duels en cours |

### Le GC pour comparer les PnL — déjà prouvé par COTI

COTI a shipé 4 démos qui prouvent exactement le pattern dont Leash a besoin :
- **Millionaires Problem** : deux valeurs chiffrées, GC retourne "A > B ?" sans révéler A ni B
- **Private Auction** : bids chiffrés, GC sélectionne le gagnant sans exposer les montants

Pour Leash : les agents calculent leur PnL final (`positions chiffrées × prix publics oracle`), soumettent via `encrypt_value`, le contrat GC retourne uniquement le gagnant. Même pattern, nouveau use case.

---

## Types de compétitions

### 1v1 Duel
Le format de base. Deux agents, une mise, un gagnant.

### Last Man Standing (multi-agents)
5 à 16 agents entrent dans la même arène avec la même mise. À chaque "round" (ex : toutes les 6h), l'agent avec le plus faible PnL est éliminé. Le dernier restant prend tout.

### Tournoi bracket
8 ou 16 agents en élimination directe. La mise totale forme le prize pool. Format le plus viral — spectateurs peuvent suivre l'avancement du bracket sans voir les stratégies.

### League hebdomadaire
Entry fee fixe, N agents compétent simultanément pendant 7 jours. Top 3 partagent le prize pool selon leur ranking final.

---

## Spectateurs
Les spectateurs voient :
- **Le PnL en temps réel de chaque agent** — courbe live du % de gain/perte depuis le début du duel
- Les deux agents, leur record de victoires (Private NFT)
- Le nombre de trades soumis par chaque agent (sans détail)
- Le chrono restant
- Des paris sur le gagnant (marché secondaire)

Les spectateurs ne voient pas :
- Les trades individuels
- Les positions actuelles (quels assets, quelle taille)
- La stratégie de quiconque

**Comment ça marche techniquement :** chaque agent publie périodiquement la valeur totale de son portfolio (pas le détail). Cette valeur est calculée depuis ses positions chiffrées × les prix publics de l'oracle. Le résultat est un seul chiffre — suffisant pour afficher la courbe de PnL, insuffisant pour reconstituer les positions. La tension monte sans que la stratégie soit exposée.

---

## Réputation & Leaderboard
Chaque victoire mint un token au Private NFT de l'agent (ELO-style). Le leaderboard public affiche :
- Le record de victoires/défaites
- Le taux de victoire
- Les gains cumulés (optionnel, privé par défaut)

Les agents avec le meilleur ELO sont invités aux tournois premium à enjeux élevés.

---

## Monétisation
- **5% de frais protocole** sur chaque mise
- **Entry fee** sur les tournois premium
- **Marché de paris** sur les duels en cours (frais sur volume)
- **Agent NFT** : les agents avec un fort track record deviennent des NFTs tradéables (leur réputation a de la valeur)

---

## Architecture 60 jours
- **Semaines 1-2** : smart contract de duel (création, staking, payout), Private ERC-20
- **Semaines 3-4** : intégration oracle de prix réels (BTC/ETH via Chainlink bridge)
- **Semaines 5-6** : système de soumission de trades chiffrés via COTI messaging + MCP tools
- **Semaines 7-8** : circuit GC pour calcul PnL + comparaison finale
- **Semaines 9-10** : frontend (création de duel, suivi en direct, leaderboard)
- **Semaines 11-12** : démo live, polish, deploy mainnet

---

## Scénario de démo hackathon
Deux instances Claude en live :
- **Agent A** : stratégie momentum (achète ce qui monte)
- **Agent B** : stratégie mean reversion (achète les dips)

Duel sur 1h en accéléré. Le public suit sans voir les positions. À la fin, GC révèle le gagnant, les fonds bougent automatiquement.

---

## Risques & mitigations
| Risque | Mitigation |
|--------|-----------|
| Résultat trop chanceux sur courte durée | Leaderboard favorise la consistance long terme |
| Agent qui tente d'inférer la stratégie adverse | GC garantit opacité totale — rien à inférer depuis les données publiques |
| Perception "gambling" | Framer comme compétition de stratégie, like chess tournaments |

---

## Autres noms envisagés
WARDEN · BASTION · AEGIS
