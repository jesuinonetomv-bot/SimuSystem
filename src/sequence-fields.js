import { sequenceFields, sequenceNote } from "./fault-data.js?v=49";
import { validateProtection } from "./electrical-studies.js?v=49";

// Extend the existing equipment form without replacing its other electrical data.
export function attachSequenceFields(form) {
  const fieldset = document.createElement("fieldset"); fieldset.className = "sequence-fields";
  const legend = document.createElement("legend"); legend.textContent = "Curto entre fases / fase-terra e sequência de atuação";
  const host = document.createElement("div"); host.className = "case-fields";
  const note = document.createElement("p"); note.className = "study-note"; note.textContent = sequenceNote;
  fieldset.append(legend, host, note); form.querySelector(".electrical-body").append(fieldset);
  let descriptors = [];
  return {
    open(item) {
      descriptors = sequenceFields(item.type); host.replaceChildren(); fieldset.hidden = !descriptors.length;
      for (const [key, label, kind, min, choices, value] of descriptors) {
        const wrapper = document.createElement("label"), input = document.createElement(kind === "select" ? "select" : "input");
        wrapper.append(document.createTextNode(label)); input.name = key;
        if (kind === "select") for (const [id, text] of Object.entries(choices)) input.add(new Option(text, id));
        else { input.type = "number"; input.min = min; input.step = "any"; }
        input.value = item.electrical?.[key] ?? value ?? ""; wrapper.append(input); host.append(wrapper);
      }
    },
    read() {
      const out = {};
      for (const [key, label, kind, min] of descriptors) {
        const input = form.elements[key], v = input.value;
        if (kind === "number" && v !== "" && (!Number.isFinite(+v) || +v < min)) throw Error(label + " inválido.");
        out[key] = kind === "number" ? v === "" ? null : +v : v;
      }
      if (out.earthCurve && out.earthCurve !== "none") validateProtection({ protectionCurve: out.earthCurve, pickupA: out.earthPickupA,
        timeMultiplier: out.earthTimeMultiplier, definiteTime: out.earthDelaySeconds, instantaneousA: out.earthInstantaneousA, instantaneousTime: out.earthInstantaneousTime });
      return out;
    },
  };
}
