import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react"
import {
  ApiError,
  AuthUser,
  clearToken,
  getProfile,
  getToken,
  signIn,
} from "../lib/api"

interface AuthContextValue {
  user: AuthUser | null
  restoring: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoring, setRestoring] = useState(true)

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  useEffect(() => {
    let active = true

    if (!getToken()) {
      setRestoring(false)
      return
    }

    getProfile()
      .then((profile) => {
        if (active) setUser(profile)
      })
      .catch(() => {
        if (active) logout()
      })
      .finally(() => {
        if (active) setRestoring(false)
      })

    return () => {
      active = false
    }
  }, [logout])

  async function login(username: string, password: string) {
    try {
      await signIn(username, password)
      try {
        setUser(await getProfile())
      } catch (profileError) {
        if (profileError instanceof ApiError && profileError.status === 401) {
          throw new ApiError(
            "El backend emitió el JWT, pero el endpoint de perfil lo rechazó o lo consideró expirado.",
            401,
          )
        }
        throw profileError
      }
    } catch (error) {
      clearToken()
      if (error instanceof ApiError) throw error
      throw new Error("No fue posible completar el inicio de sesión.")
    }
  }

  return (
    <AuthContext.Provider value={{ user, restoring, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth debe utilizarse dentro de AuthProvider.")
  return context
}
