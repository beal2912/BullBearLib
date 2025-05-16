const { getMarkets, openPosition, closePosition, getMaxLeverages } = require('../lib.js');
const { CACHE_DIR } = require('../consts.js');
const RSI = require('technicalindicators').RSI;
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// ---------- CONFIGURATION ----------
const CONFIG = {
  COLLATERAL: "10.1",      // USDC collateral per trade
  LEVERAGE: 2,             // Default leverage (sera converti en string si besoin pour openPosition)
  RSI_PERIOD: 14,
  RSI_OVERBOUGHT: 70,
  RSI_OVERSOLD: 30,
  STOP_LOSS_PERCENT: -0.05, // -5%
  TAKE_PROFIT_PERCENT: 0.05, // +5%
  MAX_POSITION_HOURS: 6,
  DELAY_BEFORE_OPEN_MS: 20000, // 20 secondes
  // STATE_FILE: path.join(CACHE_DIR, 'meanReversion-state.json'), // Plus spécifique si on a plusieurs fichiers cache
  // Pour garder la compatibilité avec le code précédent:
  CACHE_FILE: path.join(CACHE_DIR, 'meanReversion.json'),
  DEBUG: true, // Active les logs de debug supplémentaires
};

// ---------- STATE MANAGEMENT ----------
function loadCache() {
  if (!fs.existsSync(CACHE_DIR)) {
    console.log(chalk.blue(`Répertoire cache ${CACHE_DIR} non trouvé, création...`));
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG.CACHE_FILE)) {
    console.log(chalk.blue(`Fichier cache ${CONFIG.CACHE_FILE} non trouvé, création d'un nouvel état.`));
    return { positions: {}, blacklist: [] }; // Blacklist est un tableau de denoms
  }
  try {
    const data = fs.readFileSync(CONFIG.CACHE_FILE, 'utf8');
    console.log(chalk.blue(`Cache chargée depuis ${CONFIG.CACHE_FILE}`));
    return JSON.parse(data);
  } catch (err) {
    console.log(chalk.red(`Erreur de chargement de la cache (${CONFIG.CACHE_FILE}): ${err.message}`));
    return { positions: {}, blacklist: [] }; // Retourne un état vide en cas d'erreur
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CONFIG.CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    if (CONFIG.DEBUG) console.log(chalk.gray(`Cache sauvegardée dans ${CONFIG.CACHE_FILE}`));
  } catch (err) {
    console.log(chalk.red(`Erreur de sauvegarde de la cache (${CONFIG.CACHE_FILE}): ${err.message}`));
  }
}

// ---------- PRICE HISTORY (Simulation) ----------
// TODO: Remplacer par une véritable récupération des prix historiques.
async function getPriceHistory(marketDenom) {
  if (CONFIG.DEBUG) console.log(chalk.gray(`Sim_Récupération historique des prix pour ${marketDenom}...`));
  // Simule un tableau de prix pour le calcul RSI (besoin d'au moins RSI_PERIOD valeurs)
  return Array.from({ length: CONFIG.RSI_PERIOD + 6 }, () => 100 + Math.random() * 10 - 5); // Un peu plus que nécessaire
}

