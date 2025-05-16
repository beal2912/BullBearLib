# Mean Reversion Strategy (meanReversion.js)


## 1. Concept
La stratégie de "Mean Reversion" (Retour à la Moyenne) est basée sur l'hypothèse que les prix des actifs financiers ont tendance à revenir vers leur valeur moyenne historique ou une moyenne mobile après s'en être éloignés de manière significative. Cette stratégie cherche à identifier les conditions de surachat ou de survente d'un actif pour initier des positions anticipant une correction.

## 2. Indicateurs Techniques
- **Relative Strength Index (RSI)**:
  - Période: 14
  - Utilisé pour identifier les niveaux de surachat (RSI > 70) et de survente (RSI < 30).
- **Prix Historiques**: Nécessaires pour le calcul du RSI. Actuellement simulés dans `getPriceHistory()`.

## 3. Logique de Position
- **Déclencheurs d'Entrée**:
  - **Signal Long**: Ouverture d'une position longue lorsque le RSI(14) passe en dessous de 30.
  - **Signal Short**: Ouverture d'une position courte lorsque le RSI(14) passe au-dessus de 70.
- **Taille de Position**:
  - Collatéral: Un montant fixe de 10.1 USDC est utilisé par trade (`CONFIG.COLLATERAL`).
  - Pourcentage: La position utilise 100% du collatéral alloué (`percent: "1.0"`).
- **Approche de Levier**:
  - Levier par défaut: 2x (`CONFIG.LEVERAGE`).
  - Ajustement: Le levier est plafonné au levier maximum autorisé pour l'actif concerné, récupéré via `getMaxLeverages()`. Le levier effectif est `min(CONFIG.LEVERAGE, maxLeverageForMarket)`.
- **Critères de Sortie et Fréquence de Vérification**:
  Les positions ouvertes sont surveillées à chaque exécution du script.
  - **Stop-Loss**: Fermeture si la perte non réalisée atteint -5%.
  - **Take-Profit**: Fermeture si le gain non réalisé atteint +5%.
  - **Temps de Maintien Maximum**: Fermeture automatique si une position reste ouverte plus de 6 heures.

## 4. Gestion des Risques et de l'État
- **Persistance de l'État**:
  - Les positions ouvertes, leurs détails (prix d'entrée, levier, heure d'ouverture), et la liste noire des marchés sont sauvegardés dans `CACHE_DIR/meanReversion.json`.
  - La cache est chargée au démarrage et sauvegardée après chaque modification significative (ouverture/fermeture de position, ajout à la liste noire).
- **Liste Noire (Blacklist)**:
  - Un marché est ajouté à la liste noire si une erreur contractuelle se produit lors de la tentative d'ouverture ou de fermeture d'une position sur ce marché.
  - Les marchés sur la liste noire sont ignorés lors des cycles suivants d'exécution de la stratégie.
- **Gestion des Erreurs**:
  - Les erreurs de transaction (par ex., "account sequence mismatch") sont loguées. Un délai de 20 secondes est ajouté avant d'ouvrir une position.
  - Les erreurs lors de l'interaction avec les contrats pour un marché spécifique peuvent conduire à l'ajout de ce marché à la liste noire.
- **Journalisation (Logging)**:
  - Utilisation de `chalk` pour des logs colorés et lisibles.
  - Journalisation des étapes clés: signaux détectés, tentatives d'ouverture/fermeture de positions, erreurs, PnL des positions.

## 5. Conditions de Marché
- **Idéales**: Marchés en range ou présentant des oscillations claires, où les indicateurs comme le RSI peuvent effectivement signaler des points de retournement. Une volatilité modérée est préférable.
- **Défavorables**:
  - Marchés en forte tendance (trending markets): Le RSI peut rester dans des zones extrêmes pendant de longues périodes.
  - Faible liquidité: Peut entraîner des slippages importants.
  - Forte volatilité imprévue: Peut déclencher des stop-loss prématurément ou causer des échecs de transaction.

## 6. Exécution
- Le script principal est `strategies/meanReversion.js`.
- Le script `runners/run-mr.sh` est utilisé pour exécuter la stratégie, typiquement via cron ou un autre planificateur.
  ```bash
  cd runners
  chmod +x run-mr.sh
  ./run-mr.sh
  ```
- Dépendances NPM : `technicalindicators`, `chalk`. (Assurez-vous qu'elles sont listées dans `package.json` et installées via `npm install`).

## 7. Points d'Amélioration Potentiels
- Intégrer une source de données réelles pour l'historique des prix au lieu de la simulation.
- Implémenter une logique de retry plus robuste pour les erreurs de séquence de compte ou autres erreurs de réseau temporaires.
- Affiner les paramètres du RSI (période, seuils) ou ajouter d'autres indicateurs pour améliorer la fiabilité des signaux.
- Introduire une gestion dynamique du levier ou de la taille de position basée sur la volatilité ou la confiance dans le signal.
- Développer des tests unitaires et d'intégration pour la stratégie.
```