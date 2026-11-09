// Saves a Blob as a file the person chooses the place for, as a link to it that is clicked by code. Takes the document
// it works in, so a test can hand in a stand-in; nothing happens at import time.
//
//   saveBlob(new Blob([bytes], { type: "audio/wav" }), "beat.wav");

const REVOKE_AFTER_MS = 10_000; // the download has started long before, and the link is of no use after it

export function saveBlob(blob, name, { doc = document, urls = URL, wait = setTimeout } = {}) {
  const url = urls.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  doc.body.append(link); // Firefox only follows a link that is in the page
  link.click();
  link.remove();
  wait(() => urls.revokeObjectURL(url), REVOKE_AFTER_MS);
}
