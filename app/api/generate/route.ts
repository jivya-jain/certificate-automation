import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import JSZip from "jszip";

// Helper to run the PowerShell script
function runPowerShell(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "convert-pptx.ps1");
    const formattedArgs = args.map((arg) => `"${arg.replace(/"/g, '`"')}"`).join(" ");
    const command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" ${formattedArgs}`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

function sanitizeFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "certificate"
  );
}

export async function POST(req: NextRequest) {
  const tempDirId = crypto.randomUUID();
  const tempDir = path.join(process.cwd(), "temp-certificates", tempDirId);

  try {
    const body = await req.json();
    const { templateId, candidateName, teamName, records } = body;

    if (!templateId) {
      return NextResponse.json({ error: "templateId is required" }, { status: 400 });
    }

    const templatesDir = path.join(process.cwd(), "templates");
    const templatePath = path.join(templatesDir, `${templateId}.pptx`);

    if (!fs.existsSync(templatePath)) {
      return NextResponse.json(
        { error: `Template not found: ${templateId}` },
        { status: 404 }
      );
    }

    // Ensure temp directory exists
    fs.mkdirSync(tempDir, { recursive: true });

    // Handle Bulk Generation
    if (records && Array.isArray(records)) {
      if (records.length === 0) {
        return NextResponse.json({ error: "Records array cannot be empty" }, { status: 400 });
      }

      const batchItems = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const recName = record.candidateName || "Candidate";
        const recTeam = record.teamName || "Team";

        // Read template and process with docxtemplater
        const content = fs.readFileSync(templatePath);
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: "{{", end: "}}" },
        });

        doc.render({
          NAME: recName,
          TEAM_NAME: recTeam,
        });

        const buf = doc.getZip().generate({ type: "nodebuffer" });
        const recordPptxPath = path.join(tempDir, `record_${i}.pptx`);
        const recordPdfPath = path.join(tempDir, `record_${i}.pdf`);

        fs.writeFileSync(recordPptxPath, buf);

        batchItems.push({
          input: recordPptxPath,
          output: recordPdfPath,
          fileName: `${String(i + 1).padStart(2, "0")}-${sanitizeFileName(recName)}.pdf`,
        });
      }

      // Write batch items config JSON for PowerShell script
      const batchJsonPath = path.join(tempDir, "batch.json");
      fs.writeFileSync(batchJsonPath, JSON.stringify(batchItems, null, 2));

      // Run PowerPoint batch conversion
      console.log(`Running batch PDF conversion for ${records.length} items`);
      await runPowerShell(["-Action", "batch-pdf", "-BatchJsonPath", batchJsonPath]);

      // Create ZIP archive
      const zipArchive = new JSZip();
      for (const item of batchItems) {
        if (fs.existsSync(item.output)) {
          const fileData = fs.readFileSync(item.output);
          zipArchive.file(item.fileName, fileData);
        } else {
          console.error(`Expected output PDF not found: ${item.output}`);
        }
      }

      const zipBlob = await zipArchive.generateAsync({ type: "nodebuffer" });

      return new NextResponse(zipBlob, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="certificates.zip"`,
        },
      });
    }

    // Handle Single Generation
    if (!candidateName) {
      return NextResponse.json({ error: "candidateName is required" }, { status: 400 });
    }

    const content = fs.readFileSync(templatePath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "{{", end: "}}" },
    });

    doc.render({
      NAME: candidateName,
      TEAM_NAME: teamName || "",
    });

    const buf = doc.getZip().generate({ type: "nodebuffer" });
    const singlePptxPath = path.join(tempDir, "output.pptx");
    const singlePdfPath = path.join(tempDir, "output.pdf");

    fs.writeFileSync(singlePptxPath, buf);

    // Convert to PDF
    console.log(`Converting single PPTX to PDF for: ${candidateName}`);
    await runPowerShell([
      "-Action",
      "pdf",
      "-InputPath",
      singlePptxPath,
      "-OutputPath",
      singlePdfPath,
    ]);

    if (!fs.existsSync(singlePdfPath)) {
      throw new Error("PDF generation output was not created");
    }

    const pdfBuffer = fs.readFileSync(singlePdfPath);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${sanitizeFileName(candidateName)}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("Error generating certificate(s):", error);
    return NextResponse.json(
      { error: "Failed to generate certificates: " + error.message },
      { status: 500 }
    );
  } finally {
    // Synchronously clean up temporary directory recursively
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error("Error cleaning up temporary files:", cleanupError);
    }
  }
}
