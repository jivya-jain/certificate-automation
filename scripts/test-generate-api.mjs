import fs from "fs";
import path from "path";
import Papa from "papaparse";

const API_URL = "http://localhost:3000/api/generate";
const csvPath = path.resolve("teammembers.csv");
const outputDir = path.resolve(".downloads");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function testSingle() {
  console.log("Testing Single PDF Generation API...");
  const payload = {
    templateId: "participation",
    candidateName: "Test Single Candidate",
    teamName: "Test Single Team"
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Single API failed: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const pdfPath = path.join(outputDir, "test-single.pdf");
  fs.writeFileSync(pdfPath, buffer);
  console.log(`Single PDF generated successfully at: ${pdfPath} (${buffer.length} bytes)`);
}

async function testBulk() {
  console.log("Testing Bulk ZIP Generation API...");
  const csvText = fs.readFileSync(csvPath, "utf-8");
  
  const normalizedCsvText = csvText.replace(/^\uFEFF/, "");
  const result = Papa.parse(normalizedCsvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
  });
  
  const fields = (result.meta.fields ?? []).map(h => h.replace(/^\uFEFF/, "").trim());
  const singleCommaSeparatedHeader = fields.length === 1 && fields[0].includes(",");
  
  let records = [];
  if (singleCommaSeparatedHeader) {
    const expandedFields = fields[0].split(",").map(h => h.trim());
    const singleFieldName = fields[0];
    records = result.data.map((row) => {
      const values = (row[singleFieldName] ?? "")
        .split(",")
        .map((value) => value.trim());

      return {
        candidateName: values[expandedFields.indexOf("candidateName")] ?? "",
        teamName: values[expandedFields.indexOf("teamName")] ?? "",
      };
    }).filter(r => r.candidateName && r.teamName);
  } else {
    records = result.data.map((row) => ({
      candidateName: row.candidateName?.trim() ?? "",
      teamName: row.teamName?.trim() ?? "",
    })).filter(r => r.candidateName && r.teamName);
  }

  console.log(`Loaded ${records.length} records from CSV.`);

  const payload = {
    templateId: "winning",
    records
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bulk API failed: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const zipPath = path.join(outputDir, "test-bulk.zip");
  fs.writeFileSync(zipPath, buffer);
  console.log(`Bulk ZIP generated successfully at: ${zipPath} (${buffer.length} bytes)`);
}

async function run() {
  try {
    await testSingle();
    await testBulk();
    console.log("All API integration tests passed successfully!");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

run();
