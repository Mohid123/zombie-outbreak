const fs = require('fs');

const mapTilerKey = process.env.mapTilerKey || '';

const envContent = `export const environment = {
  production: true,
  mapTilerKey: '${mapTilerKey}'
};
`;

fs.writeFileSync('./src/environments/environment.ts', envContent);
console.log('✅ environment.ts generated');