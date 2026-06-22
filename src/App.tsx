import React from 'react';
import { AppShell } from './components/AppShell';
import { useAppStore } from './lib/store';

const App = () => {
  const subscribeToFirestore = useAppStore(s => s.subscribeToFirestore);
  React.useEffect(() => subscribeToFirestore(), []);
  return <AppShell />;
};

export default App;
