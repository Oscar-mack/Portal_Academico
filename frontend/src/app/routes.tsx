import { lazy, Suspense } from "react"
import { Navigate, Outlet, createBrowserRouter, useNavigate } from "react-router"
import { LoginPage } from "../App"
import { AcademicPeriodProvider } from "../context/AcademicPeriodContext"
import { AuthProvider, useAuth } from "../context/AuthContext"

const DashboardPage = lazy(() => import("../pages/DashboardPage"))
const PaymentReturnPage = lazy(() => import("../pages/PaymentReturnPage"))

function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}

function LoadingSession() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas text-ink">
      <div className="text-center">
        <div className="mx-auto size-10 animate-spin rounded-full border-4 border-line border-t-brand-soft" />
        <p className="mt-4 text-sm font-semibold text-muted">Restaurando sesión...</p>
      </div>
    </main>
  )
}

function LoginRoute() {
  const { user, restoring, login } = useAuth()
  const navigate = useNavigate()

  if (restoring) return <LoadingSession />
  if (user) return <Navigate replace to="/portal" />

  return (
    <LoginPage
      onLogin={async (username, password) => {
        await login(username, password)
        navigate("/portal", { replace: true })
      }}
    />
  )
}

function PortalRoute() {
  const { user, restoring, logout } = useAuth()
  const navigate = useNavigate()

  if (restoring) return <LoadingSession />
  if (!user) return <Navigate replace to="/login" />

  return (
    <AcademicPeriodProvider userId={user.id ?? user.correo ?? user.rol}>
      <Suspense fallback={<LoadingSession />}>
        <DashboardPage
          onLogout={() => {
            logout()
            navigate("/login", { replace: true })
          }}
          user={user}
        />
      </Suspense>
    </AcademicPeriodProvider>
  )
}

function PaymentReturnRoute({
  outcome,
}: {
  outcome: "success" | "cancelled"
}) {
  const { user, restoring } = useAuth()
  if (restoring) return <LoadingSession />
  if (!user) return <Navigate replace to="/login" />
  return (
    <Suspense fallback={<LoadingSession />}>
      <PaymentReturnPage outcome={outcome} />
    </Suspense>
  )
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, element: <Navigate replace to="/portal" /> },
      { path: "login", Component: LoginRoute },
      { path: "portal/*", Component: PortalRoute },
      {
        path: "pago-exitoso",
        element: <PaymentReturnRoute outcome="success" />,
      },
      {
        path: "pago-cancelado",
        element: <PaymentReturnRoute outcome="cancelled" />,
      },
      { path: "*", element: <Navigate replace to="/portal" /> },
    ],
  },
])
