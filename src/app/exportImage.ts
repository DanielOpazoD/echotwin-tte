/**
 * Export the current display as PNG with a mandatory synthetic-training watermark (spec 42, 69).
 * No patient data exists in the app; the watermark makes the provenance explicit anyway.
 */
export function composeDisplay(): HTMLCanvasElement | null {
  const img = document.querySelector<HTMLCanvasElement>(
    'canvas[aria-label="Imagen ecográfica simulada"]',
  );
  const ov = document.querySelector<HTMLCanvasElement>('canvas.overlay');
  if (!img) return null;
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  if (ov) ctx.drawImage(ov, 0, 0, out.width, out.height);
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,200,87,0.9)';
  ctx.fillText('SYNTHETIC TRAINING — EchoTwin TTE — no diagnóstico', 10, out.height - 10);
  return out;
}

export function exportDisplayPng(caseId: string): void {
  const out = composeDisplay();
  if (!out) return;
  const a = document.createElement('a');
  a.download = `echotwin-${caseId}-${Date.now()}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
}

/** The composed display as a PNG blob (review mode copies it to the clipboard, decision 134). */
export function displayPngBlob(): Promise<Blob | null> {
  const out = composeDisplay();
  if (!out) return Promise.resolve(null);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}