// ---------- POSITION MONITORING ----------
async function monitorPositions(cache, marketsData) {
  const openPositions = cache.positions;
  const currentTimestamp = Date.now();

  if (CONFIG.DEBUG && Object.keys(openPositions).length > 0) {
    console.log(chalk.cyan(`Surveillance de ${Object.keys(openPositions).length} positions ouvertes...`));
  }

  for (const marketDenom in openPositions) {
    const position = openPositions[marketDenom];
    const { openPrice, isLong, leverage, openTime, txHash } = position;

    const marketInfo = marketsData.find(m => m.denom === marketDenom);
    if (!marketInfo) {
      console.log(chalk.yellow(`WARN: Données de marché non trouvées pour ${marketDenom} dans monitorPositions. Position ${txHash} ignorée pour cette vérification.`));
      continue;
    }
    const currentPrice = parseFloat(marketInfo.lastPrice);
    const pnlPercent = ((currentPrice - parseFloat(openPrice)) / parseFloat(openPrice)) * (isLong ? 1 : -1) * parseFloat(leverage);

    if (CONFIG.DEBUG) {
        console.log(chalk.gray(`  Vérif. ${marketDenom} (Tx: ${txHash}): Ouvert@${openPrice}, Actuel@${currentPrice}, PnL: ${(pnlPercent * 100).toFixed(2)}%`));
    }

    const maxHoldTimeMs = CONFIG.MAX_POSITION_HOURS * 60 * 60 * 1000;
    let shouldClose = false;
    let reason = "";

    if (pnlPercent <= CONFIG.STOP_LOSS_PERCENT) {
      shouldClose = true;
      reason = `Stop-loss atteint (${(CONFIG.STOP_LOSS_PERCENT*100).toFixed(0)}%)`;
    } else if (pnlPercent >= CONFIG.TAKE_PROFIT_PERCENT) {
      shouldClose = true;
      reason = `Take-profit atteint (${(CONFIG.TAKE_PROFIT_PERCENT*100).toFixed(0)}%)`;
    } else if ((currentTimestamp - openTime) > maxHoldTimeMs) {
      shouldClose = true;
      reason = `Temps de maintien maximum dépassé (${CONFIG.MAX_POSITION_HOURS}h)`;
    }

    if (shouldClose) {
      console.log(chalk.yellow(`CLÔTURE: Position pour ${marketDenom} (Tx: ${txHash}) due à: ${reason}. PnL: ${(pnlPercent * 100).toFixed(2)}%`));
      const closePayload = [{ denom: marketDenom, long: isLong, percent: "1.0" }];
      const closeResult = await closePosition(closePayload);
      
      if (closeResult && closeResult.result) {
        console.log(chalk.green(`  SUCCÈS CLÔTURE: ${marketDenom} (Tx Orig.: ${txHash}). Nouveau TxHash: ${closeResult.result.txhash}`));
        delete cache.positions[marketDenom];
      } else {
        const errorMessage = closeResult ? (closeResult.error || JSON.stringify(closeResult)) : 'Réponse invalide ou nulle';
        console.log(chalk.red(`  ERREUR CLÔTURE: ${marketDenom} (Tx Orig.: ${txHash}). Erreur: ${errorMessage}`));
        // Ne pas blacklister ici, pourrait être un problème temporaire ou position déjà clôturée.
      }
    }
  }
}

