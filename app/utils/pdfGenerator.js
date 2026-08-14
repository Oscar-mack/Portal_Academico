const PDFDocument = require("pdfkit");

// Genera una boleta de calificaciones en PDF y la transmite directamente
// como respuesta HTTP (RF-10 — Reportes PDF).
function generarBoletaPDF(res, { alumno, gradoCarrera, notas, periodo }) {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=boleta_${alumno.id}_${periodo || "general"}.pdf`
  );
  doc.pipe(res);

  doc.fontSize(18).text("Portal Académico - Boleta de Calificaciones", { align: "center" });
  doc.moveDown();
  doc.fontSize(11).text(`Alumno: ${alumno.nombre} ${alumno.apellido}`);
  doc.text(`Email: ${alumno.email}`);
  doc.text(`Grado/Carrera: ${gradoCarrera ? gradoCarrera.nombre : "N/A"}`);
  doc.text(`Periodo: ${periodo || "Todos"}`);
  doc.moveDown();

  doc.fontSize(13).text("Calificaciones", { underline: true });
  doc.moveDown(0.5);

  const startX = 50;
  let y = doc.y;
  doc.fontSize(10);
  doc.text("Curso", startX, y);
  doc.text("Nota", startX + 260, y);
  doc.text("Estado", startX + 340, y);
  doc.text("Periodo", startX + 430, y);
  y += 18;
  doc.moveTo(startX, y).lineTo(545, y).stroke();
  y += 8;

  let aprobados = 0;
  let reprobados = 0;

  notas.forEach((n) => {
    doc.text(n.curso ? n.curso.nombre : `Curso #${n.cursoId}`, startX, y, { width: 250 });
    doc.text(String(n.valor), startX + 260, y);
    doc.text(n.estado, startX + 340, y);
    doc.text(n.periodo, startX + 430, y);
    y += 18;
    if (n.estado === "aprobado") aprobados++; else reprobados++;
  });

  doc.moveDown(2);
  doc.fontSize(11).text(`Cursos aprobados: ${aprobados}`);
  doc.text(`Cursos reprobados: ${reprobados}`);

  doc.moveDown(2);
  doc.fontSize(9).fillColor("gray").text(
    `Generado el ${new Date().toLocaleString("es-GT")}`,
    { align: "right" }
  );

  doc.end();
}

module.exports = { generarBoletaPDF };


