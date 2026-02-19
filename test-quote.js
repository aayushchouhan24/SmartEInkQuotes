require('dotenv/config');
const { generateQuote, generateImagePrompt, getProviderStatus } = require('./lib/ai');

(async () => {
  const status = getProviderStatus();
  console.log(`\nText AI providers: ${status.textAvailable}/${status.text.length}`);
  status.text.forEach((p) => console.log(`  ${p.available ? '✓' : '✗'} ${p.name}`));
  console.log('');

  try {
    console.log('Generating anime quote...\n');
    const quote = await generateQuote({ quoteTypes: [], animeList: [], temperature: 1.0 });
    console.log('\n✅ QUOTE:', quote);

    console.log('\nGenerating image prompt from quote...\n');
    const prompt = await generateImagePrompt(quote);
    console.log('\n✅ IMAGE PROMPT:', prompt);
  } catch (e) {
    console.error('\n❌ FAILED:', e.message);
  }
})();
