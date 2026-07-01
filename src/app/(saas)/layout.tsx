import { AppShell } from '@/components/AppShell'
import { AuthGate } from '@/components/AuthGate'
import { WorkspaceIdentityProvider } from '@/components/WorkspaceIdentityProvider'

export default function SaasLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <WorkspaceIdentityProvider>
        <AppShell>{children}</AppShell>
      </WorkspaceIdentityProvider>
    </AuthGate>
  )
}
