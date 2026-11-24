// Settings > Cloud save dialogs (docs/team/22 section 2, P1-D): recovery code, restore, delete my cloud data.
// Only reachable from Settings, never during a level. Needs the network; offline it says so and play is never blocked.
// The DOM and the game are injected: createCloudUi({ $, sync, openDialog, closeDialog, clearLocal, online, copy }).
export const TEXT = {
  intro: "Your progress is saved on this device and in the cloud. Without a recovery code, clearing this browser's data, uninstalling the app or losing this phone means you cannot get the cloud copy back.",
  offline: "Needs a connection",
  invalid: "That code did not work.",
  later: "Try again later.",
  error: "Something went wrong. Your progress is safe on this device."
};
const REASON = { invalid: TEXT.invalid, later: TEXT.later, offline: TEXT.offline, error: TEXT.error };

export function createCloudUi({ $, sync, openDialog, closeDialog, clearLocal, online = () => navigator.onLine !== false, copy }) {
  const body = () => $("cloud-body");
  const actions = () => $("cloud-actions");
  let busy = false;

  function el(tag, props = {}, text) {
    const e = document.createElement(tag);
    Object.assign(e, props);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const para = (text) => el("p", {}, text);
  const msg = () => el("p", { className: "cloud-msg", role: "alert" });
  function button(label, onClick, cls = "honey") {
    const b = el("button", { type: "button", className: `wide-btn ${cls}` }, label);
    b.addEventListener("click", onClick);
    return b;
  }
  function show(title, nodes, btns) {
    $("cloud-title").textContent = title;
    body().replaceChildren(...nodes);
    actions().replaceChildren(...btns);
    if (!$("cloud-dialog").open) openDialog($("cloud-dialog"));
    actions().querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  }
  const close = () => { if (!busy) closeDialog($("cloud-dialog")); };
  const needNet = () => !online() || !sync.available();

  // wraps a network step: one tap at a time, a plain message on failure
  async function run(btn, note, work) {
    if (busy) return;
    if (needNet()) { note.textContent = TEXT.offline; return; }
    busy = true; btn.disabled = true; note.textContent = "";
    try { await work(); } finally { busy = false; btn.disabled = false; }
  }

  function home() {
    const net = needNet();
    const note = msg();
    const nodes = [para(TEXT.intro)];
    if (net) nodes.push(para(TEXT.offline));
    const a = button("Show recovery code", showConfirm);
    const b = button("Restore from a code", restoreForm);
    const c = button("Delete my cloud data", deleteForm, "quiet");
    for (const x of [a, b, c]) x.disabled = net;
    show("Cloud save", [...nodes, note], [a, b, c, button("Close", close, "go")]);
  }

  // ---- show a recovery code ----
  function showConfirm() {
    const note = msg();
    const go = button("Show my code", () => run(go, note, async () => {
      const r = await sync.showRecovery();
      if (!r.ok) { note.textContent = REASON[r.reason] ?? TEXT.error; return; }
      showCode(r.code);
    }), "go");
    show("Recovery code", [para("Anyone with this code can load your progress. Keep it private. A new code replaces the old one, and the old one stops working."), note],
      [go, button("Back", home)]);
  }
  function showCode(code) {
    const copied = msg();
    copied.style.color = "inherit";
    const cp = button("Copy", async () => {
      try { await copy(code); copied.textContent = "Copied"; } catch { copied.textContent = "Copy did not work. Write the code down."; }
    });
    show("Your recovery code", [el("div", { className: "cloud-code" }, code), para("Shown only once. Write it down or copy it somewhere private."), copied],
      [cp, button("I saved it", () => { code = ""; home(); }, "go")]);
  }

  // ---- restore ----
  function restoreForm() {
    const input = el("input", { className: "cloud-input", type: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: false, maxLength: 24, placeholder: "XXXX-XXXX-XXXX-XXXX" });
    input.setAttribute("aria-label", "Recovery code");
    const note = msg();
    const go = button("Restore", () => run(go, note, async () => {
      const r = await sync.restore(input.value);
      if (!r.ok) { note.textContent = REASON[r.reason] ?? TEXT.error; return; }
      input.value = "";
      show("Restoring", [para("Your saved progress is being loaded. Your levels and coins on this device are kept.")], [button("Done", close, "go")]);
    }), "go");
    show("Restore from a code", [para("Type the recovery code you saved. Progress on this device is merged with it."), input, note], [go, button("Back", home)]);
  }

  // ---- delete ----
  function deleteForm() {
    const box = el("input", { type: "checkbox", id: "cloud-also-local" });
    const label = el("label", { className: "cloud-check" });
    label.append(box, el("span", {}, "Also remove progress from this device"));
    const note = msg();
    const go = button("Delete my cloud data", () => run(go, note, async () => {
      const r = await sync.deleteCloud();
      if (!r.ok) { note.textContent = REASON[r.reason] ?? TEXT.error; return; }
      if (box.checked) { clearLocal(); return; }
      show("Cloud data deleted", [para("Your cloud copy is gone. Your progress stays on this device. A new cloud save starts the next time you open the game.")], [button("Done", close, "go")]);
    }), "quiet");
    show("Delete my cloud data", [para("This deletes your saved progress from our server, including data merged into it from other devices. It cannot be undone."), label, note], [go, button("Keep it", home, "go")]);
  }

  return { open: home, TEXT };
}
