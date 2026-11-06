const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/

export function describeFolderCreation(result) {
  if (
    !result ||
    typeof result !== "object" ||
    !FOLDER_ID_PATTERN.test(result.id || "") ||
    typeof result.persisted !== "boolean"
  ) {
    throw new Error("El servidor no devolvió el estado esperado de la carpeta.")
  }

  return {
    id: result.id,
    persisted: result.persisted,
    message: result.persisted
      ? "La carpeta se creó y el backend guardó su identificador. Comprobando que esté accesible para las cargas…"
      : "La carpeta se creó en Google Drive, pero todavía no está configurada para las cargas. Añade el identificador a GOOGLE_DRIVE_FOLDER_ID en Render y actualiza el estado.",
  }
}

export function callbackMessage(outcome) {
  switch (outcome) {
    case "authorized":
      return "Google regresó al portal. Comprobando la autorización con el backend…"
    case "cancelled":
      return "La autorización fue cancelada. No se concedió acceso a Google Drive."
    case "expired":
      return "La solicitud de autorización expiró. Inicia el proceso de nuevo."
    case "error":
      return "Google no pudo completar la autorización. Inicia el proceso de nuevo."
    default:
      return "El resultado de autorización no es válido. Consulta el estado o inicia de nuevo."
  }
}
