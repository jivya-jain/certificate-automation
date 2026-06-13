import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

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

function getFriendlyName(fileName: string): string {
  const base = path.basename(fileName, ".pptx");
  // Capitalize and format nicely (e.g. participation -> Participation, winning2 -> Winning 2)
  return base
    .replace(/([A-Z])/g, " $1")
    .replace(/(\d+)/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

export async function GET() {
  try {
    const templatesDir = path.join(process.cwd(), "templates");
    const previewsDir = path.join(process.cwd(), "public", "previews");

    // Ensure directories exist
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }
    if (!fs.existsSync(previewsDir)) {
      fs.mkdirSync(previewsDir, { recursive: true });
    }

    // Read all .pptx files in templates/
    const files = fs.readdirSync(templatesDir);
    const pptxFiles = files.filter((file) => file.toLowerCase().endsWith(".pptx"));

    const templates = [];

    for (const file of pptxFiles) {
      const baseName = path.basename(file, ".pptx");
      const previewFileName = `${baseName}.png`;
      const previewFilePath = path.join(previewsDir, previewFileName);
      const templateFilePath = path.join(templatesDir, file);

      // Generate preview thumbnail if it doesn't exist
      if (!fs.existsSync(previewFilePath)) {
        console.log(`Generating preview PNG for template: ${file}`);
        try {
          await runPowerShell([
            "-Action",
            "thumbnail",
            "-InputPath",
            templateFilePath,
            "-OutputPath",
            previewFilePath,
          ]);
        } catch (error) {
          console.error(`Failed to generate preview for ${file}:`, error);
          // Don't crash the entire list API if one template fails to render
        }
      }

      templates.push({
        id: baseName,
        name: getFriendlyName(file),
        fileName: file,
        previewUrl: fs.existsSync(previewFilePath) ? `/previews/${previewFileName}` : null,
      });
    }

    return NextResponse.json(templates);
  } catch (error) {
    console.error("Error in templates API:", error);
    return NextResponse.json(
      { error: "Failed to list templates" },
      { status: 500 }
    );
  }
}
