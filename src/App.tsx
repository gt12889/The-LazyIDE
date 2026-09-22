/* App — root component. Wraps everything in AppProvider + EditorStoreProvider.
   EditorStoreProvider is at the root so CommandPalette can open files
   without requiring the user to be in CodeSpace first.
*/

import { AppProvider } from './app/AppContext';
import { I18nProvider } from './i18n';
import { EditorStoreProvider } from './components/editor/editorStore';
import { AppShell } from './components/AppShell';
import { AuthGate } from './components/auth/AuthGate';

function App() {
  // AuthGate is a pass-through (Forge has no accounts). It lives inside
  // I18nProvider so the tree shape is unchanged.
  return (
    <I18nProvider>
      <AppProvider>
        <AuthGate>
          <EditorStoreProvider>
            <AppShell />
          </EditorStoreProvider>
        </AuthGate>
      </AppProvider>
    </I18nProvider>
  );
}

export default App;
