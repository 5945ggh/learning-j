import { HashRouter } from 'react-router-dom'
import { AppRouter } from '@/app/AppRouter'
import { RepositoryProvider } from '@/app/repository-context'
import { ThemeProvider } from '@/app/theme'

/** Product entrypoint: theme state is global; route and shell ownership live below. */
function App() {
  return (
    <ThemeProvider>
      <RepositoryProvider>
        <HashRouter>
          <AppRouter />
        </HashRouter>
      </RepositoryProvider>
    </ThemeProvider>
  )
}

export default App
