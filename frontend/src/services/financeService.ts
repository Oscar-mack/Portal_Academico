import { apiRequest, downloadApiFile, withQuery } from "../lib/api"
import type {
  ApiMessage,
  Cargo,
  CheckoutResponse,
  CurrencyCode,
  Pago,
  RequisitoSolvencia,
  Solvencia,
} from "../types/api"

export interface CargoInput {
  alumnoId: number
  concepto: string
  descripcion?: string
  montoOriginal: number
  moneda: CurrencyCode
  fechaEmision?: string
  fechaVencimiento?: string | null
  cicloAcademicoId?: number | null
  periodoAcademicoId?: number | null
}

export const PENDING_CHECKOUT_KEY = "portal_pending_checkout"

export const financeService = {
  listCharges: (
    filters: {
      alumnoId?: number
      cicloAcademicoId?: number
      periodoAcademicoId?: number
      estado?: string
      incluirAnulados?: boolean
      incluirSinPeriodo?: boolean
    } = {},
  ) => apiRequest<Cargo[]>(withQuery("/api/cargos", filters)),
  createCharge: (input: CargoInput) =>
    apiRequest<Cargo>("/api/cargos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCharge: (
    id: number,
    input: Partial<Pick<CargoInput, "concepto" | "descripcion" | "montoOriginal" | "fechaVencimiento">>,
  ) =>
    apiRequest<Cargo>(`/api/cargos/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  cancelCharge: (id: number, motivo: string) =>
    apiRequest<ApiMessage & { id: number; anuladoEn: string }>(
      `/api/cargos/${id}/anular`,
      { method: "PATCH", body: JSON.stringify({ motivo }) },
    ),
  getSolvency: (alumnoId?: number) =>
    apiRequest<Solvencia>(withQuery("/api/cargos/solvencia", { alumnoId })),
  listPayments: (filters: { alumnoId?: number; estado?: string; cargoId?: number } = {}) =>
    apiRequest<Pago[]>(withQuery("/api/pagos", filters)),
  createCheckout: (input: { cargoId: number; monto?: number }) =>
    apiRequest<CheckoutResponse>("/api/pagos/checkout", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  cancelPayment: (id: number, input: { motivo: string; reembolsar?: boolean }) =>
    apiRequest<ApiMessage & { id: number; estado: string; reembolsado: boolean }>(
      `/api/pagos/${id}/anular`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  listRequirements: () =>
    apiRequest<RequisitoSolvencia[]>("/api/requisitos-solvencia"),
  downloadAccountStatement: (
    alumnoId: number,
    filters: { cicloAcademicoId?: number; periodoAcademicoId?: number } = {},
  ) =>
    downloadApiFile(
      withQuery(`/api/reportes/estado-cuenta-pdf/${alumnoId}`, filters),
    ),
}
