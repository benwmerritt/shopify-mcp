const fs = require('fs');
const products = JSON.parse(fs.readFileSync('products.json'));
const results = JSON.parse(fs.readFileSync('results.json'));

const manualIds = [];
const imageUpdates = [];

results.forEach(r => {
  const p = products.find(prod => prod.sku === r.sku);
  if (p) {
    if (r.exists) {
      imageUpdates.push({ id: p.id, sku: p.sku, tags: [...p.tags, 'has-image', 'image-processed'] });
    } else {
      manualIds.push(p.id);
    }
  }
});

console.log(JSON.stringify({ manualIds, imageUpdates }));
