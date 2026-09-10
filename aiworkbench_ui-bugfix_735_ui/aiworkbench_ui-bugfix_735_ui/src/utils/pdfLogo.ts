/**
 * Load a logo for PDF export while preserving its aspect ratio.
 */

export interface ReportLogoAsset {
  dataUrl: string;
  /** width / height */
  aspectRatio: number;
}

/** Logo served from aiworkbench_api/app/logo/logo.png (copied to public/report-logo.png). */
export const ASSESSMENT_REPORT_LOGO_URL = '/report-logo.png';

export function fitLogoDimensionsMm(
  aspectRatio: number,
  maxWidthMm: number,
  maxHeightMm: number,
): { widthMm: number; heightMm: number } {
  let widthMm = maxWidthMm;
  let heightMm = widthMm / aspectRatio;
  if (heightMm > maxHeightMm) {
    heightMm = maxHeightMm;
    widthMm = heightMm * aspectRatio;
  }
  return { widthMm, heightMm };
}

export function loadReportLogo(
  logoUrl: string,
  maxPixelWidth = 800,
  maxPixelHeight = 800,
): Promise<ReportLogoAsset | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(
          maxPixelWidth / img.naturalWidth,
          maxPixelHeight / img.naturalHeight,
          1,
        );
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          aspectRatio: width / height,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
}

/** @deprecated Use loadReportLogo for aspect-ratio-safe rendering. */
export function getCompressedLogoDataUrl(
  logoUrl: string,
  maxPixelWidth = 800,
  maxPixelHeight = 800,
): Promise<string | null> {
  return loadReportLogo(logoUrl, maxPixelWidth, maxPixelHeight).then((asset) => asset?.dataUrl ?? null);
}
