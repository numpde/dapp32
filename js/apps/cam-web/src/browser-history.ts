type HistoryPort = Pick<History, 'state' | 'replaceState' | 'pushState' | 'go'> & { readonly href: string }
type Entry = { readonly camViewer: string; readonly position: number; readonly visitId?: number }
export type BrowserVisit = { readonly position: number; readonly visitId?: number; readonly href: string }

function entry(state: unknown): Entry | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const candidate = state as Partial<Entry>
  return typeof candidate.camViewer === 'string' && Number.isSafeInteger(candidate.position)
    && (candidate.visitId === undefined || Number.isSafeInteger(candidate.visitId)) ? candidate as Entry : undefined
}

export function createBrowserHistory(port: HistoryPort, token: string) {
  const initialEntry = entry(port.state)
  let earliestKnownPosition = 0
  if (initialEntry !== undefined) earliestKnownPosition = initialEntry.position
  let committedPosition = earliestKnownPosition
  let observedPosition = earliestKnownPosition
  let observedHref = port.href
  let restoringPosition: number | undefined
  let restoration: Promise<void> | undefined
  let finishRestoration: (() => void) | undefined
  return {
    canGoBack: () => committedPosition > earliestKnownPosition,
    observe(): BrowserVisit | undefined {
      const state = entry(port.state)
      if (state?.position === observedPosition && port.href === observedHref) return undefined
      // A manually edited fragment may inherit state from its preceding entry.
      const inherited = state?.position === observedPosition
      observedPosition = state === undefined || inherited ? observedPosition + 1 : state.position
      observedHref = port.href
      if (state === undefined || inherited) {
        port.replaceState({ camViewer: token, position: observedPosition }, '', port.href)
      }
      if (observedPosition === restoringPosition) {
        restoringPosition = undefined
        finishRestoration?.()
        finishRestoration = undefined
        restoration = undefined
        return undefined
      }
      return {
        position: observedPosition,
        ...(state?.camViewer === token && !inherited && state.visitId !== undefined ? { visitId: state.visitId } : {}),
        href: port.href,
      }
    },
    isCurrent: (visit: BrowserVisit) => visit.position === observedPosition && visit.href === port.href,
    commit(visitId: number, href: string, mode: 'push' | 'replace' | BrowserVisit): void {
      const position = mode === 'push' ? committedPosition + 1 : typeof mode === 'object' ? mode.position : committedPosition
      const state: Entry = { camViewer: token, visitId, position }
      if (mode === 'push') port.pushState(state, '', href)
      else port.replaceState(state, '', href)
      earliestKnownPosition = Math.min(earliestKnownPosition, position)
      committedPosition = observedPosition = position
      observedHref = href
      restoringPosition = undefined
    },
    restore(target: number | "committed"): void {
      const position = target === "committed" ? committedPosition : target
      if (position === observedPosition) return
      restoringPosition = position
      if (restoration === undefined) restoration = new Promise<void>(resolve => { finishRestoration = resolve })
      port.go(position - observedPosition)
    },
    settled: async (): Promise<void> => { while (restoration !== undefined) await restoration },
    back(): void { port.go(-1) },
  }
}
