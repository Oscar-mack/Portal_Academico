import { apiRequest, withQuery } from "../lib/api"
import type { DashboardResponse } from "../types/api"

export const dashboardService = {
  get: (periodoAcademicoId?: number | null) =>
    apiRequest<DashboardResponse>(
      withQuery("/api/dashboard", { periodoAcademicoId }),
    ),
}
