// Native share (phone share sheet) with graceful fallbacks: share files where supported, else URL, else
// open/download. Used for the floor plan (PDF) and the 3D lot screenshot.

async function shareFiles(files, meta) {
  try {
    if (navigator.canShare?.({ files })) { await navigator.share({ files, ...meta }); return true; }
  } catch (e) { if (e?.name === "AbortError") return true; }
  return false;
}
async function shareLink(url, meta) {
  try {
    if (navigator.share) { await navigator.share({ url, ...meta }); return true; }
  } catch (e) { if (e?.name === "AbortError") return true; }
  return false;
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Share a hosted PDF (fetch -> File -> share sheet). Fallbacks: share the link, else open it.
export async function sharePdf(url, filename, title) {
  try {
    const blob = await fetch(url).then((r) => r.blob());
    if (await shareFiles([new File([blob], filename, { type: "application/pdf" })], { title })) return;
  } catch { /* fall through */ }
  if (await shareLink(new URL(url, location.href).href, { title })) return;
  window.open(url, "_blank");
}

// Share a canvas as a PNG (the 3D lot screenshot). Fallback: download the image.
export async function shareCanvas(canvas, filename, title) {
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return;
  if (await shareFiles([new File([blob], filename, { type: "image/png" })], { title })) return;
  download(blob, filename);
}
