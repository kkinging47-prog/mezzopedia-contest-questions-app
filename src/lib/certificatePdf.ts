import { jsPDF } from 'jspdf';

export type CertificateSettings = {
  templateUrl?: string;
  certificateDate?: string;
  nameX?: number;
  nameY?: number;
  categoryX?: number;
  categoryY?: number;
  dateX?: number;
  dateY?: number;
  nameFontSize?: number;
  categoryFontSize?: number;
  dateFontSize?: number;
  textColor?: string;
};

export type CertificateRecipient = {
  name: string;
  category: string;
  usercode?: string;
};

export const DEFAULT_CERTIFICATE_SETTINGS: Required<CertificateSettings> = {
  templateUrl: '',
  certificateDate: '2026-12-01',
  nameX: 148,
  nameY: 92,
  categoryX: 148,
  categoryY: 112,
  dateX: 148,
  dateY: 132,
  nameFontSize: 26,
  categoryFontSize: 16,
  dateFontSize: 14,
  textColor: '#001f4d'
};

export function normalizeCertificateSettings(value?: CertificateSettings | null): Required<CertificateSettings> {
  return {
    ...DEFAULT_CERTIFICATE_SETTINGS,
    ...(value || {}),
    nameX: Number(value?.nameX || DEFAULT_CERTIFICATE_SETTINGS.nameX),
    nameY: Number(value?.nameY || DEFAULT_CERTIFICATE_SETTINGS.nameY),
    categoryX: Number(value?.categoryX || DEFAULT_CERTIFICATE_SETTINGS.categoryX),
    categoryY: Number(value?.categoryY || DEFAULT_CERTIFICATE_SETTINGS.categoryY),
    dateX: Number(value?.dateX || DEFAULT_CERTIFICATE_SETTINGS.dateX),
    dateY: Number(value?.dateY || DEFAULT_CERTIFICATE_SETTINGS.dateY),
    nameFontSize: Number(value?.nameFontSize || DEFAULT_CERTIFICATE_SETTINGS.nameFontSize),
    categoryFontSize: Number(value?.categoryFontSize || DEFAULT_CERTIFICATE_SETTINGS.categoryFontSize),
    dateFontSize: Number(value?.dateFontSize || DEFAULT_CERTIFICATE_SETTINGS.dateFontSize)
  };
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '').trim();
  if (!/^([0-9a-f]{6})$/i.test(cleaned)) return { r: 0, g: 31, b: 77 };
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16)
  };
}

async function imageToDataUrl(url: string) {
  if (!url) return '';
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load certificate template image.');
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read certificate template image.'));
    reader.readAsDataURL(blob);
  });
}

function formatDate(dateValue: string) {
  if (!dateValue) return '';
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

export async function createCertificatePdf(recipient: CertificateRecipient, rawSettings?: CertificateSettings | null) {
  const settings = normalizeCertificateSettings(rawSettings);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  if (settings.templateUrl) {
    try {
      const template = await imageToDataUrl(settings.templateUrl);
      const imageType = template.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(template, imageType, 0, 0, 297, 210);
    } catch {
      drawFallbackBackground(doc);
    }
  } else {
    drawFallbackBackground(doc);
  }

  const color = hexToRgb(settings.textColor);
  doc.setTextColor(color.r, color.g, color.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(settings.nameFontSize);
  doc.text(recipient.name || 'Participant Name', settings.nameX, settings.nameY, { align: 'center', maxWidth: 240 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(settings.categoryFontSize);
  doc.text(recipient.category || 'Category', settings.categoryX, settings.categoryY, { align: 'center', maxWidth: 220 });

  doc.setFontSize(settings.dateFontSize);
  doc.text(formatDate(settings.certificateDate), settings.dateX, settings.dateY, { align: 'center', maxWidth: 180 });

  return doc;
}

export async function downloadCertificate(recipient: CertificateRecipient, settings?: CertificateSettings | null) {
  const doc = await createCertificatePdf(recipient, settings);
  doc.save(`mezzopedia-certificate-${recipient.usercode || recipient.name}.pdf`);
}

export async function downloadCertificateBatch(recipients: CertificateRecipient[], settings?: CertificateSettings | null) {
  if (!recipients.length) return;
  const normalized = normalizeCertificateSettings(settings);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  let template = '';
  if (normalized.templateUrl) {
    try { template = await imageToDataUrl(normalized.templateUrl); } catch { template = ''; }
  }
  recipients.forEach((recipient, index) => {
    if (index > 0) doc.addPage('a4', 'landscape');
    if (template) {
      const imageType = template.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(template, imageType, 0, 0, 297, 210);
    } else {
      drawFallbackBackground(doc);
    }
    const color = hexToRgb(normalized.textColor);
    doc.setTextColor(color.r, color.g, color.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(normalized.nameFontSize);
    doc.text(recipient.name || 'Participant Name', normalized.nameX, normalized.nameY, { align: 'center', maxWidth: 240 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(normalized.categoryFontSize);
    doc.text(recipient.category || 'Category', normalized.categoryX, normalized.categoryY, { align: 'center', maxWidth: 220 });
    doc.setFontSize(normalized.dateFontSize);
    doc.text(formatDate(normalized.certificateDate), normalized.dateX, normalized.dateY, { align: 'center', maxWidth: 180 });
  });
  doc.save('mezzopedia-certificates.pdf');
}

function drawFallbackBackground(doc: jsPDF) {
  doc.setFillColor(246, 248, 251);
  doc.rect(0, 0, 297, 210, 'F');
  doc.setDrawColor(23, 78, 166);
  doc.setLineWidth(2);
  doc.rect(12, 12, 273, 186);
  doc.setTextColor(0, 31, 77);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text('Certificate of Participation', 148, 50, { align: 'center' });
}
