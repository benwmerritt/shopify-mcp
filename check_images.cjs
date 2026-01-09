const https = require('https');
const fs = require('fs');

const products = JSON.parse(fs.readFileSync('products.json'));

const checkUrl = (sku) => {
  return new Promise((resolve) => {
    const url = `https://www.teamshowandgo.com.au/assets/full/${sku}.jpg`;
    const req = https.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
      resolve({ sku, exists: res.statusCode === 200 });
    });
    req.on('error', () => resolve({ sku, exists: false }));
    req.on('timeout', () => {
        req.destroy();
        resolve({ sku, exists: false });
    });
    req.end();
  });
};

Promise.all(products.map(p => checkUrl(p.sku))).then(checked => {
  console.log(JSON.stringify(checked));
});