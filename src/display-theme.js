export const DEFAULT_THEME = Object.freeze({
  energized: "#000000", deenergized: "#c0c0c0", selected: "#ff0000", alarm: "#ff0000",
  warning: "#ff00ff", acknowledged: "#00ff00", fault: "#c00000", tag: "#0000ff",
  result: "#c00000", background: "#ffffff", grid: "#eceef1", closed: "#000000", open: "#00854a", maintenance: "#8a44ad",
});
export const CLASSIC_THEME = Object.freeze({ ...DEFAULT_THEME, energized: "#263749", deenergized: "#8c99a6",
  selected: "#1976d2", alarm: "#c62828", warning: "#d28a00", acknowledged: "#15972b",
  tag: "#245b9c", result: "#ad2434", background: "#fbfcfd", closed: "#c7353e", open: "#198750" });
export const THEME_LABELS = { energized: "Energizado (AC)", deenergized: "Desenergizado", selected: "Selecionado",
  alarm: "Alarme", warning: "Advertência", acknowledged: "Alarme reconhecido", fault: "Barra com alerta crítico",
  tag: "TAG e dados nominais", result: "Resultados e medições", background: "Fundo do unifilar", grid: "Grade da modelagem",
  closed: "Disjuntor fechado", open: "Disjuntor aberto", maintenance: "Equipamento em manutenção" };
export function normalizeTheme(input = {}) {
  const theme = {};
  for (const key of Object.keys(DEFAULT_THEME)) {
    const color = input[key] ?? DEFAULT_THEME[key];
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) throw Error("Cor inválida: " + THEME_LABELS[key]);
    theme[key] = color.toLowerCase();
  }
  return theme;
}
export function readTheme(storage) {
  try { return normalizeTheme(JSON.parse(storage.getItem("simuDisplayTheme") || "{}")); } catch { return { ...DEFAULT_THEME }; }
}
export function attachThemeEditor({ dialog, storage = localStorage }) {
  const host = dialog.querySelector("#themeEditor"), status = dialog.querySelector("#themeStatus");
  let saved = readTheme(storage), draft = { ...saved };
  const apply = theme => {
    for (const [key, color] of Object.entries(theme)) document.documentElement.style.setProperty("--theme-" + key, color);
    for (const el of dialog.querySelectorAll("[data-theme-swatch]")) el.style.background = theme[el.dataset.themeSwatch];
  };
  const fields = [];
  for (const [key, label] of Object.entries(THEME_LABELS)) {
    const row = document.createElement("label"); row.className = "theme-field";
    const text = document.createElement("span"); text.textContent = label;
    const color = document.createElement("input"); color.type = "color"; color.value = draft[key];
    color.setAttribute("aria-label", label); color.dataset.themeKey = key;
    color.oninput = () => { draft[key] = color.value; apply(draft); status.textContent = "Prévia do tema. Clique em Salvar tema para manter as cores."; };
    row.append(text, color); host.append(row); fields.push(color);
  }
  const sync = () => { fields.forEach(field => { field.value = draft[field.dataset.themeKey]; }); apply(draft);
    const equals = theme => Object.keys(DEFAULT_THEME).every(key => theme[key] === draft[key]);
    dialog.querySelector("#themePreset").value = equals(DEFAULT_THEME) ? "etap" : equals(CLASSIC_THEME) ? "classic" : "custom";
  };
  dialog.querySelector("#themePreset").onchange = event => {
    const preset = event.target.value;
    if (preset === "custom") return;
    draft = { ...(preset === "classic" ? CLASSIC_THEME : DEFAULT_THEME) }; sync();
    status.textContent = "Prévia do tema. Clique em Salvar tema para manter as cores.";
  };
  for (const field of fields) field.addEventListener("input", () => { dialog.querySelector("#themePreset").value = "custom"; });
  dialog.querySelector("#saveTheme").onclick = () => {
    try { const theme = normalizeTheme(draft); storage.setItem("simuDisplayTheme", JSON.stringify(theme)); saved = theme;
      status.textContent = "Tema salvo neste aparelho.";
    } catch (e) { status.textContent = "Não foi possível salvar o tema: " + e.message; }
  };
  dialog.querySelector("#cancelTheme").onclick = () => { draft = { ...saved }; sync(); status.textContent = "Cores salvas restauradas."; };
  dialog.addEventListener("close", () => { draft = { ...saved }; sync(); });
  sync();
  return { current: () => ({ ...saved }) };
}
