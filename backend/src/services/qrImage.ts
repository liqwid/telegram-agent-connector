import QRCode from "qrcode";

/** Render a `tg://login?token=...` URL as a PNG for display in chat. */
export function renderQrPng(qrUrl: string): Promise<Buffer> {
  return QRCode.toBuffer(qrUrl, {
    type: "png",
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}
