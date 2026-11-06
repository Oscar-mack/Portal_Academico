const tokenStore = require("../app/services/googleTokenStore");

try {
  const encrypted = tokenStore.exportEncryptedEnvironmentValue();
  process.stdout.write(`GOOGLE_REFRESH_TOKEN_ENC=${encrypted}\n`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
