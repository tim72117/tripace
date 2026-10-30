import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RecordAiPlanPage } from './RecordAiPlanPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecordAiPlanPage />
  </StrictMode>,
)
