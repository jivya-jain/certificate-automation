import { prisma } from "@/lib/prisma";

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

// Helper to sanitize file names
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

    const templatePath = path.join(process.cwd(), "templates", `${templateId}.pptx`);
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: `Template not found: ${templateId}` }, { status: 404 });
    }

    // Ensure temp directory exists
    fs.mkdirSync(tempDir, { recursive: true });

    // Bulk generation
    if (records && Array.isArray(records)) {
      if (records.length === 0) {
        return NextResponse.json({ error: "Records array cannot be empty" }, { status: 400 });
      }

      // Import participants into Neon
      for (const rec of records) {
        const name = (rec.candidateName ?? "").trim();
        const team = (rec.teamName ?? "").trim();
        if (!name) continue;
        try {
          await prisma.participant.create({
            data: { candidateName: name, teamName: team },
          });
        } catch (e) {
          console.error("Error inserting participant", e);
        }
      }

      const batchItems: { input: string; output: string; fileName: string }[] = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const recName = record.candidateName || "Candidate";
        const recTeam = record.teamName || "Team";

        const content = fs.readFileSync(templatePath);
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: "{{", end: "}}" },
        });

        doc.render({ NAME: recName, TEAM_NAME: recTeam });
        const buf = doc.getZip().generate({ type: "nodebuffer" });
        const pptxPath = path.join(tempDir, `record_${i}.pptx`);
        const pdfPath = path.join(tempDir, `record_${i}.pdf`);
        fs.writeFileSync(pptxPath, buf);

        batchItems.push({
          input: pptxPath,
          output: pdfPath,
          fileName: `${String(i + 1).padStart(2, "0")}-${sanitizeFileName(recName)}.pdf`,
        });
      }

      const batchJsonPath = path.join(tempDir, "batch.json");
      fs.writeFileSync(batchJsonPath, JSON.stringify(batchItems, null, 2));

      console.log(`Running batch PDF conversion for ${records.length} items`);
      await runPowerShell(["-Action", "batch-pdf", "-BatchJsonPath", batchJsonPath]);

      const zipArchive = new JSZip();
      for (const item of batchItems) {
        if (fs.existsSync(item.output)) {
          zipArchive.file(item.fileName, fs.readFileSync(item.output));
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

    // Single generation
    if (!candidateName) {
      return NextResponse.json({ error: "candidateName is required" }, { status: 400 });
    }

    // Verify participant exists
    const participant = await prisma.participant.findFirst({
      where: {
        candidateName: { equals: candidateName.trim(), mode: "insensitive" },
        teamName: { equals: (teamName ?? "").trim(), mode: "insensitive" },
      },
    });
    if (!participant) {
      return NextResponse.json(
        { error: "Participant not found. Please ensure the name and team are registered." },
        { status: 400 }
      );
    }

    const content = fs.readFileSync(templatePath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "{{", end: "}}" },
    });

    doc.render({ NAME: candidateName, TEAM_NAME: teamName || "" });
    const buf = doc.getZip().generate({ type: "nodebuffer" });
    const pptxPath = path.join(tempDir, "output.pptx");
    const pdfPath = path.join(tempDir, "output.pdf");
    fs.writeFileSync(pptxPath, buf);

    console.log(`Converting single PPTX to PDF for: ${candidateName}`);
    await runPowerShell(["-Action", "pdf", "-InputPath", pptxPath, "-OutputPath", pdfPath]);

    if (!fs.existsSync(pdfPath)) {
      throw new Error("PDF generation output was not created");
    }

    const pdfBuffer = fs.readFileSync(pdfPath);
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
    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error("Error cleaning up temporary files:", cleanupError);
    }
    //await prisma.$disconnect();
  }
}
