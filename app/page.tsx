"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";

export default function Home() {
  const [candidateName, setCandidateName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const certificateRef = useRef<HTMLDivElement>(null);

  const displayCandidate = useMemo(
    () => candidateName.trim() || "Candidate Name",
    [candidateName],
  );
  const displayTeam = useMemo(() => teamName.trim() || "Team Name", [teamName]);

  const handleDownloadPdf = async () => {
    if (!certificateRef.current || isDownloading) {
      return;
    }

    setIsDownloading(true);

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(certificateRef.current, {
        backgroundColor: "#ffffff",
        scale: 3,
        useCORS: true,
      });

      const imageData = canvas.toDataURL("image/png", 1);
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageRatio = canvas.width / canvas.height;
      const pageRatio = pageWidth / pageHeight;

      const renderWidth = imageRatio > pageRatio ? pageWidth : pageHeight * imageRatio;
      const renderHeight = imageRatio > pageRatio ? pageWidth / imageRatio : pageHeight;
      const offsetX = (pageWidth - renderWidth) / 2;
      const offsetY = (pageHeight - renderHeight) / 2;

      pdf.addImage(imageData, "PNG", offsetX, offsetY, renderWidth, renderHeight);
      pdf.save("certificate.pdf");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
            Certificate Builder
          </p>
          <h1 className="mt-3 text-3xl font-bold text-slate-900">
            Generate a certificate preview
          </h1>
          <div className="mt-8 space-y-5">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Candidate Name
              </span>
              <input
                className="mt-2 w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                placeholder="Enter candidate name"
                type="text"
                value={candidateName}
                onChange={(event) => setCandidateName(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Team Name
              </span>
              <input
                className="mt-2 w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                placeholder="Enter team name"
                type="text"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-slate-900">
              Certificate Preview
            </h2>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
              Live preview
            </span>
          </div>

          <div
            ref={certificateRef}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-certificate"
          >
            <div className="relative aspect-[2000/1414] w-full">
              <Image
                src="/certificate-template.png"
                alt="Certificate template"
                fill
                priority
                sizes="(min-width: 1024px) 760px, calc(100vw - 32px)"
                className="object-contain"
              />

              <div className="absolute left-1/2 top-[44.2%] flex min-h-[14%] w-[58%] -translate-x-1/2 flex-col items-center justify-center bg-white/95 px-[2.5%] py-[1.1%] text-center">
                <p
                  className="mx-auto max-w-full [overflow-wrap:anywhere] text-center font-normal leading-none text-[#171f24]"
                  style={{
                    fontFamily:
                      '"Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive',
                    fontSize: "clamp(1rem, 3vw, 2.85rem)",
                  }}
                >
                  {displayCandidate}
                </p>
                <p
                  className="mx-auto mt-[1.4%] max-w-full [overflow-wrap:anywhere] text-center font-medium leading-tight text-[#27323a]"
                  style={{ fontSize: "clamp(0.55rem, 1.25vw, 1.15rem)" }}
                >
                  {displayTeam}
                </p>
              </div>
            </div>
          </div>

          <button
            className="mt-5 rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-300 disabled:cursor-not-allowed disabled:bg-slate-400"
            type="button"
            onClick={handleDownloadPdf}
            disabled={isDownloading}
          >
            {isDownloading ? "Preparing PDF..." : "Download PDF"}
          </button>
        </section>
      </div>
    </main>
  );
}
