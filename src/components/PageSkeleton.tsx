// Route-level loading skeletons used by each segment's `loading.tsx`.
//
// Why this exists (S2 performance pass): every (saas) page is a Client
// Component that fetches its data in a `useEffect` after mount. Without a
// route-level `loading.tsx`, navigating to a not-yet-warm route showed a blank
// area until the chunk evaluated and the page's own skeleton appeared. These
// skeletons render *instantly* on navigation (Next.js Suspense fallback),
// giving immediate, premium feedback while the real page mounts. They are
// purely presentational — no data, no client hooks — so they are safe and add
// zero query cost. Variants roughly mirror each page's layout so the handoff to
// the page's own loading state is visually seamless (no jarring flash).

type Variant = 'dashboard' | 'list' | 'detail' | 'board' | 'calendar' | 'chat'

const bar = 'motion-safe:animate-pulse rounded-full bg-slate-200/80'
const block = 'motion-safe:animate-pulse rounded-2xl bg-slate-100'
const card = 'rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/40'

function Header() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2.5">
        <div className={`${bar} h-6 w-52`} />
        <div className={`${bar} h-3.5 w-72`} />
      </div>
      <div className={`${block} h-9 w-32`} />
    </div>
  )
}

function Tiles({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={card}>
          <div className={`${bar} h-3 w-20`} />
          <div className={`${bar} mt-3 h-7 w-24`} />
          <div className={`${bar} mt-3 h-2.5 w-28`} />
        </div>
      ))}
    </div>
  )
}

function Rows({ count = 6 }: { count?: number }) {
  return (
    <div className={card}>
      <div className={`${bar} h-4 w-40`} />
      <div className="mt-4 space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 motion-safe:animate-pulse rounded-full bg-slate-200/80" />
            <div className="flex-1 space-y-2">
              <div className={`${bar} h-3 w-1/3`} />
              <div className={`${bar} h-2.5 w-1/2`} />
            </div>
            <div className={`${bar} h-6 w-16`} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PageSkeleton({ variant = 'list' }: { variant?: Variant }) {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando contenido…</span>
      <Header />

      {variant === 'dashboard' && (
        <>
          <Tiles count={4} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2"><Rows count={6} /></div>
            <Rows count={4} />
          </div>
        </>
      )}

      {variant === 'list' && (
        <>
          <div className="flex gap-3">
            <div className={`${block} h-10 flex-1`} />
            <div className={`${block} h-10 w-40`} />
          </div>
          <Rows count={8} />
        </>
      )}

      {variant === 'detail' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <div className={card}>
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 shrink-0 motion-safe:animate-pulse rounded-2xl bg-slate-200/80" />
                <div className="flex-1 space-y-2.5">
                  <div className={`${bar} h-4 w-44`} />
                  <div className={`${bar} h-3 w-60`} />
                </div>
              </div>
            </div>
            <Rows count={5} />
          </div>
          <Rows count={6} />
        </div>
      )}

      {variant === 'board' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, col) => (
            <div key={col} className="space-y-3">
              <div className={`${bar} h-4 w-28`} />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={card}>
                  <div className={`${bar} h-3 w-3/4`} />
                  <div className={`${bar} mt-2.5 h-2.5 w-1/2`} />
                  <div className={`${bar} mt-4 h-6 w-20`} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {variant === 'calendar' && (
        <div className={card}>
          <div className="flex items-center justify-between">
            <div className={`${bar} h-4 w-36`} />
            <div className="flex gap-2">
              <div className={`${block} h-8 w-8`} />
              <div className={`${block} h-8 w-8`} />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-20 motion-safe:animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        </div>
      )}

      {variant === 'chat' && (
        <div className="grid h-[60vh] grid-cols-1 gap-5 lg:grid-cols-4">
          <div className={`${card} space-y-3 lg:col-span-1`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className={`${bar} h-3 w-3/4`} />
                <div className={`${bar} h-2.5 w-1/2`} />
              </div>
            ))}
          </div>
          <div className={`${card} flex flex-col justify-end gap-4 lg:col-span-3`}>
            <div className="space-y-4">
              <div className={`${bar} h-3 w-1/2`} />
              <div className="ml-auto h-16 w-2/3 motion-safe:animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-20 w-3/4 motion-safe:animate-pulse rounded-2xl bg-slate-100" />
            </div>
            <div className={`${block} h-12 w-full`} />
          </div>
        </div>
      )}
    </div>
  )
}
