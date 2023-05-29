const functions = require("firebase-functions");
const Deployer = require("./lib/deployHosting");
const deployer = require("./lib/deployHosting");
exports.deployHosting = functions.https.onRequest(async (request, response) => {
  const siteId = process.env.SITEID;

  const instanceId = process.env.EXT_INSTANCE_ID;
  console.log('Running on',instanceId)
  let deployer = new Deployer(request, response);

  await deployer.deploy();
});
