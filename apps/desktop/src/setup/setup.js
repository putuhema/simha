// Connection settings page of the desktop app. Talks to the main process through window.simrsDesktop.
const api = window.simrsDesktop;
const $ = (id) => document.getElementById(id);
const form = $("form");

const showMode = (mode) => {
  for (const el of document.querySelectorAll(".detail")) el.classList.toggle("on", el.dataset.for === mode);
};
const setMessage = (el, text, tone) => {
  el.textContent = text;
  el.className = `small ${tone === "good" ? "good" : tone === "bad" ? "bad" : "muted"}`;
};

const load = async () => {
  const state = await api.setup.state();
  const mode = state.mode ?? "remote";
  form.mode.value = mode;
  showMode(mode);
  $("serverUrl").value = state.serverUrl || "";
  $("port").value = String(state.port);
  $("envFile").textContent = state.envFile ?? "-";
  $("launcher").textContent = state.khanzaLauncher ?? "Belum dipilih";
  $("version").textContent = `SIMRS Harness ${state.version}`;
  if (state.error) {
    $("error").textContent = state.error;
    $("error").hidden = false;
  }
};

form.addEventListener("change", (event) => {
  if (event.target.name === "mode") showMode(event.target.value);
});

$("test").addEventListener("click", async () => {
  setMessage($("testResult"), "Menguji…");
  const result = await api.setup.testServer($("serverUrl").value);
  setMessage($("testResult"), result.message, result.ok ? "good" : "bad");
});

$("openConfig").addEventListener("click", () => api.setup.openConfigFolder());

$("chooseLauncher").addEventListener("click", async () => {
  const file = await api.chooseKhanzaLauncher();
  if (file) $("launcher").textContent = file;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("save").disabled = true;
  setMessage($("saveResult"), "Menyambungkan…");
  const result = await api.setup.save({ mode: form.mode.value, serverUrl: $("serverUrl").value, port: Number($("port").value) });
  if (!result.ok) {
    setMessage($("saveResult"), result.message, "bad");
    $("save").disabled = false;
  }
});

void load();
