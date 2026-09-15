export type MakeAction = 'make' | 'remake'

export type MakeRequestState = {
  makeId: string | null
  remakeId: string | null
  remakeDone: boolean
}

export function emptyMakeRequestState(): MakeRequestState {
  return { makeId: null, remakeId: null, remakeDone: false }
}

export function resolveMakeRequestId(
  state: MakeRequestState,
  action: MakeAction,
  gen: () => string,
): { requestId: string; state: MakeRequestState } {
  if (action === 'make') {
    const requestId = state.makeId ?? gen()
    return { requestId, state: { ...state, makeId: requestId } }
  }
  if (state.remakeId && !state.remakeDone) {
    return { requestId: state.remakeId, state }
  }
  const requestId = gen()
  return { requestId, state: { ...state, remakeId: requestId, remakeDone: false } }
}

export function markMakeSuccess(state: MakeRequestState, action: MakeAction): MakeRequestState {
  if (action === 'remake') return { ...state, remakeDone: true }
  return state
}

/** After 撤回, drop the request id that Ledger already stored as success so the next 已拼 is a new request. */
export function clearRequestAfterVoid(state: MakeRequestState, voidedRequestId?: string | null): MakeRequestState {
  const next: MakeRequestState = { ...state }
  if (!voidedRequestId || state.makeId === voidedRequestId) next.makeId = null
  if (!voidedRequestId || state.remakeId === voidedRequestId) {
    next.remakeId = null
    next.remakeDone = false
  }
  return next
}
