// Small helpers for views that redraw often, like the sampler's, which redraws every step while playing. No work at
// import time. They do two things a plain assignment does not.
//
// Only what changed is written. Assigning the same text to an element still replaces it, which a screen reader can
// announce again, and sets an attribute to the value it has still counts as a change to anything watching.
//
//   setText(el, "Bar 1 of 2");
//   setAttr(el, "aria-pressed", "true");
//
// Focus is not lost when a control goes away. A button that is disabled, or a group that is hidden, while a keyboard
// user is on it drops focus to the page, where keys such as Escape no longer reach the part of the page they were
// working in. So focus is handed to a neighbour first.
//
//   setDisabled(undoButton, true, copyButton);       // the fallback may also be a list: the first that can take it
//   setHidden(trimGroup, true, loadButton);
//   setDisabledMany([[undo, true, redo], [redo, false, undo]]);   // those being enabled go first, so they can take focus

export function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

export function setAttr(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

// `doc` is the document that holds focus, so a test can hand in a stand-in. `fallback` is an element, a list of
// them (the first that is not disabled takes it), or nothing.
function handOffFocus(element, fallback, doc) {
  const focused = doc.activeElement;
  if (!focused || !(focused === element || element.contains?.(focused))) return;
  const target = [fallback].flat().find((candidate) => candidate && !candidate.disabled && candidate !== element);
  target?.focus();
}

export function setDisabled(element, disabled, fallback, doc = document) {
  if (disabled) handOffFocus(element, fallback, doc);
  if (element.disabled !== disabled) element.disabled = disabled;
}

export function setHidden(element, hidden, fallback, doc = document) {
  if (hidden) handOffFocus(element, fallback, doc);
  if (element.hidden !== hidden) element.hidden = hidden;
}

// Several controls at once, each as [element, disabled, fallback]. A control that is being enabled is done first, so
// that one disabled in the same update (Undo and Redo trading places) can hand its focus to it.
export function setDisabledMany(items, doc = document) {
  for (const [element, disabled] of items) if (!disabled) setDisabled(element, false, null, doc);
  for (const [element, disabled, fallback] of items) if (disabled) setDisabled(element, true, fallback, doc);
}
