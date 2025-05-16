const lib = require('./lib.js');
const prices = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
async function calculateRSI(prices) {
    const gains = [];
    const losses = [];
    for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) {
            gains.push(diff);
            losses.push(0);
        } else {
            gains.push(0);
            losses.push(Math.abs(diff));
        }
    }
    const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    return rsi;
calculateRSI(prices).then(rsi => console.log('RSI:', rsi));
}
console.log('Calculating RSI...');
