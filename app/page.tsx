"use client";

import Image from "next/image";
import Papa from "papaparse";
import { ChangeEvent, useMemo, useState, useEffect } from "react";

type CertificateRecord = {
  candidateName: string;
  teamName: string;
};

type Template = {
  id: string;
  name: string;
  fileName: string;
  previewUrl: string | null;
};

type ParsedCsv = {
  fields: string[];
  rows: CertificateRecord[];
};

function sanitizeFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "certificate"
  );
}

function normalizeCsvHeader(header: string) {
  return header.replace(/^\uFEFF/, "").trim();
}

function formatParsedHeaders(fields: string[]) {
  return fields.length > 0 ? fields.join(", ") : "none";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

async function loadSaveAs() {
  const fileSaver = await import("file-saver");
  return fileSaver.default;
}

function parseCsvRecords(csvText: string): ParsedCsv {
  const normalizedCsvText = csvText.replace(/^\uFEFF/, "");
  const result = Papa.parse<Record<string, string>>(normalizedCsvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeCsvHeader,
    delimitersToGuess: [",", "\t", ";", "|"],
  });
  const fields = (result.meta.fields ?? []).map(normalizeCsvHeader);

  const singleCommaSeparatedHeader =
    fields.length === 1 && fields[0].includes(",");

  if (singleCommaSeparatedHeader) {
    const expandedFields = fields[0].split(",").map(normalizeCsvHeader);
    const singleFieldName = fields[0];
    const rows = result.data.map((row) => {
      const values = (row[singleFieldName] ?? "")
        .split(",")
        .map((value) => value.trim());

      return {
        candidateName: values[expandedFields.indexOf("candidateName")] ?? "",
        teamName: values[expandedFields.indexOf("teamName")] ?? "",
      };
    });

    return {
      fields: expandedFields,
      rows,
    };
  }

  return {
    fields,
    rows: result.data.map((row) => ({
      candidateName: row.candidateName?.trim() ?? "",
      teamName: row.teamName?.trim() ?? "",
    })),
  };
}

