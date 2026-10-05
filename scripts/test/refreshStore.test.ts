import test from "node:test"
import assert from "node:assert/strict"
import { useRefreshStore } from "@/lib/store/refreshStore"

const store = () => useRefreshStore.getState()

function reset() {
  useRefreshStore.setState({ owner: null, target: null })
}

test("nothing registered means no navbar button", () => {
  reset()
  assert.equal(store().target, null)
})

test("a page's registration is what the navbar runs", () => {
  reset()
  let calls = 0
  const page = {}
  store().register(page, { run: () => { calls++ }, busy: false, label: "prices" })
  store().target!.run()
  assert.equal(calls, 1)
  assert.equal(store().target!.label, "prices")
})

test("re-registering the same page updates busy in place", () => {
  reset()
  const page = {}
  const run = () => {}
  store().register(page, { run, busy: false, label: "trades" })
  store().register(page, { run, busy: true, label: "trades" })
  assert.equal(store().target!.busy, true)
})

test("releasing on unmount removes the button", () => {
  reset()
  const page = {}
  store().register(page, { run: () => {}, busy: false, label: "trades" })
  store().release(page)
  assert.equal(store().target, null)
})

test("the outgoing page's cleanup does not clear the incoming page", () => {
  // Client navigation can mount the new page before the old one's cleanup runs.
  reset()
  const spot = {}
  const main = {}
  store().register(spot, { run: () => {}, busy: false, label: "prices" })
  store().register(main, { run: () => {}, busy: false, label: "trades" })
  store().release(spot)
  assert.equal(store().target?.label, "trades")
})
