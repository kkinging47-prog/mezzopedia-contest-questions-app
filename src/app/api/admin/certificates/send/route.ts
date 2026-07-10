import { NextRequest } from 'next/server';
import { jsPDF } from 'jspdf';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';
import { DEFAULT_CERTIFICATE_SETTINGS, normalizeCertificateSettings, CertificateSettings } from '@/lib/certificatePdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type CertificateParticipant = {
  name?: string;
  usercode?: string;
  email?: string;
  category?: string;
};

type CertificateSessionRow = {
  id: string;
  category?: string;
  status?: string;
  participant?: CertificateParticipant | CertificateParticipant[] | null;
};

function getParticipant(value: CertificateSessionRow['participant']): CertificateParticipant {
  if (Array.isArray(value)) return value[0] || {};
  return value || {};
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '').trim();
  if (!/^([0-9a-f]{6})$/i.test(cleaned)) return { r: 0, g: 31, b: 77 };
  return { r: parseInt(cleaned.slice(0, 2), 16), g: parseInt(cleaned.slice(2, 4), 16), b: parseInt(cleaned.slice(4, 6), 16) };
}

function dateParts(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    const parts = String(dateValue || '').split(/[\/\-.]/).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 3) return { day: parts[0].padStart(2, '0').slice(-2), month: parts[1].padStart(2, '0').slice(-2), year: parts[2].slice(-2) };
    return null;
  }
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: String(date.getFullYear()).slice(-2)
  };
}

function drawDateInTemplateSpaces(doc: jsPDF, dateValue: string, centerX: number, y: number) {
  const parts = dateParts(dateValue);
  if (!parts) return;
  const spacing = 14;
  doc.text(parts.day, centerX - spacing, y, { align: 'center', maxWidth: 12 });
  doc.text(parts.month, centerX, y, { align: 'center', maxWidth: 12 });
  doc.text(parts.year, centerX + spacing, y, { align: 'center', maxWidth: 12 });
}

async function imageToDataUrl(url: string) {
  if (!url) return '';
  const res = await fetch(url);
  if (!res.ok) return '';
  const contentType = res.headers.get('content-type') || 'image/png';
  const arrayBuffer = await res.arrayBuffer();
  return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
}

async function certificatePdfBase64(name: string, category: string, settings: Required<CertificateSettings>) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const template = settings.templateUrl ? await imageToDataUrl(settings.templateUrl) : '';
  if (template) {
    const imageType = template.includes('image/png') ? 'PNG' : 'JPEG';
    doc.addImage(template, imageType, 0, 0, 297, 210);
  } else {
    doc.setFillColor(246, 248, 251); doc.rect(0, 0, 297, 210, 'F');
    doc.setDrawColor(23, 78, 166); doc.setLineWidth(2); doc.rect(12, 12, 273, 186);
    doc.setFontSize(24); doc.text('Certificate of Participation', 148, 50, { align: 'center' });
  }

  const color = hexToRgb(settings.textColor);
  doc.setTextColor(color.r, color.g, color.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(settings.nameFontSize);
  doc.text(name, settings.nameX, settings.nameY, { align: 'center', maxWidth: 240 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(settings.categoryFontSize);
  doc.text(category, settings.categoryX, settings.categoryY, { align: 'center', maxWidth: 220 });
  doc.setFontSize(settings.dateFontSize);
  drawDateInTemplateSpaces(doc, settings.certificateDate, settings.dateX, settings.dateY);

  return Buffer.from(doc.output('arraybuffer')).toString('base64');
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.CERTIFICATE_FROM_EMAIL || process.env.FROM_EMAIL;
  if (!apiKey || !fromEmail) return jsonError('Email sending is not configured. Add RESEND_API_KEY and CERTIFICATE_FROM_EMAIL in Vercel environment variables, then redeploy.', 400);

  const body = await request.json().catch(() => ({}));
  const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.map(String).filter(Boolean) : [];
  if (!sessionIds.length) return jsonError('Select at least one completed candidate.', 400);

  const { data: settingRow } = await supabaseAdmin.from('app_config').select('value').eq('key', 'certificateSettings').maybeSingle();
  const settings = normalizeCertificateSettings((settingRow?.value || DEFAULT_CERTIFICATE_SETTINGS) as CertificateSettings);
  if (body.certificateDate) settings.certificateDate = String(body.certificateDate);

  const { data, error } = await supabaseAdmin
    .from('contest_sessions')
    .select('id,category,status, participant:participants(name,usercode,email,category)')
    .eq('status', 'completed')
    .in('id', sessionIds);

  if (error) return jsonError(`${error.message}. If the email column is missing, run supabase/run-this-certificate-email-fix.sql first.`, 500);

  let sent = 0;
  const failed: string[] = [];
  for (const rawRow of data || []) {
    const row = rawRow as CertificateSessionRow;
    const participant = getParticipant(row.participant);
    const name = participant.name || '';
    const category = row.category || participant.category || '';
    const email = participant.email || '';
    const usercode = participant.usercode || '';
    if (!email) { failed.push(`${name || usercode}: no email`); continue; }

    const pdf = await certificatePdfBase64(name, category, settings);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: 'Your Mezzopedia Certificate of Participation',
        html: `<p>Dear ${name},</p><p>Congratulations on your participation in the Mezzopedia National Mathematics Contest. Your certificate is attached.</p><p>Mezzo Maths, Easy Maths.</p>`,
        attachments: [{ filename: `mezzopedia-certificate-${usercode || name}.pdf`, content: pdf }]
      })
    });
    if (res.ok) sent += 1;
    else failed.push(`${name || usercode}: email failed`);
  }

  return Response.json({ success: true, sent, failed });
}
