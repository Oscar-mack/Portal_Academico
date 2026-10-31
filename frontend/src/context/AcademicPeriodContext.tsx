import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { academicPeriodsService } from "../services/academicPeriodsService"
import type { CicloAcademico, PeriodoAcademico } from "../types/api"

interface AcademicPeriodContextValue {
  cycles: CicloAcademico[]
  periods: PeriodoAcademico[]
  selectedPeriodId: number | null
  selectedPeriod: PeriodoAcademico | null
  loading: boolean
  error: string
  selectPeriod: (id: number | null) => void
  refresh: () => Promise<void>
}

const AcademicPeriodContext = createContext<AcademicPeriodContextValue | null>(null)

function latestOpenPeriod(periods: PeriodoAcademico[]) {
  return [...periods]
    .filter((period) => period.estado === "abierto")
    .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio))[0]
}

export function AcademicPeriodProvider({
  userId,
  children,
}: {
  userId: string | number
  children: ReactNode
}) {
  const storageKey = `portal_period_${userId}`
  const [cycles, setCycles] = useState<CicloAcademico[]>([])
  const [periods, setPeriods] = useState<PeriodoAcademico[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")

    try {
      // Los períodos son indispensables para todos los roles; los ciclos solo
      // complementan las pantallas administrativas y no deben bloquearlos.
      const [cyclesResult, periodsResult] = await Promise.allSettled([
        academicPeriodsService.listCycles(),
        academicPeriodsService.listPeriods(),
      ])
      if (periodsResult.status === "rejected") throw periodsResult.reason
      const nextCycles = cyclesResult.status === "fulfilled" ? cyclesResult.value : []
      const nextPeriods = periodsResult.value
      setCycles(nextCycles)
      setPeriods(nextPeriods)
      if (cyclesResult.status === "rejected") {
        setError(
          cyclesResult.reason instanceof Error
            ? cyclesResult.reason.message
            : "No fue posible consultar los ciclos académicos.",
        )
      }

      const storedValue = sessionStorage.getItem(storageKey)
      const storedId = storedValue ? Number(storedValue) : null
      const storedPeriod = nextPeriods.find((period) => period.id === storedId)
      const fallback = latestOpenPeriod(nextPeriods)
      const nextId = storedPeriod?.id ?? fallback?.id ?? null
      setSelectedPeriodId(nextId)

      if (nextId) sessionStorage.setItem(storageKey, String(nextId))
      else sessionStorage.removeItem(storageKey)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible consultar los períodos académicos.",
      )
    } finally {
      setLoading(false)
    }
  }, [storageKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  const selectPeriod = useCallback(
    (id: number | null) => {
      setSelectedPeriodId(id)
      if (id) sessionStorage.setItem(storageKey, String(id))
      else sessionStorage.removeItem(storageKey)
    },
    [storageKey],
  )

  const selectedPeriod =
    periods.find((period) => period.id === selectedPeriodId) ?? null

  const value = useMemo(
    () => ({
      cycles,
      periods,
      selectedPeriodId,
      selectedPeriod,
      loading,
      error,
      selectPeriod,
      refresh,
    }),
    [
      cycles,
      periods,
      selectedPeriodId,
      selectedPeriod,
      loading,
      error,
      selectPeriod,
      refresh,
    ],
  )

  return (
    <AcademicPeriodContext.Provider value={value}>
      {children}
    </AcademicPeriodContext.Provider>
  )
}

export function useAcademicPeriod() {
  const context = useContext(AcademicPeriodContext)
  if (!context) {
    throw new Error("useAcademicPeriod debe utilizarse dentro de AcademicPeriodProvider.")
  }
  return context
}
