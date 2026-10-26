import { PDFDocument, degrees, rgb } from 'pdf-lib';

export async function orientationFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const [width, height, angle] of [[240, 360, 0], [360, 240, 0], [240, 360, 90]]) {
    const page = doc.addPage([width, height]);
    page.drawRectangle({ x: 20, y: 20, width: 50, height: 30, color: rgb(1, 0, 0) });
    page.drawRectangle({ x: width - 100, y: height - 90, width: 80, height: 50, color: rgb(0, .7, 0) });
    page.setRotation(degrees(angle));
  }
  return Buffer.from(await doc.save());
}
