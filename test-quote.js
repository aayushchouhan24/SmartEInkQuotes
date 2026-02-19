require('dotenv/config');
const { generateQuote } = require('./lib/ai');

(async () => {
  try {
    console.log('Testing quote generation...\n');
    const quote = await generateQuote({ quoteTypes: [], animeList: [], temperature: 1.0 });
    console.log('\n✅ SUCCESS!');
    console.log('Quote:', quote);
  } catch (e) {
    console.error('\n❌ FAILED!');
    console.error('Error:', e.message);
  }
})();