export default function Home() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);

  const [candidateName, setCandidateName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [records, setRecords] = useState<CertificateRecord[]>([]);
  const [csvError, setCsvError] = useState("");
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);

  // Fetch templates on mount
  useEffect(() => {
    let isMounted = true;
    async function fetchTemplates() {
      try {
        const response = await fetch("/api/templates");
        if (response.ok) {
          const data = await response.json();
          if (isMounted) {
            setTemplates(data);
            if (data.length > 0) {
              setSelectedTemplate(data[0]);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load templates", error);
      } finally {
        if (isMounted) {
          setIsLoadingTemplates(false);
        }
      }
    }

    fetchTemplates();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleDownloadPdf = async () => {
    if (!selectedTemplate || isDownloading) {
      return;
    }

    const trimmedName = candidateName.trim();
    if (!trimmedName) {
      alert("Please enter a Candidate Name first.");
      return;
    }

    setIsDownloading(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          candidateName: trimmedName,
          teamName: teamName.trim(),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to generate PDF certificate.");
      }

      const pdfBlob = await response.blob();
      const saveAs = await loadSaveAs();
      saveAs(pdfBlob, `${sanitizeFileName(trimmedName)}.pdf`);
    } catch (error) {
      console.error(error);
      alert(`Error generating certificate: ${getErrorMessage(error)}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCsvUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setCsvError("");
    setRecords([]);

    if (!file) {
      return;
    }

    try {
      const { fields, rows } = parseCsvRecords(await file.text());
      const hasRequiredColumns =
        fields.includes("candidateName") && fields.includes("teamName");

      if (!hasRequiredColumns) {
        setCsvError(
          `CSV must include candidateName and teamName columns. Parsed headers: ${formatParsedHeaders(
            fields,
          )}.`,
        );
        event.target.value = "";
        return;
      }

      const parsedRecords = rows.filter((row) => row.candidateName && row.teamName);

      if (parsedRecords.length === 0) {
        setCsvError("No valid records found in the CSV file.");
        event.target.value = "";
        return;
      }

      setRecords(parsedRecords);
    } catch {
      setCsvError("Unable to parse the selected CSV file.");
    } finally {
      event.target.value = "";
    }
  };

  const handleGenerateAllCertificates = async () => {
    if (records.length === 0 || !selectedTemplate || isBulkGenerating) {
      return;
    }

    setIsBulkGenerating(true);
    setCsvError("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          records,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to bulk generate certificates.");
      }

      const zipBlob = await response.blob();
      const saveAs = await loadSaveAs();
      saveAs(zipBlob, "certificates.zip");
    } catch (error) {
      console.error(error);
      setCsvError(
        `Something went wrong while generating the certificates: ${getErrorMessage(
          error,
        )}`,
      );
    } finally {
      setIsBulkGenerating(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[380px_1fr]">
        {/* Control Panel */}
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm flex flex-col gap-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
              Certificate Builder
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              Create Your Certificate
            </h1>
          </div>

          {/* Template Selection */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-slate-700 block">
              1. Choose Template
            </span>
            {isLoadingTemplates ? (
              <div className="animate-pulse bg-slate-100 rounded-md h-24 w-full flex items-center justify-center text-xs text-slate-400">
                Loading templates...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {templates.map((tpl) => {
                  const isSelected = selectedTemplate?.id === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedTemplate(tpl)}
                      className={`group flex flex-col items-center rounded-lg border p-2 text-left transition focus:outline-none ${
                        isSelected
                          ? "border-amber-600 ring-2 ring-amber-100 bg-amber-50/30"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {tpl.previewUrl ? (
                        <div className="relative aspect-[4/3] w-full overflow-hidden rounded border border-slate-100 bg-slate-50">
                          <Image
                            src={tpl.previewUrl}
                            alt={tpl.name}
                            fill
                            sizes="(max-width: 380px) 150px, 200px"
                            className="object-contain transition group-hover:scale-[1.02]"
                          />
                        </div>
                      ) : (
                        <div className="flex aspect-[4/3] w-full items-center justify-center rounded border border-slate-100 bg-slate-50 text-xs text-slate-400">
                          No Preview
                        </div>
                      )}
                      <span className="mt-2 text-xs font-semibold text-slate-700 truncate w-full text-center">
                        {tpl.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Input Form */}
          <div className="space-y-4">
            <span className="text-sm font-medium text-slate-700 block">
              2. Enter Certificate Details
            </span>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase">
                Candidate Name
              </span>
              <input
                className="mt-1.5 w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                placeholder="Enter candidate name"
                type="text"
                value={candidateName}
                onChange={(event) => setCandidateName(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase">
                Team Name
              </span>
              <input
                className="mt-1.5 w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                placeholder="Enter team name"
                type="text"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
              />
            </label>
          </div>
        </section>

        {/* Preview and Generation Area */}
        <section className="min-w-0 flex flex-col justify-between">
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-slate-900">
                Selected Template Preview
              </h2>
              <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-sm font-medium text-stone-600">
                Reference layout
              </span>
            </div>

            {/* Static Image Preview of PPTX Template */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
              <div className="relative aspect-[2000/1414] w-full bg-slate-50 flex items-center justify-center">
                {selectedTemplate?.previewUrl ? (
                  <Image
                    src={selectedTemplate.previewUrl}
                    alt={`${selectedTemplate.name} preview`}
                    fill
                    priority
                    sizes="(min-width: 1024px) 760px, calc(100vw - 32px)"
                    className="object-contain"
                  />
                ) : (
                  <div className="text-slate-400 text-sm">
                    {isLoadingTemplates ? "Loading template previews..." : "Select a template"}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <button
              className="rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-300 disabled:cursor-not-allowed disabled:bg-slate-400"
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloading || !selectedTemplate}
            >
              {isDownloading ? "Generating PDF..." : "Download PDF"}
            </button>
          </div>
        </section>
      </div>

      {/* Bulk Generation Section */}
      <section className="mx-auto mt-8 max-w-6xl rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
              Bulk Generation
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">
              Upload CSV records
            </h2>
          </div>

          <label className="block w-full md:max-w-sm">
            <span className="text-sm font-medium text-slate-700">
              CSV file
            </span>
            <input
              className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-sm text-slate-900 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-amber-100"
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvUpload}
            />
          </label>
        </div>

        {csvError ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {csvError}
          </p>
        ) : null}

        {records.length > 0 ? (
          <>
            <div className="mt-6 overflow-hidden rounded-lg border border-stone-200">
              <div className="max-h-80 overflow-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-stone-50 text-slate-700">
                    <tr>
                      <th className="border-b border-stone-200 px-4 py-3 font-semibold">
                        #
                      </th>
                      <th className="border-b border-stone-200 px-4 py-3 font-semibold">
                        Candidate Name
                      </th>
                      <th className="border-b border-stone-200 px-4 py-3 font-semibold">
                        Team Name
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {records.map((record, index) => (
                      <tr key={`${record.candidateName}-${record.teamName}-${index}`}>
                        <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {record.candidateName}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {record.teamName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <button
              className="mt-5 rounded-md bg-amber-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-amber-800 focus:outline-none focus:ring-4 focus:ring-amber-200 disabled:cursor-not-allowed disabled:bg-amber-300"
              type="button"
              onClick={handleGenerateAllCertificates}
              disabled={isBulkGenerating || !selectedTemplate}
            >
              {isBulkGenerating
                ? "Generating Certificates..."
                : `Generate All Certificates (${selectedTemplate?.name || ""})`}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}
