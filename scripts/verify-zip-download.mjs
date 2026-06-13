import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const csvPath = path.join(root, "teammembers.csv");
const downloadDir = path.join(root, ".downloads");
const zipPath = path.join(downloadDir, "certificates.zip");
const cdpPort = process.env.CDP_PORT ?? "9223";

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.ws.send(JSON.stringify({ id, method, params }));

    return promise;
  }

  close() {
    this.ws.close();
  }
}

async function waitFor(condition, timeoutMs, label) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await condition();

    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function getJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json();
}

await fs.promises.rm(zipPath, { force: true });

const pages = await waitFor(
  async () => {
    try {
      const targets = await getJson(`http://localhost:${cdpPort}/json/list`);
      return targets.find((target) => target.type === "page");
    } catch {
      return null;
    }
  },
  15000,
  "Chrome DevTools page target",
);

const client = new CdpClient(pages.webSocketDebuggerUrl);
await client.open();

try {
  await client.send("Page.enable");
  await client.send("DOM.enable");
  await client.send("Runtime.enable");
  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
  });
  await client.send("Page.navigate", { url: "http://localhost:3000" });

  await waitFor(
    async () => {
      const result = await client.send("Runtime.evaluate", {
        expression: "document.readyState === 'complete'",
        returnByValue: true,
      });

      return result.result.value;
    },
    15000,
    "page load",
  );

  const document = await client.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  const input = await client.send("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: 'input[type="file"]',
  });

  if (!input.nodeId) {
    throw new Error("Could not find CSV file input.");
  }

  await client.send("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [csvPath],
  });

  await waitFor(
    async () => {
      const result = await client.send("Runtime.evaluate", {
        expression:
          "document.querySelectorAll('tbody tr').length > 0 && document.body.innerText.includes('Aarav Sharma')",
        returnByValue: true,
      });

      return result.result.value;
    },
    15000,
    "CSV records to render",
  );

  const clicked = await client.send("Runtime.evaluate", {
    expression: `
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent.includes('Generate All Certificates'));
        if (!button) return false;
        button.click();
        return true;
      })()
    `,
    returnByValue: true,
  });

  if (!clicked.result.value) {
    throw new Error("Could not click Generate All Certificates.");
  }

  const downloadedZip = await waitFor(
    async () => {
      if (!fs.existsSync(zipPath)) {
        return null;
      }

      const stats = await fs.promises.stat(zipPath);

      return stats.size > 0 ? stats : null;
    },
    120000,
    "certificates.zip download",
  );

  console.log(`Downloaded certificates.zip (${downloadedZip.size} bytes).`);
} finally {
  client.close();
}