// ---------- CORE STRATEGY LOGIC ----------
async function runStrategy() {
  console.log(chalk.bold.cyan(`\n===== [${new Date().toISOString()}] DÉMARRAGE Cycle Stratégie Mean Reversion =====`));
  let cache = loadCache();
  
  const marketsData = await getMarkets();
  if (!marketsData || marketsData.length === 0) {
    console.log(chalk.red("Impossible de récupérer les données des marchés. Arrêt du cycle."));
    return;
  }
  const allMaxLeverages = await getMaxLeverages(); // Un seul appel
  if (!allMaxLeverages) {
    console.log(chalk.red("Impossible de récupérer les données de levier maximum. Arrêt du cycle."));
    return;
  }

  await monitorPositions(cache, marketsData);

  const availableMarkets = marketsData.filter(market => {
    if (cache.blacklist.includes(market.denom)) return false;
    if (cache.positions[market.denom]) return false;
    return true; // Liquidity and other checks could be added here
  });

  if (CONFIG.DEBUG) {
    if (availableMarkets.length === 0) {
        console.log(chalk.gray("Aucun marché disponible pour de nouvelles positions (filtré par blacklist/positions existantes)."));
    } else {
        console.log(chalk.gray(`Analyse de ${availableMarkets.length} marchés pour de nouvelles opportunités...`));
    }
  }
  

  for (const market of availableMarkets) {
    const marketDenom = market.denom;
    try {
      const prices = await getPriceHistory(marketDenom);
      if (prices.length < CONFIG.RSI_PERIOD) {
        if (CONFIG.DEBUG) console.log(chalk.gray(`  ${marketDenom}: Pas assez de données de prix (${prices.length}) pour RSI(${CONFIG.RSI_PERIOD}).`));
        continue;
      }

      const rsiResult = RSI.calculate({ period: CONFIG.RSI_PERIOD, values: prices });
      if (!rsiResult || rsiResult.length === 0) {
        if (CONFIG.DEBUG) console.log(chalk.gray(`  ${marketDenom}: Calcul du RSI a échoué ou résultat vide.`));
        continue;
      }
      const currentRsi = rsiResult[rsiResult.length - 1];

      if (isNaN(currentRsi)) {
        if (CONFIG.DEBUG) console.log(chalk.gray(`  ${marketDenom}: RSI calculé est NaN.`));
        continue;
      }
      
      if (CONFIG.DEBUG) console.log(chalk.blue(`  ${marketDenom}: Prix Actuel: ${market.lastPrice}, RSI(${CONFIG.RSI_PERIOD}): ${currentRsi.toFixed(2)}`));
      
      let signal = null;
      if (currentRsi < CONFIG.RSI_OVERSOLD) signal = 'long'; 
      else if (currentRsi > CONFIG.RSI_OVERBOUGHT) signal = 'short';

      if (signal) {
        console.log(chalk.green(`OUVERTURE SIGNAL: ${signal.toUpperCase()} pour ${marketDenom} (RSI: ${currentRsi.toFixed(2)})`));
        
        const collateralAmount = CONFIG.COLLATERAL;
        const marketMaxLeverage = parseFloat(allMaxLeverages[marketDenom] || "1");
        const leverageToUse = Math.min(CONFIG.LEVERAGE, marketMaxLeverage);

        console.log(chalk.blue(`  Tentative: ${signal} ${marketDenom} @ ${leverageToUse.toFixed(1)}x levier, ${collateralAmount} USDC.`));
        
        if (CONFIG.DELAY_BEFORE_OPEN_MS > 0) {
            console.log(chalk.magenta(`  Attente de ${CONFIG.DELAY_BEFORE_OPEN_MS / 1000}s avant ouverture...`));
            await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BEFORE_OPEN_MS));
        }

        const openPayload = [{ denom: marketDenom, long: signal === 'long', percent: "1.0" }];
        const openResult = await openPosition(
          openPayload,
          collateralAmount, // Doit être une string
          leverageToUse.toString()
        );

        if (openResult && openResult.result && openResult.result.txhash) {
          console.log(chalk.green.bold(`  SUCCÈS OUVERTURE: ${signal} ${marketDenom}. TxHash: ${openResult.result.txhash}`));
          cache.positions[marketDenom] = {
            openPrice: market.lastPrice, 
            isLong: signal === 'long',
            leverage: leverageToUse, 
            openTime: Date.now(),
            txHash: openResult.result.txhash
          };
        } else {
          const errorMessage = openResult ? (openResult.error || JSON.stringify(openResult)) : 'Réponse invalide/nulle de openPosition';
          console.log(chalk.red.bold(`  ERREUR OUVERTURE: ${signal} ${marketDenom}. Erreur: ${errorMessage}`));
          if (typeof errorMessage === 'string' && errorMessage.includes("account sequence mismatch")) {
            console.log(chalk.yellow("    Erreur de séquence de compte. Un retry différé serait utile."));
          } else {
            if (!cache.blacklist.includes(marketDenom)) {
              cache.blacklist.push(marketDenom);
              console.log(chalk.red(`    ${marketDenom} ajouté à la liste noire suite à échec d'ouverture.`));
            }
          }
        }
      }
    } catch (error) {
      console.log(chalk.red(`ERREUR MAJEURE (traitement ${marketDenom}): ${error.message}`), error.stack);
      if (!cache.blacklist.includes(marketDenom)) {
        cache.blacklist.push(marketDenom);
        console.log(chalk.red(`  ${marketDenom} ajouté à la liste noire suite à erreur: ${error.message}`));
      }
    }
  }

  saveCache(cache);
  console.log(chalk.bold.cyan(`===== [${new Date().toISOString()}] FIN Cycle Stratégie Mean Reversion =====\n`));
}

// ---------- RUN SCRIPT ----------
if (require.main === module) {
  runStrategy().catch(error => {
    console.error(chalk.bgRed.white.bold(`\n!!!!!! ERREUR CRITIQUE NON GEREE (Root) !!!!!!\n${error.message}\n`), error.stack);
    try {
      let cache = loadCache(); saveCache(cache);
      console.log(chalk.blue("Tentative de sauvegarde de la cache après erreur critique."));
    } catch (saveError) {
      console.error(chalk.bgRed.white("Impossible de sauvegarder la cache après erreur critique:", saveError.message));
    }
    process.exit(1);
  });
}