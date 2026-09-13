import { expect, test, vi } from "vitest"
import launch from "../source/launch.js"
import wire from "../source/wire.js"

vi.mock("../source/wire.js", () => ({ default: { request: vi.fn() } }))

test("saved launch operations retain their Program address and validate values", async () => {
  const request = vi.mocked(wire.request)
  const address = { identity: "example", reference: "reference" }
  const saved = launch(address)
  request.mockResolvedValueOnce([null])
  expect(await saved.get()).toBeNull()
  expect(request).toHaveBeenLastCalledWith(["launch", address, "get"])
  const value = { options: { document: "icon.txt" } }
  request.mockResolvedValueOnce([])
  await saved.set(value)
  expect(request).toHaveBeenLastCalledWith(["launch", address, "set", value])
  request.mockResolvedValueOnce([value])
  expect(await saved.get()).toEqual(value)
  request.mockResolvedValueOnce([false])
  await expect(saved.get()).rejects.toThrow()
  // @ts-expect-error set requires a Launch; true is declaration shorthand only.
  await expect(saved.set(true)).rejects.toThrow()
  expect(request).toHaveBeenCalledTimes(4)
})
