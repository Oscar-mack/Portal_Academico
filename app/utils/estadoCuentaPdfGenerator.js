const PDFDocument = require("pdfkit");

function moneda(valor, codigo) {
  return `${codigo} ${Number(valor).toFixed(2)}`;
}

function generarEstadoCuentaPDF(res, { alumno, cargos, pagosHistoricos = [] }) {
  const doc = new PDFDocument({ margin: 45, size: "LETTER" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=estado_cuenta_${alumno.id}.pdf`
  );
  doc.pipe(res);

  doc.fontSize(18).text("Portal Académico - Estado de cuenta", { align: "center" });
  doc.moveDown();
  doc.fontSize(11)
    .text(`Alumno: ${alumno.nombre} ${alumno.apellido}`)
    .text(`Correo: ${alumno.email}`)
    .text(`Generado: ${new Date().toLocaleString("es-GT")}`);
  doc.moveDown();

  const totales = new Map();
  for (const cargo of cargos) {
    const saldo = Number(cargo.saldoPendiente);
    totales.set(cargo.moneda, (totales.get(cargo.moneda) || 0) + saldo);
  }
  doc.fontSize(12).text("Saldo pendiente por moneda", { underline: true });
  for (const [codigo, saldo] of totales) {
    doc.fontSize(10).text(`${codigo}: ${moneda(saldo, codigo)}`);
  }
  if (totales.size === 0) doc.fontSize(10).text("No hay cargos registrados.");
  doc.moveDown();

  if (pagosHistoricos.length > 0) {
    doc.fontSize(12).text("Pagos históricos sin cargo asociado", { underline: true });
    doc.fontSize(9).text(
      "Estos pagos se conservan como historial y no se aplican automáticamente a cargos. Se requiere conciliación antes de determinar la solvencia."
    );
    for (const pago of pagosHistoricos) {
      doc.fontSize(9).text(
        `Pago ${pago.estado}: ${moneda(pago.monto, String(pago.moneda || "GTQ").toUpperCase())} | ${pago.concepto}`
      );
    }
    doc.moveDown();
  }

  for (const cargo of cargos) {
    if (doc.y > 690) doc.addPage();
    doc.fontSize(11).text(`${cargo.concepto} — ${cargo.estado}`, { continued: false });
    doc.fontSize(9)
      .text(`Emisión: ${cargo.fechaEmision} | Vencimiento: ${cargo.fechaVencimiento || "Sin fecha"}`)
      .text(`Monto: ${moneda(cargo.montoOriginal, cargo.moneda)} | Pagado: ${moneda(cargo.montoPagado, cargo.moneda)} | Saldo: ${moneda(cargo.saldoPendiente, cargo.moneda)}`);
    if (cargo.anuladoEn) {
      doc.text(`Anulado: ${new Date(cargo.anuladoEn).toLocaleDateString("es-GT")} | Motivo: ${cargo.motivoAnulacion || "No indicado"}`);
    }
    for (const pago of cargo.pagos) {
      doc.text(`Pago ${pago.estado}: ${moneda(pago.monto, cargo.moneda)} | ${pago.fechaPago ? new Date(pago.fechaPago).toLocaleString("es-GT") : "Sin confirmar"}`);
    }
    doc.moveDown(0.7);
  }
  doc.end();
}

module.exports = { generarEstadoCuentaPDF };
