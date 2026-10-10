async function runDiagnostics() {
  const info = await bridge.diagnostics();
  const rows = info.checks || [];
  const score = Math.max(0, Math.min(100, info.score ?? 0));

  const body = document.getElementById("diag-body");
  const cls = score >= 80 ? "diag-ok" : score >= 50 ? "diag-warn" : "diag-err";
  const rowsHtml = rows
    .map((r) => {
      const c = r.status === "ok" ? "diag-ok" : r.status === "warn" ? "diag-warn" : "diag-err";
      return `<div class="diag-row"><span>${r.name}</span><span class="${c}">${r.detail}</span></div>`;
    })
    .join("");

  const hint = info.brandHint ? `<div class="diag-row"><span>${info.brandHint.title}</span><span class="diag-warn">${info.brandHint.text}</span></div>` : "";

  body.innerHTML = `
    <div class="diag-score ${cls}">health ${score}/100</div>
    ${rowsHtml}
    ${hint}
    <div class="diag-actions">
      <button id="diag-copy">Copy report</button>
      <button id="diag-restart-adb">Restart adb</button>
      <button id="diag-refresh">Refresh</button>
    </div>
    <pre id="diag-report" class="hidden"></pre>
  `;

  document.getElementById("diag-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(info.report || JSON.stringify(info, null, 2));
    log("diagnostics report copied to clipboard");
  });
  document.getElementById("diag-restart-adb").addEventListener("click", async () => {
    const r = await bridge.restartAdb();
    log(r && r.ok ? "adb restarted" : `adb restart failed: ${r && r.error}`, !(r && r.ok));
    refreshDevices();
  });
  document.getElementById("diag-refresh").addEventListener("click", runDiagnostics);
  return info;
}

document.getElementById("btn-diag").addEventListener("click", async () => {
  const panel = document.getElementById("diag-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    const info = await runDiagnostics();
    log(`diagnostics: health ${info.score}/100`);
  }
});

document.getElementById("diag-close").addEventListener("click", () => {
  document.getElementById("diag-panel").classList.add("hidden");
});