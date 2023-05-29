const { google } = require("googleapis");

const { exec } = require("child_process");
const axios = require("axios");
var crypto = require("crypto");
const os = require("os");
const path = require("path");
const tmp = os.tmpdir();
const fs = require("fs");
const JSZip = require("jszip");
const requestObject = require("request");
const admin = require("firebase-admin");
const execute = async (command) =>
  await new Promise((resolve) => exec(command, resolve));
admin.initializeApp();
const db = admin.firestore();
class Deployer {
  constructor(req, res) {
    this.zip = new JSZip();
    this.request = req;
    this.res = res;
    this.keys = {
      private_key: process.env.PRIVATEKEY,
      client_email: process.env.CLIENTEMAIL,
    };
  }

  async handleFileExecutions(
    filePath,
    pageContent,
    pageDoc,
    site,
    versionId,
    accessToken,
    accountId,
    pageId
  ) {
    let fileUploader = await this.handleFileUpload(filePath, pageContent);
    return fileUploader;
  }
  async handleFileUpload(filePath, pageContent) {
    await fs.writeFile(filePath, pageContent, async (err) => {});
  }
  async requestDeploy(options) {
    let resp = await requestObject.post(options);
    return resp;
  }
  async releaseVersionToCloud(site, versionId, accessToken, accountId, files) {
    const releaseVersion = await axios.post(
      `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/releases?versionName=${
        "sites/" + site + "/versions/" + versionId
      }`,
      // '{\n               "files": {\n                 "/file1": "66d61f86bb684d0e35f94461c1f9cf4f07a4bb3407bfbd80e518bd44368ff8f4",\n                 "/file2": "490423ebae5dcd6c2df695aea79f1f80555c62e535a2808c8115a6714863d083",\n                 "/file3": "59cae17473d7dd339fe714f4c6c514ab4470757a4fe616dfdb4d81400addf315"\n               }\n             }',
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    console.log("Released Version ♻", releaseVersion.data);
    releaseVersion.data.Files = files;
    let doc = await db
      .collection("CloudHostAccounts")
      .doc(accountId)
      .collection("Deployments")
      .add(releaseVersion.data);

    console.log("Version Id", doc.id);
  }
  async updateVersionStatus(site, versionId, accessToken) {
    const finalresponse = await axios.patch(
      `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/versions/${versionId}?update_mask=status`,
      // '{"status": "FINALIZED"}',
      {
        status: "FINALIZED",
      },
      {
        params: {
          update_mask: "status",
        },
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    return finalresponse;
  }

  async handleFileUpload(filePath, pageContent) {
    await fs.writeFile(filePath, pageContent, async (err) => {});
  }
  async getAccessToken() {
    const SCOPES = ["https://www.googleapis.com/auth/firebase.hosting"];
    return new Promise(function (resolve, reject) {
      let key = {
        private_key: process.env.PRIVATEKEY,
        client_email: process.env.CLIENTEMAIL,
      };

      var jwtClient = new google.auth.JWT(
        key.client_email,
        null,
        key.private_key,
        SCOPES,
        null
      );

      jwtClient.authorize(function (err, tokens) {
        if (err) {
          //console.log('ERRORE',err);
          reject(err);
          return;
        }
        resolve(tokens.access_token);
      });
    });
  }

  async deploy(request = this.request, response = this.response) {
    let siteId = this.getSiteId();

    let url = `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/versions`;
    let accountId = await this.getAccountID(request);

    let accessToken = await this.getAccessToken();
    let versionSetting = await this.getVersionSettings(url, accessToken);

    let pageBuilderSetup = await this.getPageBuilderSetup(
      accountId,
      versionSetting,
      accessToken
    );
    this.res.send({
      message: "Started to deploy",
    });
    let promiseForFile = await Promise.all(pageBuilderSetup.promiseForFile);
    let index = 0;
    let files = {};
    let deployments = [];

    for (let filePath of pageBuilderSetup.filePaths) {
      let pageDoc = pageBuilderSetup.pageDocs[index].element;
      let commandExec = await execute(`gzip ${filePath}`);
      let zippedPath = filePath + ".gz";
      console.log("Temporary HTML FILE PATH 🚦", filePath);
      const buffer = fs.readFileSync(filePath + ".gz");
      var hash = crypto.createHash("SHA256").update(buffer).digest("hex");
      console.log("Hash 👮‍♀️", hash);
      files[pageDoc.data().hostingurl] = hash;
      console.log("🗃️", files);

      const patchFile = await axios.post(
        `https://firebasehosting.googleapis.com/v1beta1/sites/${this.getSiteId()}/versions/${
          versionSetting.versionId
        }:populateFiles`,
        // '{\n               "files": {\n                 "/file1": "66d61f86bb684d0e35f94461c1f9cf4f07a4bb3407bfbd80e518bd44368ff8f4",\n                 "/file2": "490423ebae5dcd6c2df695aea79f1f80555c62e535a2808c8115a6714863d083",\n                 "/file3": "59cae17473d7dd339fe714f4c6c514ab4470757a4fe616dfdb4d81400addf315"\n               }\n             }',
        {
          files: files,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      console.log("Patch Result", patchFile.data.uploadUrl);
      const options = {
        uri: patchFile.data.uploadUrl + "/" + hash,

        body: fs.createReadStream(zippedPath),
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/octet-stream",
        },
      };

      console.log("Options Stream", options);
      let requestDeployResponse = await this.requestDeploy(options);
      //console.log("Deploy Requests", requestDeployResponse);
      deployments.push(requestDeployResponse);
      index++;
    }

    let typeChangeResponse = await this.updateVersionStatus(
      process.env.SITEID,
      versionSetting.versionId,
      accessToken
    );
    let releaseResponse = await this.releaseVersionToCloud(
      process.env.SITEID,
      versionSetting.versionId,
      accessToken,
      accountId,
      files
    );
    
  }
  async getPageBuilderSetup(accountId, versionSetting, accessToken) {
    console.log("Account Identity", accountId);
    let pageSnap = await db
      .collection("CloudHostAccounts")
      .doc(accountId)
      .collection("pages")
      .get();
    this.pageContents = [];
    this.filePaths = [];
    this.pageDocs = [];
    this.pageIds = [];

    pageSnap.forEach((element) => {
      let data = element.data();
      let content = data["content"];

      this.pageContents.push(content);

      this.filePaths.push(path.join(tmp, data.name));

      this.pageDocs.push({ element });

      this.pageIds.push(element.id);
    });
    console.log("IDS", this.pageIds);
    console.log("DOCS", this.pageDocs);

    let promiseListForFile = [];
    for (let i in this.pageDocs) {
      let path = this.filePaths[i];
      let docData = this.pageDocs[i].element; //.data();

      let content = docData.data().content;
      //console.log(Object.values(docData).content.stringValue, Object.keys(docData));
      promiseListForFile.push(
        this.handleFileExecutions(
          path,
          content,
          this.pageDocs[i],
          process.env.SITEID,
          versionSetting.versionId,
          accessToken,
          accountId,
          this.pageIds[i]
        )
      );
    }

    return {
      promiseForFile: promiseListForFile,
      pageContents: this.pageContents,
      filePaths: this.filePaths,
      pageDocs: this.pageDocs,
      pageIds: this.pageIds,
    };
  }
  async getVersionSettings(url, accessToken) {
    let versionSetting = await axios.post(
      url,
      {
        config: {
          headers: [
            {
              glob: "**",
              headers: {
                "Cache-Control": "max-age=1800",
              },
            },
          ],
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    let versionId =
      versionSetting.data.name.split("/")[
        versionSetting.data.name.split("/").length - 1
      ];
    return { vs: versionSetting, versionId: versionId };
  }
  getHostingURL(request) {
    return request.path;
  }
  getAccountID(request) {
    let url = this.getHostingURL(request);

    let accId = url.split("/")[url.split("/").length - 1];

    return accId;
  }
  getSiteId() {
    return process.env.SITEID;
  }
}
module.exports = Deployer;
