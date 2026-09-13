import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/shells/AppShell'
import { ReaderScreen } from '@/screens/ReaderScreen'
import { StudyScreen } from '@/screens/StudyScreen'
import { CenterScreen } from '@/screens/CenterScreen'
import { HomeScreen } from '@/screens/HomeScreen'
import { KnowledgeScreen } from '@/screens/KnowledgeScreen'
import { LibraryScreen } from '@/screens/LibraryScreen'
import { MaterialDetailScreen } from '@/screens/MaterialDetailScreen'
import { QueueScreen } from '@/screens/QueueScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'

function AppPage({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}

/**
 * The route tree is deliberately shallow: Study and Reader are full-screen
 * workspaces, while the five product entries and settings share AppShell.
 */
export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<AppPage><HomeScreen /></AppPage>} />
      <Route path="/library" element={<AppPage><LibraryScreen /></AppPage>} />
      <Route path="/material/:materialId" element={<AppPage><MaterialDetailScreen /></AppPage>} />
      <Route path="/knowledge" element={<AppPage><KnowledgeScreen /></AppPage>} />
      <Route path="/queue" element={<AppPage><QueueScreen /></AppPage>} />
      <Route path="/center" element={<AppPage><CenterScreen /></AppPage>} />
      <Route path="/settings" element={<AppPage><SettingsScreen /></AppPage>} />
      <Route path="/reader/:materialId" element={<ReaderScreen />} />
      <Route path="/study/:sessionId" element={<StudyScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
