import { FormEvent, useRef, useState } from "react"
import { ACCEPTED_FILES, formatBytes, validateFile } from "../lib/fileValidation"

interface Props {
  onSubmit: (data: FormData) => Promise<void>
}

// Selección, validación y envío en la misma página; el botón se bloquea mientras se envía.
export default function SubmissionForm({ onSubmit }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingRef.current) return
    const problem = validateFile(file)
    if (problem || !file) {
      setError(problem ?? "Selecciona un archivo.")
      return
    }
    sendingRef.current = true
    setSending(true)
    setError("")
    try {
      const data = new FormData()
      data.append("file", file)
      await onSubmit(data)
      setFile(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible enviar la entrega.")
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <form className="mt-4 grid gap-3" onSubmit={handleSubmit} aria-busy={sending}>
      <label className="text-sm font-semibold">
        Entregar archivo (PDF, DOCX, XLSX, PPTX, TXT, JPG o PNG · máximo 20 MiB)
        <input
          accept={ACCEPTED_FILES}
          className="mt-2 block max-w-full text-sm"
          disabled={sending}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null
            setFile(selected)
            setError(selected ? validateFile(selected) ?? "" : "")
          }}
          type="file"
        />
      </label>
      {file && <p className="text-sm text-muted">Seleccionado: <strong>{file.name}</strong> ({formatBytes(file.size)})</p>}
      {error && <p className="text-sm font-semibold text-red-700" role="alert">{error}</p>}
      <button
        className="h-10 w-fit rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-50"
        disabled={sending || !file}
        type="submit"
      >
        {sending ? "Enviando entrega…" : "Enviar entrega"}
      </button>
    </form>
  )
}
