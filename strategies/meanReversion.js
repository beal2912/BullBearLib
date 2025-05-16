const { getMarkets, openPosition, closePosition, getMaxLeverages } = require('../lib.js');
const { CACHE_DIR } = require('../consts.js');
const RSI = require('technicalindicators').RSI;
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const CONFIG = {
  COLLATERAL: "10.1",  // USDC per trade
  LEVERAGE: 2           // Ajustable, par défaut 2x
};

const CACHE_FILE = path.join(CACHE_DIR, 'meanReversion.json');

// Fonction pour charger la cache
function loadCache() {
  try {
    const data = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.log(chalk.red('Erreur de chargement de la cache:', err));
    return { positions: {}, blacklist: [] };
  }
}

// Fonction pour sauvegarder la cache
function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.log(chalk.red('Erreur de sauvegarde de la cache:', err));
  }
}

// Fonction pour récupérer les prix historiques (simulée)
async function getPriceHistory(market) {
  // Simulons un tableau de prix historiques pour chaque marché
  return Array.from({ length: 14 }, () => Math.random() * 100);
}

// Fonction pour monitorer et gérer les positions
async function monitorPositions() {
  let cache = loadCache();
  const positions = cache.positions;
  const currentTimestamp = Date.now();

  for (const [market, position] of Object.entries(positions)) {
    const { openPrice, isLong, leverage, openTime } = position;
    const currentPrice = await getMarkets().find(m => m.denom === market).lastPrice;
    const pnl = ((currentPrice - openPrice) / openPrice) * (isLong ? 1 : -1);
    const stopLoss = -0.05;
    const takeProfit = 0.05;
    const maxHoldTime = 6 * 60 * 60 * 1000; // 6 heures

    if (pnl <= stopLoss || pnl >= takeProfit || (currentTimestamp - openTime > maxHoldTime)) {
      console.log(chalk.yellow(`Fermeture de la position pour ${market}: PnL=${pnl.toFixed(2)}, Stop-loss=${stopLoss}, Take-profit=${takeProfit}, Max hold time atteint=${currentTimestamp - openTime > maxHoldTime}`));
      const result = await closePosition([
        { denom: market, long: isLong, percent: "1.0" }
      ]);
      if (result) {
        delete positions[market];
        console.log(chalk.green(`Position fermée pour ${market}`));
      } else {
        console.log(chalk.red(`Échec de la fermeture de la position pour ${market}`));
        cache.blacklist.push(market);
      }
    }
  }

  saveCache(cache);
}

// Fonction principale pour exécuter la stratégie
async function runMeanReversionStrategy() {
  let cache = loadCache();
  const markets = await getMarkets();
  const blacklist = cache.blacklist;

  for (const market of markets) {
    if (blacklist.includes(market.denom)) {
      console.log(chalk.red(`Market ${market.denom} est blacklisté`));
      continue;
    }

    try {
      const priceHistory = await getPriceHistory(market.denom);
      const rsi = new RSI({ period: 14, values: priceHistory }).getResult();
      const lastRsi = rsi[rsi.length - 1];

      if (lastRsi < 30) {
        // Signal d'achat (Long)
        console.log(chalk.green(`Signal LONG pour ${market.denom}, RSI=${lastRsi}`));
        const collateralAmount = CONFIG.COLLATERAL;
        const maxLeverages = await getMaxLeverages(market.denom);
        const leverage = Math.min(CONFIG.LEVERAGE, maxLeverages[market.denom]);

        const result = await openPosition([
          { denom: market.denom, long: true, percent: "1.0" }
        ], collateralAmount, leverage);

        if (result) {
          cache.positions[market.denom] = {
            openPrice: market.lastPrice,
            isLong: true,
            leverage: leverage,
            openTime: Date.now()
          };
          console.log(chalk.green(`Position ouverte pour ${market.denom}, Leveredge=${leverage}`));
        } else {
          console.log(chalk.red(`Échec de l'ouverture de la position pour ${market.denom}`));
          cache.blacklist.push(market.denom);
        }
      } else if (lastRsi > 70) {
        // Signal de vente (Short)
        console.log(chalk.red(`Signal SHORT pour ${market.denom}, RSI=${lastRsi}`));
        const collateralAmount = CONFIG.COLLATERAL;
        const maxLeverages = await getMaxLeverages(market.denom);
        const leverage = Math.min(CONFIG.LEVERAGE, maxLeverages[market.denom]);

        const result = await openPosition([
          { denom: market.denom, long: false, percent: "1.0" }
        ], collateralAmount, leverage);

        if (result) {
          cache.positions[market.denom] = {
            openPrice: market.lastPrice,
            isLong: false,
            leverage: leverage,
            openTime: Date.now()
          };
          console.log(chalk.green(`Position ouverte pour ${market.denom}, Leverage=${leverage}`));
        } else {
          console.log(chalk.red(`Échec de l'ouverture de la position pour ${market.denom}`));
          cache.blacklist.push(market.denom);
        }
      }
    } catch (err) {
      console.log(chalk.red(`Erreur pour le marché ${market.denom}:`, err));
      cache.blacklist.push(market.denom);
    }
  }

  saveCache(cache);
}

// Exécution de la stratégie et de la surveillance des positions
runMeanReversionStrategy();
monitorPositions();
