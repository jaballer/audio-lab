// How a person picks an audio file for a pad: a Load button for the selected pad, a file dropped on a pad,
// and a button to put the built-in sound back. It reports; main.js decides what to do with the file.
//
//   const loader = createSampleLoader({
//     pads,            // the element holding the pads (each has data-pad="index"): files can be dropped on them
//     input,           // an <input type="file"> (kept hidden)
//     loadButton, resetButton,
//     getSelected,     // () => the selected pad's index
//     onFile,          // (padIndex, file)
//     onReset,         // (padIndex)
//   });
//   loader.setResetEnabled(false);   // the selected pad plays its built-in sound already

const DROP_CLASS = "drop";

const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");

export function createSampleLoader({ pads, input, loadButton, resetButton, getSelected, onFile, onReset }) {
  loadButton.addEventListener("click", () => input.click());

  input.addEventListener("change", () => {
    const [file] = input.files;
    input.value = ""; // so choosing the same file again still counts as a change
    if (file) onFile(getSelected(), file);
  });

  resetButton.addEventListener("click", () => onReset(getSelected()));

  const padAt = (event) => event.target.closest?.("[data-pad]") ?? null;
  const clearDrop = () => pads.querySelectorAll(`.${DROP_CLASS}`).forEach((el) => el.classList.remove(DROP_CLASS));

  // Without preventDefault on dragover the browser would open the file instead of dropping it here.
  pads.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const pad = padAt(event);
    clearDrop();
    pad?.classList.add(DROP_CLASS);
  });
  pads.addEventListener("dragleave", (event) => {
    if (!pads.contains(event.relatedTarget)) clearDrop();
  });
  pads.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    clearDrop();
    const pad = padAt(event);
    const [file] = event.dataTransfer.files;
    if (pad && file) onFile(Number(pad.dataset.pad), file);
  });

  return {
    setResetEnabled(enabled) {
      resetButton.disabled = !enabled;
    },
  };
}
