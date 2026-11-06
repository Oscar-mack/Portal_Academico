export interface FolderCreationFeedback {
  id: string
  persisted: boolean
  message: string
}

export function describeFolderCreation(result: unknown): FolderCreationFeedback
export function callbackMessage(outcome: string | null): string
