import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'

export default function SaasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f7fb]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-5 xl:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
