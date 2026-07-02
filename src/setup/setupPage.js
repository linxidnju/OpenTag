export function renderSetupPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenTag Setup</title>
  <style>
    :root { color-scheme: light; --text:#202124; --muted:#5f6368; --line:#dadce0; --bg:#fff; --soft:#f8fafd; --green:#0b7f56; --blue:#1a73e8; --danger:#b3261e; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--text); background:var(--bg); }
    main { max-width: 960px; margin: 0 auto; padding: 44px 28px; }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:28px; }
    h1 { font-size:40px; line-height:1.08; margin:0 0 10px; letter-spacing:0; }
    h2 { font-size:26px; line-height:1.18; margin:0 0 8px; }
    p { color:var(--muted); margin:0; line-height:1.55; }
    button { border:1px solid var(--line); background:#fff; color:var(--text); border-radius:6px; min-height:40px; padding:0 14px; font:inherit; cursor:pointer; }
    button.primary { background:var(--green); border-color:var(--green); color:#fff; font-weight:650; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    label { display:grid; gap:6px; color:var(--muted); font-size:13px; margin-top:14px; }
    input { border:1px solid var(--line); border-radius:6px; min-height:40px; padding:0 10px; font:inherit; color:var(--text); background:#fff; width:100%; }
    input:focus { outline:2px solid rgba(26,115,232,.16); border-color:var(--blue); }
    code { overflow-wrap:anywhere; }
    .progress { display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:20px; }
    .progress button { text-align:left; min-height:64px; padding:10px 12px; background:var(--soft); }
    .progress button.active { border-color:var(--green); background:#e6f4ef; }
    .progress strong { display:block; font-size:13px; }
    .progress span { display:block; color:var(--muted); font-size:12px; margin-top:2px; }
    .panel { border:1px solid var(--line); border-radius:8px; padding:24px; min-height:500px; background:#fff; }
    .step-pane { display:none; }
    .step-pane.active { display:block; }
    .agent-list { display:grid; gap:10px; margin-top:20px; }
    .agent { display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--line); border-radius:8px; padding:14px; }
    .agent.selectable { cursor:pointer; }
    .agent.selectable:hover { border-color:var(--blue); }
    .agent.selected { border-color:var(--green); background:#f7fcfa; }
    .agent.disabled { opacity:.62; }
    .agent strong { display:block; }
    .agent small { color:var(--muted); overflow-wrap:anywhere; }
    .pill { display:inline-flex; align-items:center; min-height:24px; padding:0 8px; border-radius:999px; font-size:12px; background:var(--soft); color:var(--muted); white-space:nowrap; }
    .pill.ok { color:var(--green); background:#e6f4ef; }
    .instruction-list { display:grid; gap:12px; margin:20px 0; }
    .instruction { display:flex; gap:12px; align-items:flex-start; padding:12px 0; border-bottom:1px solid #edf0f2; }
    .num { width:26px; height:26px; border-radius:999px; background:var(--soft); display:grid; place-items:center; font-size:12px; color:var(--muted); flex:0 0 auto; }
    .form-grid { display:grid; grid-template-columns: 1fr; max-width:560px; margin-top:18px; }
    .check { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; padding:11px 0; border-bottom:1px solid #edf0f2; }
    .check strong { display:block; font-size:13px; }
    .check small { color:var(--muted); overflow-wrap:anywhere; }
    .check .mark { font-weight:700; color:var(--danger); }
    .check.pass .mark { color:var(--green); }
    pre { white-space:pre-wrap; overflow:auto; background:#f6f8fa; border:1px solid var(--line); border-radius:8px; padding:12px; font-size:12px; max-height:220px; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; }
    .nav { display:flex; justify-content:space-between; gap:12px; margin-top:18px; }
    .status { color:var(--muted); font-size:13px; min-height:20px; margin-top:10px; }
    @media (max-width: 760px) { main { padding:28px 18px; } header { display:block; } h1 { font-size:32px; } .progress { grid-template-columns:1fr; } .panel { padding:18px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Connect OpenTag locally</h1>
        <p>Complete one step at a time: choose an agent, install Slack, save tokens, then verify.</p>
      </div>
      <button id="refresh">Scan</button>
    </header>

    <nav class="progress" aria-label="Setup progress">
      <button class="step-tab active" data-step="0"><strong>1. Agent</strong><span>Scan and choose runtime</span></button>
      <button class="step-tab" data-step="1"><strong>2. Slack app</strong><span>Import manifest</span></button>
      <button class="step-tab" data-step="2"><strong>3. Tokens</strong><span>Save locally</span></button>
      <button class="step-tab" data-step="3"><strong>4. Verify</strong><span>Run checklist</span></button>
    </nav>

    <section class="panel">
      <div class="step-pane active" data-pane="0">
        <h2>Choose a local agent</h2>
        <p>OpenTag scanned your machine for supported agent CLIs. Select the runtime this project should use.</p>
        <div class="agent-list" id="agents"></div>
        <div class="status" id="agentStatus">Scanning...</div>
      </div>

      <div class="step-pane" data-pane="1">
        <h2>Create the Slack app</h2>
        <p>This self-hosted flow uses Slack's manifest import. Hosted OAuth install will be a later cloud product.</p>
        <div class="instruction-list">
          <div class="instruction"><span class="num">1</span><p>Open Slack app creation, then choose <strong>Create from manifest</strong>.</p></div>
          <div class="instruction"><span class="num">2</span><p>Paste or upload the generated manifest from <code id="manifestPath"></code>.</p></div>
          <div class="instruction"><span class="num">3</span><p>Install the app to your workspace. After install, Slack will show the token values needed in the next step.</p></div>
        </div>
        <div class="actions">
          <button class="primary" id="openSlack">Create Slack app</button>
          <button id="copyManifest">Copy manifest</button>
          <button id="downloadManifest">Download YAML</button>
        </div>
        <div class="status" id="slackStatus"></div>
      </div>

      <div class="step-pane" data-pane="2">
        <h2>Save Slack tokens locally</h2>
        <p>Paste the Slack values from the app settings. They are written only to <code id="envPath"></code> and are not sent to a hosted service.</p>
        <div class="form-grid">
          <label>Bot token <input id="botToken" type="password" autocomplete="off" placeholder="xoxb-..." /></label>
          <label>App token <input id="appToken" type="password" autocomplete="off" placeholder="xapp-..." /></label>
          <label>Signing secret <input id="signingSecret" type="password" autocomplete="off" placeholder="Signing Secret" /></label>
        </div>
        <div class="actions"><button class="primary" id="saveTokens">Save tokens</button></div>
        <p id="tokenState" class="status"></p>
        <div class="status" id="tokenSaveStatus"></div>
      </div>

      <div class="step-pane" data-pane="3">
        <h2>Verify and run</h2>
        <p>When all required checks are green, invite OpenTag to Slack and mention it in a channel.</p>
        <pre id="commands">opentag doctor --strict
opentag daemon start</pre>
        <div id="checks"></div>
        <div class="status" id="nextAction"></div>
        <div class="actions"><button id="refresh2">Refresh status</button></div>
      </div>
    </section>

    <div class="nav">
      <button id="back">Back</button>
      <button class="primary" id="next">Continue</button>
    </div>
  </main>
  <script>
    let state = null;
    let diagnostics = null;
    let currentStep = 0;
    const slackUrl = "https://api.slack.com/apps?new_app=1";
    async function loadState() {
      document.getElementById("agentStatus").textContent = "Scanning...";
      const [response, diagnosticResponse] = await Promise.all([
        fetch("/v1/setup/state").then(r => r.json()),
        fetch("/v1/setup/diagnostics").then(r => r.json())
      ]);
      if (!response.ok) throw new Error(response.error || "Setup state failed");
      if (!diagnosticResponse.ok) throw new Error(diagnosticResponse.error || "Setup diagnostics failed");
      state = response;
      diagnostics = diagnosticResponse.diagnostics;
      render();
    }
    function setStep(step) {
      currentStep = Math.max(0, Math.min(3, step));
      renderStep();
    }
    function renderStep() {
      document.querySelectorAll(".step-tab").forEach((tab) => tab.classList.toggle("active", Number(tab.dataset.step) === currentStep));
      document.querySelectorAll(".step-pane").forEach((pane) => pane.classList.toggle("active", Number(pane.dataset.pane) === currentStep));
      document.getElementById("back").disabled = currentStep === 0;
      document.getElementById("next").textContent = currentStep === 3 ? "Done" : "Continue";
    }
    function render() {
      document.getElementById("manifestPath").textContent = state.manifestPath || "~/.opentag/slack-app-manifest.yml";
      document.getElementById("envPath").textContent = state.envPath || "~/.opentag/.env";
      const agents = document.getElementById("agents");
      agents.innerHTML = "";
      for (const agent of state.agents) {
        const row = document.createElement("div");
        const selectable = agent.installed && agent.configured;
        const selected = state.selectedRuntime === agent.runtimeId;
        row.className = "agent " + (selectable ? "selectable" : "disabled") + (selected ? " selected" : "");
        const label = selected ? "Selected" : !agent.configured ? "Not configured" : agent.installed ? "Installed" : "Not found";
        const body = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = agent.name;
        const detail = document.createElement("small");
        detail.textContent = agent.path || agent.version || "Built in fallback";
        const pill = document.createElement("span");
        pill.className = "pill " + (selectable ? "ok" : "");
        pill.textContent = label;
        body.append(name, detail);
        row.append(body, pill);
        if (selectable) row.onclick = () => selectRuntime(agent.runtimeId);
        agents.appendChild(row);
      }
      document.getElementById("agentStatus").textContent = "Selected runtime: " + state.selectedRuntime;
      const slack = state.slack || {};
      document.getElementById("tokenState").textContent = slack.hasBotToken && slack.hasAppToken && slack.hasSigningSecret ? "Slack tokens detected." : "Slack tokens are not complete yet.";
      document.getElementById("slackStatus").textContent = state.hasManifestFile ? "Manifest file is ready." : "Manifest can be generated from this page.";
      renderDiagnostics();
      renderStep();
    }
    function renderDiagnostics() {
      const checks = document.getElementById("checks");
      checks.innerHTML = "";
      for (const check of (diagnostics && diagnostics.checks) || []) {
        const row = document.createElement("div");
        row.className = "check " + (check.pass ? "pass" : "fail");
        const body = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = check.name;
        const detail = document.createElement("small");
        detail.textContent = check.detail || "";
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = check.pass ? "OK" : check.required ? "Fix" : "Optional";
        body.append(name, detail);
        row.append(body, mark);
        checks.appendChild(row);
      }
      document.getElementById("nextAction").textContent = diagnostics && diagnostics.nextActions && diagnostics.nextActions[0] ? diagnostics.nextActions[0] : "";
    }
    async function refreshDiagnostics() {
      const diagnosticResponse = await fetch("/v1/setup/diagnostics").then(r => r.json());
      if (diagnosticResponse.ok) diagnostics = diagnosticResponse.diagnostics;
    }
    async function selectRuntime(runtimeId) {
      document.getElementById("agentStatus").textContent = "Saving runtime...";
      const response = await fetch("/v1/setup/runtime", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ runtimeId }) }).then(r => r.json());
      if (!response.ok) throw new Error(response.error || "Runtime save failed");
      state = response;
      await refreshDiagnostics();
      render();
    }
    document.querySelectorAll(".step-tab").forEach((tab) => { tab.onclick = () => setStep(Number(tab.dataset.step)); });
    document.getElementById("back").onclick = () => setStep(currentStep - 1);
    document.getElementById("next").onclick = () => currentStep === 3 ? loadState() : setStep(currentStep + 1);
    document.getElementById("refresh").onclick = loadState;
    document.getElementById("refresh2").onclick = loadState;
    document.getElementById("openSlack").onclick = () => window.open(slackUrl, "_blank");
    document.getElementById("downloadManifest").onclick = () => window.open("/setup/slack-app-manifest.yml", "_blank");
    document.getElementById("saveTokens").onclick = async () => {
      try {
        document.getElementById("tokenSaveStatus").textContent = "Saving tokens...";
        const response = await fetch("/v1/setup/slack/tokens", {
          method:"POST",
          headers:{ "content-type":"application/json" },
          body: JSON.stringify({
            botToken: document.getElementById("botToken").value,
            appToken: document.getElementById("appToken").value,
            signingSecret: document.getElementById("signingSecret").value
          })
        }).then(r => r.json());
        if (!response.ok) throw new Error(response.error || "Token save failed");
        state = response;
        await refreshDiagnostics();
        document.getElementById("botToken").value = "";
        document.getElementById("appToken").value = "";
        document.getElementById("signingSecret").value = "";
        document.getElementById("tokenSaveStatus").textContent = "Tokens saved locally.";
        render();
      } catch (err) {
        document.getElementById("tokenSaveStatus").textContent = err.message;
      }
    };
    document.getElementById("copyManifest").onclick = async () => {
      const data = await fetch("/v1/setup/slack/manifest").then(r => r.json());
      if (!data.ok) throw new Error(data.error || "Manifest load failed");
      await navigator.clipboard.writeText(data.manifest);
      document.getElementById("slackStatus").textContent = "Manifest copied.";
    };
    loadState().catch(err => { document.body.innerHTML = '<main><h1>Setup failed</h1><pre>' + err.stack + '</pre></main>'; });
  </script>
</body>
</html>`;
}
