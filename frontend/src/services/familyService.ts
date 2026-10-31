import { apiRequest } from "../lib/api"
import type { LinkedStudent } from "../types/api"

export const familyService = {
  getMyStudents: () =>
    apiRequest<LinkedStudent[]>("/api/padres-alumnos/mis-alumnos"),
}
