import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { AuthGate } from '@/components/AuthGate'
import { WorkspaceIdentityProvider } from '@/components/WorkspaceIdentityProvider'

export default function SaasLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <WorkspaceIdentityProvider>
        <div className="flex h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#f4f6fb_44%,#f7f8fb_100%)]">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <Topbar />
            <main className="relative flex-1 overflow-y-auto p-5 pb-8 xl:p-6 xl:pb-10">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.12),transparent_42%),radial-gradient(ellipse_at_top_right,rgba(14,165,233,0.08),transparent_38%)]" />
              <div className="relative pb-2">
                {children}
              </div>
            </main>
          </div>
        </div>
      </WorkspaceIdentityProvider>
    </AuthGate>
  )
}
