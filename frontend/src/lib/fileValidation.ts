export const MAX_FILE_BYTES = 20 * 1024 * 1024

export const ALLOWED_FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
}

export const ACCEPTED_FILES = [
  ...Object.keys(ALLOWED_FILE_TYPES),
  ...new Set(Object.values(ALLOWED_FILE_TYPES)),
].join(",")

// Devuelve un mensaje de error o null si el archivo cumple tamaño, extensión y tipo MIME.
export function validateFile(file: File | null | undefined): string | null {
  if (!file || !file.size) return "Selecciona un archivo que no esté vacío."
  if (file.size > MAX_FILE_BYTES) return "El archivo excede el máximo permitido de 20 MiB."
  const dot = file.name.lastIndexOf(".")
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : ""
  const expected = ALLOWED_FILE_TYPES[extension]
  if (!expected) return "Formato no permitido. Usa PDF, DOCX, XLSX, PPTX, TXT, JPG o PNG."
  if (file.type && file.type !== expected) return "El tipo del archivo no coincide con su extensión."
  return null
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
