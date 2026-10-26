import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function pdfFixture(count = 3): Promise<Buffer> {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([420, 595]); page.drawText(`Source page ${i + 1}`, { x: 40, y: 530, size: 24, font });
    page.drawRectangle({ x: 40, y: 250, width: 200, height: 150, color: rgb(.15, .7, .3) });
  }
  return Buffer.from(await doc.save());
}
