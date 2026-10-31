import { FormEvent, useState } from "react"
import { ApiError } from "./lib/api"

const campusImage =
  "https://images.unsplash.com/photo-1623631484725-fef26b75b402?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxoaXN0b3JpYyUyMHVuaXZlcnNpdHklMjBjYW1wdXMlMjBhcmNoaXRlY3R1cmUlMjBzdHVkZW50cyUyMHdhcm0lMjBzdW5saWdodHxlbnwxfHx8fDE3OTMzMzczNDN8MA&ixlib=rb-4.1.0&q=80&w=1080"

function describeLoginError(error: unknown) {
  if (!(error instanceof ApiError)) {
    return error instanceof Error
      ? error.message
      : "No fue posible iniciar sesión. Inténtalo nuevamente."
  }

  if (error.status === 0) {
    return `Conexión o CORS: ${error.message}`
  }
  if (error.status === 400) {
    return `Solicitud inválida: ${error.message}`
  }
  if (error.status === 401) {
    return `Autenticación o token: ${error.message}`
  }
  if (error.status === 403) {
    return `Cuenta o permisos: ${error.message}`
  }
  if (error.status === 429) {
    return `Demasiados intentos: ${error.message}`
  }
  if (error.status >= 500) {
    return `Servidor: ${error.message}`
  }

  return error.message
}

function AcademicMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`grid shrink-0 place-items-center rounded-xl bg-accent text-ink shadow-sm ${
          compact ? "size-10" : "size-12"
        }`}
      >
        <svg
          aria-hidden="true"
          className={compact ? "size-5" : "size-6"}
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            d="m3 9 9-5 9 5-9 5-9-5Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M7 11.4v4.1c2.7 2 7.3 2 10 0v-4.1M21 9v6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      </div>
      <div>
        <p className={`${compact ? "text-sm" : "text-base"} font-bold tracking-tight`}>
          Portal Académico
        </p>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] opacity-60">
          Campus digital
        </p>
      </div>
    </div>
  )
}

function UserIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <rect
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        width="16"
        x="4"
        y="11"
      />
      <path
        d="M8 11V7a4 4 0 0 1 8 0v4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function EyeIcon({ closed }: { closed: boolean }) {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <path
        d={
          closed
            ? "m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5.5 0 9 5 9 5a16 16 0 0 1-3 3.6M6.6 6.6C4.4 8 3 10 3 10s3.5 5 9 5c.7 0 1.4-.1 2-.2"
            : "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export function LoginPage({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const username = String(form.get("username") ?? "").trim()
    const password = String(form.get("password") ?? "")
    setError("")
    setLoading(true)

    try {
      await onLogin(username, password)
    } catch (loginError) {
      setError(describeLoginError(loginError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-ink lg:grid lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-brand lg:flex lg:flex-col lg:justify-between">
        <img
          alt="Edificio principal de un campus universitario"
          className="absolute inset-0 size-full object-cover"
          src={campusImage}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,32,48,0.5)_0%,rgba(8,32,48,0.8)_62%,rgba(8,32,48,0.96)_100%)]" />
        <div className="relative z-10 p-12 text-white xl:p-16">
          <AcademicMark />
        </div>

        <div className="relative z-10 max-w-2xl p-12 text-white xl:p-16">
          <div className="mb-7 h-1 w-12 rounded-full bg-accent" />
          <p className="mb-5 font-display text-5xl leading-[1.08] font-medium tracking-tight xl:text-6xl">
            Tu comunidad académica, en un solo lugar.
          </p>
          <p className="max-w-xl text-base leading-7 text-white/72 xl:text-lg">
            Consulta cursos, calificaciones, asignaciones y mantente al día con todo lo
            que ocurre en tu institución.
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-white/65">
            <span className="inline-block size-2 rounded-full bg-accent" />
            Plataforma segura para estudiantes, docentes y administradores
          </div>
        </div>
      </section>

      <section className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-6 sm:px-10 lg:justify-end lg:px-12">
          <div className="text-brand lg:hidden">
            <AcademicMark compact />
          </div>
          <a
            className="text-sm font-semibold text-muted transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            href="mailto:soporte@campus.edu"
          >
            ¿Necesitas ayuda?
          </a>
        </header>

        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-9">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-brand-soft">
                Acceso al campus
              </p>
              <h1 className="font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
                Bienvenido de nuevo
              </h1>
              <p className="mt-4 text-base leading-7 text-muted">
                Ingresa tus datos institucionales para continuar.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <label className="mb-2 block text-sm font-bold text-ink" htmlFor="username">
                  Usuario
                </label>
                <div className="group relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-muted transition-colors group-focus-within:text-brand-soft">
                    <UserIcon />
                  </span>
                  <input
                    autoComplete="username"
                    className="h-14 w-full rounded-xl border border-line bg-white pr-4 pl-12 text-[0.95rem] text-ink outline-none transition placeholder:text-muted/65 hover:border-brand/35 focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10"
                    id="username"
                    name="username"
                    placeholder="Ingresa tu usuario"
                    required
                    type="text"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-4">
                  <label className="block text-sm font-bold text-ink" htmlFor="password">
                    Contraseña
                  </label>
                  <a
                    className="text-sm font-bold text-brand-soft transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                    href="#recuperar"
                  >
                    ¿La olvidaste?
                  </a>
                </div>
                <div className="group relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-muted transition-colors group-focus-within:text-brand-soft">
                    <LockIcon />
                  </span>
                  <input
                    autoComplete="current-password"
                    className="h-14 w-full rounded-xl border border-line bg-white pr-12 pl-12 text-[0.95rem] text-ink outline-none transition placeholder:text-muted/65 hover:border-brand/35 focus:border-brand-soft focus:ring-4 focus:ring-brand-soft/10"
                    id="password"
                    name="password"
                    placeholder="Ingresa tu contraseña"
                    required
                    type={showPassword ? "text" : "password"}
                  />
                  <button
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="absolute inset-y-0 right-0 flex items-center px-4 text-muted transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand"
                    onClick={() => setShowPassword((visible) => !visible)}
                    type="button"
                  >
                    <EyeIcon closed={showPassword} />
                  </button>
                </div>
              </div>

              <label className="flex w-fit cursor-pointer items-center gap-3 text-sm text-muted">
                <input
                  className="size-4 rounded border-line text-brand accent-brand"
                  name="remember"
                  type="checkbox"
                />
                Mantener mi sesión iniciada
              </label>

              <button
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-[0_10px_30px_rgba(11,47,68,0.18)] transition hover:-translate-y-0.5 hover:bg-brand-dark hover:shadow-[0_14px_34px_rgba(11,47,68,0.24)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand active:translate-y-0 disabled:cursor-wait disabled:opacity-70"
                disabled={loading}
                type="submit"
              >
                {loading ? "Verificando acceso..." : "Iniciar sesión"}
                <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M5 12h14m-5-5 5 5-5 5"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </button>

              {error && (
                <p
                  aria-live="polite"
                  className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
                >
                  {error}
                </p>
              )}

            </form>


            <div className="mt-9 flex items-start gap-3 border-t border-line pt-6 text-sm leading-6 text-muted">
              <svg
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-brand-soft"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
                <path
                  d="m9 12 2 2 4-4"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
              <p>
                Tus datos están protegidos. Nunca compartiremos tu información de acceso.
              </p>
            </div>
          </div>
        </div>

        <footer className="px-6 py-6 text-center text-xs text-muted sm:px-10 lg:px-12">
          © 2025 Portal Académico · Privacidad · Términos
        </footer>
      </section>
    </main>
  )
}
